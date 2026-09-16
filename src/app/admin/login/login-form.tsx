"use client"

import { useActionState } from "react"
import { loginAdmin } from "../auth-actions"

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAdmin, { message: "" })
  return (
    <form action={action} className="space-y-5">
      <fieldset disabled={pending} className="space-y-5 disabled:opacity-60">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required maxLength={254}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2" />
        </div>
        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={4096}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2" />
        </div>
        <button type="submit" className="w-full rounded-lg bg-amber-500 px-4 py-3 font-semibold text-zinc-900">
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </fieldset>
      {state.message && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
    </form>
  )
}
