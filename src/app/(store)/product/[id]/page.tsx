import { permanentRedirect } from "next/navigation"

export default async function LegacyProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  permanentRedirect(`/products/${encodeURIComponent(id)}`)
}
