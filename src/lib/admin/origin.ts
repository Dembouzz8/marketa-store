import "server-only"
import { headers } from "next/headers"

export async function assertAdminOrigin() {
  const requestHeaders = await headers()
  const origin = requestHeaders.get("origin")
  const isVercel = process.env.VERCEL === "1"
  // Vercel supplies this header at its controlled ingress. Other hosts must
  // preserve Host; never trust arbitrary forwarded headers on a direct server.
  const host = isVercel
    ? requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
    : requestHeaders.get("host")
  const forwardedProtocol = isVercel
    ? requestHeaders.get("x-forwarded-proto")
    : null

  if (
    !origin ||
    origin === "null" ||
    !host ||
    /[\s,/@\\]/.test(host) ||
    (isVercel && forwardedProtocol !== "https")
  ) {
    throw new Error("Invalid admin request origin.")
  }
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error("Invalid admin request origin.")
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.origin !== origin ||
    parsed.host.toLowerCase() !== host.toLowerCase() ||
    (isVercel && parsed.protocol !== `${forwardedProtocol}:`)
  ) {
    throw new Error("Invalid admin request origin.")
  }
}
