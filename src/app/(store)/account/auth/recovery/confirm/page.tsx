export const dynamic = "force-dynamic"

export default function PasswordRecoveryConfirmPage() {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-16">
      <div className="mx-auto max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-amber-700">Marketa account</p>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-900">
          Continue to reset your Marketa password
        </h1>
        <p className="mt-4 text-sm leading-6 text-zinc-600">
          Continue to securely confirm this recovery link and choose a new
          password for your shared Marketa account.
        </p>
        <form method="post" action="/account/auth/recovery" className="mt-6">
          <button
            type="submit"
            className="w-full rounded-lg bg-amber-500 px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-amber-400"
          >
            Continue password recovery
          </button>
        </form>
      </div>
    </main>
  )
}
