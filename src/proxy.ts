import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

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
  const isLoginPage = path === "/vendor/login"

  if (isVendorRoute && !isLoginPage && !user) {
    return NextResponse.redirect(new URL("/vendor/login", request.url))
  }

  if (isLoginPage && user) {
    return NextResponse.redirect(new URL("/vendor/dashboard", request.url))
  }

  return response
}

export const config = {
  matcher: ["/vendor/:path*"],
}
