import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isVendorRoute = request.nextUrl.pathname.startsWith("/vendor")
  const isLoginPage = request.nextUrl.pathname === "/vendor/login"

  if (isVendorRoute && !isLoginPage && !user) {
    const url = request.nextUrl.clone()
    url.pathname = "/vendor/login"
    return NextResponse.redirect(url)
  }

  if (
    isLoginPage &&
    user &&
    request.nextUrl.searchParams.get("error") !== "not_a_vendor"
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/vendor/dashboard"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
