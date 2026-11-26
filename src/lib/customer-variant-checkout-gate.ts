/** Only the exact server-side opt-in prepares variant checkout requests. */
export function isCustomerVariantCheckoutEnabled(value: unknown): boolean {
  return value === "true"
}
