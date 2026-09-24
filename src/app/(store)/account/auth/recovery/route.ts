import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

const failurePath = "/account/password/forgot?recovery_error=1"
const confirmPath = "/account/auth/recovery/confirm"
const successPath = "/account/password/reset"
const recoveryCookieName = "marketa-password-recovery"
const recoveryCookiePath = "/account/auth/recovery"
const recoveryCookieMaxAgeSeconds = 600
const maxTokenHashLength = 1024

function validTokenHash(tokenHash: string): boolean {
  return (
    tokenHash.length > 0 &&
    tokenHash.length <= maxTokenHashLength &&
    !/[\s\x00-\x1f\x7f]/u.test(tokenHash)
  )
}

function fixedRedirect(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303)
  response.headers.set("Cache-Control", "private, no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}

function clearRecoveryCookie(response: NextResponse) {
  response.cookies.set({
    name: recoveryCookieName,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: recoveryCookiePath,
    maxAge: 0,
  })
}

function failureRedirect(request: NextRequest) {
  const response = fixedRedirect(request, failurePath)
  try {
    clearRecoveryCookie(response)
  } catch {
    // This fresh response never contains partially written Auth cookies.
  }
  return response
}

function readRecoveryCookie(value: string | undefined): string | null {
  if (!value || value.length > maxTokenHashLength + 14) return null

  const separator = value.indexOf(":")
  if (separator !== 13) return null

  const issuedAtText = value.slice(0, separator)
  if (!/^\d{13}$/u.test(issuedAtText)) return null

  const age = Date.now() - Number(issuedAtText)
  const tokenHash = value.slice(separator + 1)
  if (age < 0 || age > recoveryCookieMaxAgeSeconds * 1000) return null
  return validTokenHash(tokenHash) ? tokenHash : null
}

function isTrustedConfirmationPost(request: NextRequest): boolean {
  const expectedOrigin = request.nextUrl.origin
  const origin = request.headers.get("origin")

  if (origin && origin !== "null") {
    return origin === expectedOrigin
  }

  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite !== null) {
    if (fetchSite !== "same-origin") return false

    const fetchMode = request.headers.get("sec-fetch-mode")
    if (fetchMode !== null && fetchMode !== "navigate") return false

    const fetchDestination = request.headers.get("sec-fetch-dest")
    if (fetchDestination !== null && fetchDestination !== "document") return false

    return true
  }

  const referer = request.headers.get("referer")
  if (!referer) return false

  try {
    return new URL(referer).origin === expectedOrigin
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  const parameters = request.nextUrl.searchParams
  const names = [...parameters.keys()]
  const tokenHashes = parameters.getAll("token_hash")
  const types = parameters.getAll("type")

  if (
    names.length !== 2 ||
    names.some((name) => name !== "token_hash" && name !== "type") ||
    tokenHashes.length !== 1 ||
    types.length !== 1 ||
    types[0] !== "recovery" ||
    !validTokenHash(tokenHashes[0])
  ) {
    return failureRedirect(request)
  }

  try {
    const response = fixedRedirect(request, confirmPath)
    response.cookies.set({
      name: recoveryCookieName,
      value: `${Date.now()}:${tokenHashes[0]}`,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: recoveryCookiePath,
      maxAge: recoveryCookieMaxAgeSeconds,
    })
    return response
  } catch {
    return failureRedirect(request)
  }
}

export async function POST(request: NextRequest) {
  if (
    request.nextUrl.searchParams.size !== 0 ||
    !isTrustedConfirmationPost(request)
  ) {
    return failureRedirect(request)
  }

  try {
    if ((await request.text()).length !== 0) return failureRedirect(request)
  } catch {
    return failureRedirect(request)
  }

  const tokenHash = readRecoveryCookie(
    request.cookies.get(recoveryCookieName)?.value
  )
  if (!tokenHash) return failureRedirect(request)

  const response = fixedRedirect(request, successPath)
  const cookies = new Map(
    request.cookies.getAll().map(({ name, value }) => [name, value])
  )
  const writtenCookies = new Set<string>()

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return [...cookies].map(([name, value]) => ({ name, value }))
          },
          setAll(cookiesToSet, headers) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options)
              if (options.maxAge === 0) {
                cookies.delete(name)
                writtenCookies.delete(name)
              } else {
                cookies.set(name, value)
                if (value) writtenCookies.add(name)
              }
            })
            Object.entries(headers).forEach(([name, value]) => {
              response.headers.set(name, value)
            })
          },
        },
      }
    )

    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    })
    if (error || !data.session || !data.user || writtenCookies.size === 0) {
      return failureRedirect(request)
    }

    const { data: verified, error: userError } = await supabase.auth.getUser()
    if (
      userError ||
      !verified.user ||
      verified.user.id !== data.user.id ||
      !verified.user.email?.trim() ||
      !verified.user.email_confirmed_at ||
      writtenCookies.size === 0
    ) {
      return failureRedirect(request)
    }

    clearRecoveryCookie(response)
    return response
  } catch {
    return failureRedirect(request)
  }
}
