/** Only the explicit server-side opt-in exposes variant cart controls. */
export function isCustomerVariantCartEnabled(value: unknown): boolean {
  return value === "true"
}
