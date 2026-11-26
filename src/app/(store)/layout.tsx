import { CartSidebar } from "@/components/cart-sidebar"
import { Footer } from "@/components/footer"
import { Navbar } from "@/components/navbar"
import { isCustomerVariantCheckoutEnabled } from "@/lib/customer-variant-checkout-gate"

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Navbar />
      <CartSidebar
        variantCheckoutEnabled={isCustomerVariantCheckoutEnabled(
          process.env.CUSTOMER_VARIANT_CHECKOUT_ENABLED
        )}
      />
      {children}
      <Footer />
    </>
  )
}
