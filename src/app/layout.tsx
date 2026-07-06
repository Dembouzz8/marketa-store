import type { Metadata } from "next"

import { CartSidebar } from "@/components/cart-sidebar"
import { Footer } from "@/components/footer"
import { Navbar } from "@/components/navbar"
import { Providers } from "@/components/providers"
import { Toaster } from "@/components/ui/toaster"

import "./globals.css"

export const metadata: Metadata = {
  title: "Marketa — Nigeria's Premium Marketplace",
  description:
    "Shop unique products from verified vendors across Nigeria. Fast delivery, secure payments.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-white font-sans text-zinc-900 antialiased">
        <Providers>
          <Navbar />
          <CartSidebar />
          <main>{children}</main>
          <Footer />
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
