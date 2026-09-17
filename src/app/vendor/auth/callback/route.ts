import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

const failurePath = "/account/login?vendor_onboarding=1&invite_error=1"
const successPath = "/vendor/onboarding"
const maxTokenHashLength = 1024

function fixedRedirect(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303)
  response.headers.set("Cache-Control", "private, no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
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
    types[0] !== "invite"
  ) {
    return fixedRedirect(request, failurePath)
  }

  const tokenHash = tokenHashes[0]
  if (
    !tokenHash ||
    tokenHash.length > maxTokenHashLength ||
    /[\s\x00-\x1f\x7f]/u.test(tokenHash)
  ) {
    return fixedRedirect(request, failurePath)
  }

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
      type: "invite",
    })
    if (error || !data.session || !data.user || writtenCookies.size === 0) {
      return fixedRedirect(request, failurePath)
    }

    const { data: verified, error: userError } = await supabase.auth.getUser()
    if (
      userError ||
      !verified.user ||
      verified.user.id !== data.user.id ||
      writtenCookies.size === 0
    ) {
      return fixedRedirect(request, failurePath)
    }

    return response
  } catch {
    return fixedRedirect(request, failurePath)
  }
}
