import type { UserText } from "@parley/errors"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { AuthForm } from "../components/auth-form.tsx"
import { ParleyMark } from "../components/logo.tsx"
import { NewPasswordField } from "../components/new-password.tsx"
import { buttonClass } from "../components/ui/index.ts"
import { AuthHeading, AuthPage } from "../components/ui/public.tsx"
import { resetPassword } from "../lib/auth.ts"

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  // Better-Auth checks the emailed link first, then sends you here with its token, or with an
  // error when it's used or expired (D172).
  validateSearch: (search: Record<string, unknown>): { token?: string; error?: string } => ({
    ...(typeof search.token === "string" ? { token: search.token } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  component: ResetPassword,
})

/** Choosing a new password from a reset link (D172). */
function ResetPassword() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const [strongEnough, setStrongEnough] = useState(false)
  const onEnough = useCallback((enough: boolean) => setStrongEnough(enough), [])
  const token = search.token
  if (!token || search.error) return <LinkExpired />
  const submit = async (form: FormData) => {
    setBusy(true)
    const outcome = await resetPassword(token, String(form.get("password")))
    setBusy(false)
    if (outcome.failure) return setError(outcome.failure)
    await navigate({ to: "/sign-in", search: { reset: "done" } })
  }
  return (
    <AuthForm
      title="Choose a new password"
      intro="You'll be signed out everywhere, then sign in with it."
      submitLabel="Change password"
      busy={busy}
      cannotSubmit={!strongEnough}
      error={error}
      onSubmit={(form) => void submit(form)}
      // A link that stopped working while open says so in the error, with a way to a new one.
      footer={
        <>
          <Link to="/forgot-password">Send a new link</Link> · <Link to="/sign-in">Back to sign in</Link>
        </>
      }
    >
      <NewPasswordField id="password" name="password" label="New password" autoFocus onEnough={onEnough} />
    </AuthForm>
  )
}

function LinkExpired() {
  return (
    <AuthPage>
      <div className="flex flex-col gap-4">
        <ParleyMark className="h-8 self-start" />
        <AuthHeading title="This link doesn't work anymore">
          Reset links work once, for an hour. Ask for a new one.
        </AuthHeading>
        <Link to="/forgot-password" className={buttonClass({ variant: "primary", size: "lg", wide: true })}>
          Send a new link
        </Link>
        <p className="m-0 text-sm text-muted [&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2">
          <Link to="/sign-in">Back to sign in</Link>
        </p>
      </div>
    </AuthPage>
  )
}
