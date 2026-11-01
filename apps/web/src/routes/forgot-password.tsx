import type { UserText } from "@parley/errors"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { AuthForm, Field } from "../components/auth-form.tsx"
import { ParleyMark } from "../components/logo.tsx"
import { Button } from "../components/ui/index.ts"
import { AuthHeading, AuthPage } from "../components/ui/public.tsx"
import { requestPasswordReset } from "../lib/auth.ts"

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { email?: string } =>
    typeof search.email === "string" && search.email.length <= 320 ? { email: search.email } : {},
  component: ForgotPassword,
})

/** Asks for a link to choose a new password (D172). */
function ForgotPassword() {
  const search = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const [sentTo, setSentTo] = useState<string>()
  const submit = async (form: FormData) => {
    setBusy(true)
    const email = String(form.get("email")).trim()
    const outcome = await requestPasswordReset(email)
    setBusy(false)
    if (outcome.failure) return setError(outcome.failure)
    setSentTo(email)
  }
  if (sentTo) return <Sent email={sentTo} />
  return (
    <AuthForm
      title="Reset your password"
      intro="We'll email you a link to choose a new one."
      submitLabel="Send reset link"
      busy={busy}
      error={error}
      onSubmit={submit}
      footer={
        <>
          Remembered it? <Link to="/sign-in">Sign in</Link>
        </>
      }
    >
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        autoFocus
        {...(search.email ? { defaultValue: search.email } : {})}
      />
    </AuthForm>
  )
}

/**
 * Worded the same whether or not the address has an account, so nobody learns from it which
 * addresses do (D163, D172).
 */
function Sent(props: { readonly email: string }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string>()
  const again = async () => {
    setBusy(true)
    const outcome = await requestPasswordReset(props.email)
    setBusy(false)
    setNote(outcome.failure ?? "Sent again. It can take a minute to arrive.")
  }
  return (
    <AuthPage>
      <div className="flex flex-col gap-4">
        <ParleyMark className="h-8 self-start" />
        <AuthHeading title="Check your email">
          If <strong className="font-medium text-fg">{props.email}</strong> has an account here, we've sent it a link to
          choose a new password. It works for an hour.
        </AuthHeading>
        <Button size="lg" wide disabled={busy} onClick={() => void again()}>
          Send it again
        </Button>
        {note ? (
          <p role="status" className="m-0 text-sm text-muted">
            {note}
          </p>
        ) : null}
        <p className="m-0 text-sm text-muted [&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2">
          <Link to="/sign-in">Back to sign in</Link>
        </p>
      </div>
    </AuthPage>
  )
}
