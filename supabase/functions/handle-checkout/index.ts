import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  try {
    // Service role client — bypasses RLS for server-side operations
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const body = await req.json()
    const { customer_email, customer_phone, items, shipping_address } = body

    // ── Validate required fields ──────────────────────────────────────────
    if (!customer_email) {
      return new Response(
        JSON.stringify({ error: "customer_email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "Cart is empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // ── Fetch products from DB (authoritative prices — never trust client) ─
    const productIds = items.map((i: { product_id: string }) => i.product_id)

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, vendor_id, name, price, stock, is_active")
      .in("id", productIds)

    if (productsError || !products) {
      console.error("Failed to fetch products:", productsError)
      return new Response(
        JSON.stringify({ error: "Failed to fetch products" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // ── Validate each cart item ───────────────────────────────────────────
    const productMap = new Map(products.map((p) => [p.id, p]))
    let totalAmount = 0
    const validatedItems = []

    for (const cartItem of items) {
      const product = productMap.get(cartItem.product_id)

      if (!product) {
        return new Response(
          JSON.stringify({ error: `Product not found: ${cartItem.product_id}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      if (!product.is_active) {
        return new Response(
          JSON.stringify({ error: `Product no longer available: ${product.name}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      if (product.stock < cartItem.quantity) {
        return new Response(
          JSON.stringify({ error: `Insufficient stock for: ${product.name}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      const subtotal = product.price * cartItem.quantity
      totalAmount += subtotal

      validatedItems.push({
        product_id: product.id,
        vendor_id: product.vendor_id,
        quantity: cartItem.quantity,
        unit_price: product.price,
        subtotal,
      })
    }

    // ── Create pending order ──────────────────────────────────────────────
    const idempotencyKey = `ORD-${Date.now()}-${crypto.randomUUID().split("-")[0].toUpperCase()}`

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        customer_email,
        customer_phone: customer_phone || null,
        status: "pending",
        total_amount: totalAmount,
        idempotency_key: idempotencyKey,
        shipping_address: shipping_address || {},
      })
      .select()
      .single()

    if (orderError || !order) {
      console.error("Failed to create order:", orderError)
      return new Response(
        JSON.stringify({ error: "Failed to create order" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // ── Insert order items ────────────────────────────────────────────────
    const orderItems = validatedItems.map((item) => ({
      order_id: order.id,
      ...item,
    }))

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(orderItems)

    if (itemsError) {
      console.error("Failed to insert order items:", itemsError)
      await supabase.from("orders").delete().eq("id", order.id)
      return new Response(
        JSON.stringify({ error: "Failed to create order items" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // ── Initialize Paystack transaction ───────────────────────────────────
    const paystackRes = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: customer_email,
          amount: Math.round(totalAmount * 100), // Naira → kobo
          reference: idempotencyKey,
          callback_url: `${Deno.env.get("STOREFRONT_URL")}/payment-success`,
          metadata: {
            order_id: order.id,
            customer_phone: customer_phone || "",
          },
        }),
      }
    )

    const paystackData = await paystackRes.json()

    if (!paystackData.status) {
      console.error("Paystack init failed:", paystackData)
      await supabase.from("order_items").delete().eq("order_id", order.id)
      await supabase.from("orders").delete().eq("id", order.id)
      return new Response(
        JSON.stringify({ error: "Payment initialization failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // ── Save payment_ref to order ─────────────────────────────────────────
    await supabase
      .from("orders")
      .update({ payment_ref: paystackData.data.reference })
      .eq("id", order.id)

    // ── Return authorization URL to storefront ────────────────────────────
    return new Response(
      JSON.stringify({
        order_id: order.id,
        authorization_url: paystackData.data.authorization_url,
        reference: paystackData.data.reference,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err) {
    console.error("handle-checkout unexpected error:", err)
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})