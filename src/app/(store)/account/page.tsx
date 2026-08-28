import { LogOut, UserRound } from "lucide-react"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { createSupabaseServerClient } from "@/lib/supabase-server"

import { signOutCustomer } from "./actions"

export default async function CustomerAccountPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/account/login")

  return (
    <main className="bg-zinc-50 px-4 py-12 sm:px-6 sm:py-16">
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <UserRound className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-900">
          Customer Account
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          You are signed in to Marketa.
        </p>

        <div className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Email
          </p>
          <p className="mt-1 break-words text-base font-medium text-zinc-900">
            {user.email ?? "Email unavailable"}
          </p>
        </div>

        <form action={signOutCustomer} className="mt-8">
          <Button
            type="submit"
            variant="outline"
            className="h-11 gap-2 border-zinc-300 px-5 font-semibold text-zinc-900 hover:border-zinc-500"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </Button>
        </form>
      </section>
    </main>
  )
}
