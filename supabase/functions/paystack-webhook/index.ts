import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  // Only accept POST requests from Paystack
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  // Read raw body BEFORE anything else — needed for HMAC verification
  const rawBody = await req.text()

  // ── GATE 1: Verify HMAC signature ────────────────────────────────────────
  // Must be done on raw body string, not parsed JSON
  const signature = req.headers.get("x-paystack-signature")

  if (!signature) {
    console.error("BLOCKED: Missing x-paystack-signature header")
    return new Response("Unauthorized", { status: 401 })
  }

  const secret = Deno.env.get("PAYSTACK_WEBHOOK_SECRET")!
  const encoder = new TextEncoder()

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  )

  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody)
  )

  const computedHash = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  if (computedHash !== signature) {
    console.error("BLOCKED: HMAC mismatch — potential forged webhook")
    return new Response("Unauthorized", { status: 401 })
  }

  // ── Parse event ───────────────────────────────────────────────────────────
  const event = JSON.parse(rawBody)

  // Only process successful charges
  if (event.event !== "charge.success") {
    console.log(`Ignored event type: ${event.event}`)
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const eventData = event.data
  const eventId = String(eventData.id)
  const reference = eventData.reference
  const amountPaidKobo = eventData.amount // Paystack sends in kobo

  // Create Supabase service role client
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  try {
    // ── GATE 2: Idempotency check ───────────────────────────────────────────
    // If this event_id exists in the ledger, it was already processed
    const { data: existingEvent } = await supabase
      .from("events_ledger")
      .select("id")
      .eq("event_id", eventId)
      .maybeSingle()

    if (existingEvent) {
      console.log(`Event ${eventId} already processed — skipping duplicate`)
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    // ── Fetch order by payment_ref ──────────────────────────────────────────
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, total_amount, status, customer_email, customer_phone")
      .eq("payment_ref", reference)
      .maybeSingle()

    if (orderError || !order) {
      console.error(`Order not found for reference: ${reference}`)
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    // ── GATE 3: Confirm amount ──────────────────────────────────────────────
    // Paystack sends in kobo — convert our Naira total to kobo for comparison
    const expectedKobo = Math.round(order.total_amount * 100)

    if (amountPaidKobo !== expectedKobo) {
      console.error(
        `AMOUNT MISMATCH: expected ${expectedKobo} kobo, received ${amountPaidKobo} kobo`
      )
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Guard: don't process an already-confirmed order
    if (order.status !== "pending") {
      console.log(`Order ${order.id} is already ${order.status} — skipping`)
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    // ── Lock the event in events_ledger ─────────────────────────────────────
    // Insert BEFORE updating order status
    // If a concurrent retry tries to insert the same event_id, it gets a
    // unique constraint error and stops — preventing double fulfillment
    const { error: ledgerError } = await supabase
      .from("events_ledger")
      .insert({
        event_id: eventId,
        event_type: event.event,
        provider: "paystack",
        payload_hash: computedHash.substring(0, 64),
      })

    if (ledgerError) {
      // Unique constraint violation = concurrent retry already processing
      console.log(`Event ${eventId} being processed by concurrent request`)
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    // ── Confirm the order ───────────────────────────────────────────────────
    await supabase
      .from("orders")
      .update({ status: "confirmed" })
      .eq("id", order.id)

    // ── Create payout ledger entries for each vendor ────────────────────────
    const { data: orderItems } = await supabase
      .from("order_items")
      .select("vendor_id, subtotal")
      .eq("order_id", order.id)

    if (orderItems && orderItems.length > 0) {
      const vendorIds = [...new Set(orderItems.map((i) => i.vendor_id))]

      const { data: vendors } = await supabase
        .from("vendors")
        .select("id, platform_fee_pct")
        .in("id", vendorIds)

      const vendorMap = new Map(vendors?.map((v) => [v.id, v]) ?? [])

      // Sum subtotals per vendor (order may have multiple items from same vendor)
      const vendorTotals = new Map<string, number>()
      for (const item of orderItems) {
        const current = vendorTotals.get(item.vendor_id) ?? 0
        vendorTotals.set(item.vendor_id, current + Number(item.subtotal))
      }

      const ledgerEntries = []
      for (const [vendorId, subtotal] of vendorTotals) {
        const vendor = vendorMap.get(vendorId)
        const feePct = Number(vendor?.platform_fee_pct ?? 10)
        const vendorShare = subtotal * (1 - feePct / 100)

        ledgerEntries.push({
          vendor_id: vendorId,
          order_id: order.id,
          amount: vendorShare,
          type: "credit",
          reference,
          description: `Sale credit for order ${order.id}`,
        })
      }

      await supabase.from("payout_ledger").insert(ledgerEntries)
    }

    // ── Notify n8n Paid Order Orchestrator ──────────────────────────────────
    // n8n picks this up and handles: email receipt, PDF invoice,
    // WhatsApp confirmation, vendor notification
    const n8nUrl = Deno.env.get("N8N_PAID_ORDER_WEBHOOK_URL")

    if (n8nUrl) {
      try {
        await fetch(n8nUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: order.id,
            customer_email: order.customer_email,
            customer_phone: order.customer_phone,
            total_amount: order.total_amount,
            reference,
          }),
        })
      } catch (err) {
        // Log but don't fail — order is already confirmed
        // n8n orchestrator will be built to retry
        console.error("Failed to notify n8n orchestrator:", err)
      }
    }

    console.log(`✅ Order ${order.id} confirmed | Reference: ${reference}`)

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("paystack-webhook unexpected error:", err)
    // Always return 200 — never let Paystack retry unnecessarily
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }
})