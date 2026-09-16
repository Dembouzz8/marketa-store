import { LoginForm } from "./login-form"
import { logoutAdmin } from "../auth-actions"

export const dynamic = "force-dynamic"

export default async function AdminLogin({ searchParams }: {
  searchParams: Promise<{ access?: string | string[] }>
}) {
  const { access } = await searchParams
  const messages: Record<string, string> = {
    denied: "Access denied. This account does not have admin access.",
    unavailable: "Admin access could not be verified. Please try again later.",
    "invalid-request": "Invalid request. Reload the page and try again.",
    "logout-failed": "Sign-out could not be completed. Please try signing out again.",
  }
  const message = typeof access === "string" && Object.hasOwn(messages, access) ? messages[access] : null
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-amber-700">Marketa Admin</p>
        <h1 className="mt-2 text-2xl font-semibold">Sign in to review applications</h1>
        <p className="mt-3 mb-6 text-sm text-zinc-600">Access is limited to authorized administrators.</p>
        {message && <p role="alert" className="mb-5 text-sm text-red-700">{message}</p>}
        <LoginForm />
        <form action={logoutAdmin} className="mt-6 border-t border-zinc-200 pt-4">
          <button className="text-sm underline underline-offset-4">Sign out of the current session</button>
        </form>
        <p className="mt-3 text-xs text-zinc-500">Admin, customer and vendor access share this browser session. Signing out affects all three.</p>
      </div>
    </main>
  )
}
