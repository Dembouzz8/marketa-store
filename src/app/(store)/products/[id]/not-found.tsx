import Link from "next/link"
import { PackageX } from "lucide-react"

export default function ProductNotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-white px-4">
      <div className="max-w-md text-center">
        <PackageX className="mx-auto size-14 text-zinc-300" />
        <h1 className="mt-5 text-2xl font-bold text-zinc-900">Product not available</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">This product does not exist or is not currently available from an active Marketa vendor.</p>
        <Link href="/products" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white">Browse products</Link>
      </div>
    </main>
  )
}
