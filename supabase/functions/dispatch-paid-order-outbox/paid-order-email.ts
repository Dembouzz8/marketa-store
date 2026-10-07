import type { EmailDeliveryCommand } from "./index.ts"

export type RenderedPaidOrderEmail = {
  subject: string
  html: string
  text: string
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/
const KOBO_PATTERN = /^(0|[1-9][0-9]*)$/

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&#39;"
    }
  })
}

function plainTextValue(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ")
}

export function formatKobo(kobo: string, currency: string): string {
  if (!KOBO_PATTERN.test(kobo) || !CURRENCY_PATTERN.test(currency)) {
    throw new Error("Invalid money value")
  }
  const value = BigInt(kobo)
  const major = value / 100n
  const minor = (value % 100n).toString().padStart(2, "0")
  const groupedMajor = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${currency} ${groupedMajor}.${minor}`
}

function validItem(productName: string, quantity: number): boolean {
  return (
    productName.length >= 1 &&
    productName.length <= 300 &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 99
  )
}

function renderCustomerEmail(
  command: Extract<EmailDeliveryCommand, { recipientKind: "customer" }>
): RenderedPaidOrderEmail {
  if (command.items.length < 1) throw new Error("Missing order items")
  const htmlItems = command.items.map((item) => {
    if (!validItem(item.productName, item.quantity)) throw new Error("Invalid item")
    return `<li><strong>${escapeHtml(item.productName)}</strong><br>Quantity: ${item.quantity}<br>Gross amount: ${escapeHtml(formatKobo(item.grossAmountKobo, command.currency))}</li>`
  })
  const textItems = command.items.map((item) =>
    `${plainTextValue(item.productName)} — Quantity: ${item.quantity} — Gross amount: ${formatKobo(item.grossAmountKobo, command.currency)}`
  )
  const total = formatKobo(command.totalAmountKobo, command.currency)

  return {
    subject: "Your Marketa order is confirmed",
    html: `<!doctype html><html lang="en"><body><h1>Payment received</h1><p>Your Marketa order is confirmed.</p><h2>Purchased items</h2><ul>${htmlItems.join("")}</ul><p><strong>Total paid: ${escapeHtml(total)}</strong></p><p>The sellers will now prepare your items for fulfilment.</p></body></html>`,
    text: [
      "Payment received",
      "",
      "Your Marketa order is confirmed.",
      "",
      "Purchased items:",
      ...textItems,
      "",
      `Total paid: ${total}`,
      "",
      "The sellers will now prepare your items for fulfilment.",
    ].join("\n"),
  }
}

function renderVendorEmail(
  command: Extract<EmailDeliveryCommand, { recipientKind: "vendor" }>
): RenderedPaidOrderEmail {
  if (
    command.vendor.name.length < 1 ||
    command.vendor.name.length > 200 ||
    command.items.length < 1
  ) {
    throw new Error("Invalid vendor delivery")
  }
  const htmlItems = command.items.map((item) => {
    if (!validItem(item.productName, item.quantity)) throw new Error("Invalid item")
    return `<li><strong>${escapeHtml(item.productName)}</strong><br>Quantity: ${item.quantity}<br>Gross amount: ${escapeHtml(formatKobo(item.grossAmountKobo, item.currency))}<br>Platform fee: ${escapeHtml(formatKobo(item.platformFeeAmountKobo, item.currency))}<br>Vendor net: ${escapeHtml(formatKobo(item.vendorNetAmountKobo, item.currency))}</li>`
  })
  const textItems = command.items.map((item) =>
    `${plainTextValue(item.productName)} — Quantity: ${item.quantity} — Gross amount: ${formatKobo(item.grossAmountKobo, item.currency)} — Platform fee: ${formatKobo(item.platformFeeAmountKobo, item.currency)} — Vendor net: ${formatKobo(item.vendorNetAmountKobo, item.currency)}`
  )

  return {
    subject: "New paid order on Marketa",
    html: `<!doctype html><html lang="en"><body><h1>New paid order</h1><p>Hello ${escapeHtml(command.vendor.name)}, a paid order containing your products has been confirmed.</p><h2>Your items</h2><ul>${htmlItems.join("")}</ul><p>Please prepare these items for fulfilment.</p></body></html>`,
    text: [
      "New paid order",
      "",
      `Hello ${plainTextValue(command.vendor.name)}, a paid order containing your products has been confirmed.`,
      "",
      "Your items:",
      ...textItems,
      "",
      "Please prepare these items for fulfilment.",
    ].join("\n"),
  }
}

export function renderPaidOrderEmail(
  command: EmailDeliveryCommand
): RenderedPaidOrderEmail {
  return command.recipientKind === "customer"
    ? renderCustomerEmail(command)
    : renderVendorEmail(command)
}
