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
  for (const header of ["Cache-Control", "Expires", "Pragma"]) {
    const value = response.headers.get(header)
    if (value) redirectResponse.headers.set(header, value)
  }

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
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
          Object.entries(headers).forEach(([name, value]) =>
            response.headers.set(name, value)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAdminRoute = path === "/admin" || path.startsWith("/admin/")
  if (isAdminRoute) {
    response.headers.set("Cache-Control", "private, no-store")
    if (path !== "/admin/login" && !user) {
      const redirect = redirectWithCookies(request, response, "/admin/login")
      redirect.headers.set("Cache-Control", "private, no-store")
      return redirect
    }
  }
  const isVendorRoute = path.startsWith("/vendor")
  const isVendorLoginPage = path === "/vendor/login"
  const isVendorCallback = path === "/vendor/auth/callback"
  const isVendorConfirm = path === "/vendor/auth/confirm"
  const isVendorOnboarding = path === "/vendor/onboarding"
  const isAccountRoute = path === "/account" || path.startsWith("/account/")
  const isAccountAuthPage =
    path === "/account/login" || path === "/account/register"
  const isAccountCallback = path === "/account/auth/callback"
  const isProtectedAccountRoute =
    isAccountRoute && !isAccountAuthPage && !isAccountCallback

  if (isVendorRoute && !isVendorLoginPage && !isVendorCallback && !isVendorConfirm && !user) {
    const redirect = redirectWithCookies(
      request,
      response,
      isVendorOnboarding ? "/account/login?vendor_onboarding=1" : "/vendor/login"
    )
    if (isVendorOnboarding) redirect.headers.set("Cache-Control", "private, no-store")
    return redirect
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
    if (path === "/account/login" && request.nextUrl.searchParams.get("vendor_onboarding") === "1") {
      return redirectWithCookies(request, response, "/vendor/onboarding")
    }
    return redirectWithCookies(request, response, "/account")
  }

  if (isVendorCallback || isVendorConfirm || isVendorOnboarding) {
    response.headers.set("Cache-Control", "private, no-store")
  }
  if (isVendorCallback || isVendorConfirm) {
    response.headers.set("Referrer-Policy", "no-referrer")
  }

  return response
}

export const config = {
  matcher: ["/vendor/:path*", "/account/:path*", "/admin/:path*"],
}
