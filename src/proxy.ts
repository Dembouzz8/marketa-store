import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

function redirectWithCookies(
  request: NextRequest,
  response: NextResponse,
  path: string
) {
  const redirectResponse = NextResponse.redirect(new URL(path, request.url))

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie)
  })

  return redirectResponse
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isVendorRoute = path.startsWith("/vendor")
  const isVendorLoginPage = path === "/vendor/login"
  const isAccountRoute = path === "/account" || path.startsWith("/account/")
  const isAccountAuthPage =
    path === "/account/login" || path === "/account/register"
  const isAccountCallback = path === "/account/auth/callback"
  const isProtectedAccountRoute =
    isAccountRoute && !isAccountAuthPage && !isAccountCallback

  if (isVendorRoute && !isVendorLoginPage && !user) {
    return redirectWithCookies(request, response, "/vendor/login")
  }

  if (isVendorLoginPage && user) {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle()

    if (vendor) {
      return redirectWithCookies(request, response, "/vendor/dashboard")
    }
  }

  if (isProtectedAccountRoute && !user) {
    return redirectWithCookies(request, response, "/account/login")
  }

  if (isAccountAuthPage && user) {
    return redirectWithCookies(request, response, "/account")
  }

  return response
}

export const config = {
  matcher: ["/vendor/:path*", "/account/:path*"],
}
