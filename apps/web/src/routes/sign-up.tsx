import type { UserText } from "@parley/errors"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { AuthForm, Field } from "../components/auth-form.tsx"
import { ParleyMark } from "../components/logo.tsx"
import { Button } from "../components/ui/index.ts"
import { AuthHeading, AuthPage, LinkButton } from "../components/ui/public.tsx"
import { agentRequest, resendConfirmation, signUp, withAgentRequest } from "../lib/auth.ts"
import { safeRedirect } from "./sign-in.tsx"

export const Route = createFileRoute("/sign-up")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const redirect = safeRedirect(search.redirect)
    return redirect ? { redirect } : {}
  },
  component: SignUp,
})

function SignUp() {
  const search = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  /** The address a confirmation link went to, once signed up. */
  const [sentTo, setSentTo] = useState<string>()
  // The confirmation link leads back to the invitation or the agent's request, else into Parley (D130).
  const returnTo = search.redirect ?? (agentRequest() ? withAgentRequest("/new-team") : undefined)
  const submit = async (form: FormData) => {
    setBusy(true)
    const email = String(form.get("email"))
    const outcome = await signUp(String(form.get("name")), email, String(form.get("password")), returnTo)
    setBusy(false)
    if (outcome.failure) return setError(outcome.failure)
    // Nobody is signed in until they confirm their address (D163).
    setSentTo(email)
  }
  if (sentTo) {
    return <CheckEmail email={sentTo} returnTo={returnTo} onStartOver={() => setSentTo(undefined)} />
  }
  return (
    <AuthForm
      title="Create your account"
      intro={
        search.redirect?.startsWith("/invite/")
          ? "Use the address your invitation went to."
          : "Use your work email. You'll set up your team next."
      }
      submitLabel="Create account"
      busy={busy}
      error={error}
      onSubmit={submit}
      footer={
        <>
          Already have an account?{" "}
          <a
            href={
              search.redirect
                ? `/sign-in?redirect=${encodeURIComponent(search.redirect)}`
                : withAgentRequest("/sign-in")
            }
          >
            Sign in
          </a>
        </>
      }
    >
      <Field label="Name" name="name" autoComplete="name" autoFocus />
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field label="Password" name="password" type="password" autoComplete="new-password" />
    </AuthForm>
  )
}

/**
 * After signing up (D163). Worded the same whether or not the address may have an account: an
 * address that may not is answered as if it worked, and no email comes.
 */
function CheckEmail(props: {
  readonly email: string
  readonly returnTo: string | undefined
  readonly onStartOver: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string>()
  const resend = async () => {
    setBusy(true)
    const outcome = await resendConfirmation(props.email, props.returnTo)
    setBusy(false)
    setNote(outcome.failure ?? "Sent again. It can take a minute to arrive.")
  }
  return (
    <AuthPage>
      <div className="flex flex-col gap-4">
        <ParleyMark className="h-8 self-start" />
        <AuthHeading title="Check your email">
          If <strong className="font-medium text-fg">{props.email}</strong> can have an account here, we've sent it a
          link. Open it to confirm your address and finish setting up. Nothing there? Ask someone on your team to invite
          you.
        </AuthHeading>
        <Button size="lg" wide disabled={busy} onClick={() => void resend()}>
          Send it again
        </Button>
        {note ? (
          <p role="status" className="m-0 text-sm text-muted">
            {note}
          </p>
        ) : null}
        <p className="m-0 text-sm text-muted">
          Wrong address? <LinkButton onClick={props.onStartOver}>Start over</LinkButton>
        </p>
      </div>
    </AuthPage>
  )
}
