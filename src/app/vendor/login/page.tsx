"use client"

import { createBrowserClient } from "@supabase/ssr"
import { Eye, EyeOff, Loader2, Lock, Mail, ShoppingBag } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function VendorLoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsLoading(true)
    setError(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setIsLoading(false)
      return
    }

    window.location.href = "/vendor/dashboard"
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <div className="text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-100">
            <ShoppingBag className="size-10 text-amber-500" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-zinc-900">Marketa</h1>
          <p className="mt-1 text-sm text-zinc-500">Vendor Portal</p>
        </div>

        <Separator className="my-6" />

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Email
            </span>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11 rounded-lg border-zinc-200 pl-10"
                required
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Password
            </span>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 rounded-lg border-zinc-200 pl-10 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </label>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={isLoading}
            className="h-12 w-full rounded-lg bg-amber-500 py-3 font-semibold text-zinc-900 hover:bg-amber-400"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Sign In"
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}
