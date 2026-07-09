import { CartSidebar } from "@/components/cart-sidebar"
import { Footer } from "@/components/footer"
import { Navbar } from "@/components/navbar"

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Navbar />
      <CartSidebar />
      {children}
      <Footer />
    </>
  )
}
