import type { UserText } from "@parley/errors"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { AuthForm, Field } from "../components/auth-form.tsx"
import { CheckIcon, PasskeyIcon } from "../components/icons.tsx"
import { Button, Checkbox, Notice, Option } from "../components/ui/index.ts"
import { LinkButton } from "../components/ui/public.tsx"
import { Separator } from "../components/ui/separator.tsx"
import {
  type AuthOutcome,
  agentRequest,
  signIn,
  signInWithPasskey,
  verifyBackupCode,
  verifyCode,
  withAgentRequest,
} from "../lib/auth.ts"

const SAME_SITE = "https://parley.invalid"

/**
 * Only paths on this site, so a link can't send someone elsewhere after signing in. Resolved the
 * way a browser would, so `//evil.com`, `/\evil.com` and the like are refused, not just spotted.
 */
export const safeRedirect = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.startsWith("/") || /[\\\s]/.test(value)) return undefined
  if ([...value].some((char) => char.charCodeAt(0) < 0x20)) return undefined
  try {
    const url = new URL(value, SAME_SITE)
    return url.origin === SAME_SITE ? `${url.pathname}${url.search}${url.hash}` : undefined
  } catch {
    return undefined
  }
}

export const Route = createFileRoute("/sign-in")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { redirect?: string; reset?: "done" } => {
    const redirect = safeRedirect(search.redirect)
    return { ...(redirect ? { redirect } : {}), ...(search.reset === "done" ? { reset: "done" as const } : {}) }
  },
  component: SignIn,
})

function SignIn() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  /** The address whose password was right, when a code comes next (D172). */
  const [secondStep, setSecondStep] = useState<string>()
  const [email, setEmail] = useState("")

  const carryOn = async (outcome: AuthOutcome) => {
    if (outcome.failure) return setError(outcome.failure)
    // An agent is waiting: carry on to its consent page.
    if (outcome.next) return window.location.assign(outcome.next)
    if (search.redirect) return window.location.assign(search.redirect)
    await navigate({ to: "/" })
  }

  // Passkeys are offered among the email field's suggestions as soon as the page opens (D172).
  // Picking one signs in; anything else (typing, cancelling) leaves the form as it is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the page opens
  useEffect(() => {
    let open = true
    void signInWithPasskey(true).then((outcome) => {
      if (open && !outcome.failure) void carryOn(outcome)
    })
    return () => {
      open = false
    }
  }, [])

  const submit = async (form: FormData) => {
    setBusy(true)
    const email = String(form.get("email"))
    const outcome = await signIn(email, String(form.get("password")))
    setBusy(false)
    if (outcome.secondStep) return setSecondStep(email)
    await carryOn(outcome)
  }

  const withPasskey = async () => {
    setBusy(true)
    const outcome = await signInWithPasskey()
    setBusy(false)
    await carryOn(outcome)
  }

  if (secondStep) return <SecondStep email={secondStep} onDone={carryOn} onStartOver={() => setSecondStep(undefined)} />

  return (
    <AuthForm
      title="Sign in to Parley"
      intro={
        agentRequest()
          ? "Sign in to choose what your agent can do in Parley."
          : "Contacts and companies for your team, and its agents."
      }
      submitLabel="Sign in"
      busy={busy}
      error={error}
      onSubmit={submit}
      before={
        <>
          {search.reset === "done" ? (
            <Notice tone="ok" icon={<CheckIcon />}>
              <span role="status">Password changed. Sign in with your new one.</span>
            </Notice>
          ) : null}
          <Button size="lg" wide disabled={busy} onClick={() => void withPasskey()}>
            <PasskeyIcon />
            Sign in with a passkey
          </Button>
          <div className="flex items-center gap-3 text-sm text-subtle">
            <Separator className="h-px flex-1" />
            or
            <Separator className="h-px flex-1" />
          </div>
        </>
      }
      footer={
        <>
          New to Parley?{" "}
          <a
            href={
              search.redirect
                ? `/sign-up?redirect=${encodeURIComponent(search.redirect)}`
                : withAgentRequest("/sign-up")
            }
          >
            Create an account
          </a>
        </>
      }
    >
      <Field label="Email" name="email" type="email" autoComplete="email webauthn" autoFocus onChange={setEmail} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        aside={
          <Link to="/forgot-password" search={email.trim() ? { email: email.trim() } : {}}>
            Forgot password?
          </Link>
        }
      />
    </AuthForm>
  )
}

/**
 * The second step of signing in (D172): a code from the authenticator app, or a backup code if the
 * phone is lost. Trusting the device skips this step there for 30 days.
 */
function SecondStep(props: {
  readonly email: string
  readonly onDone: (outcome: AuthOutcome) => Promise<void>
  readonly onStartOver: () => void
}) {
  const [backup, setBackup] = useState(false)
  const [trust, setTrust] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const switchTo = (next: boolean) => {
    setBackup(next)
    setError(undefined)
  }
  const submit = async (form: FormData) => {
    setBusy(true)
    const code = String(form.get("code"))
    const outcome = await (backup ? verifyBackupCode(code, trust) : verifyCode(code, trust))
    setBusy(false)
    if (outcome.failure) return setError(outcome.failure)
    await props.onDone(outcome)
  }
  const startOver = (
    <p className="m-0 border-t border-line pt-3 text-sm text-muted">
      Signing in as {props.email}. <LinkButton onClick={props.onStartOver}>Start over</LinkButton>
    </p>
  )
  return (
    <AuthForm
      key={backup ? "backup" : "app"}
      title={backup ? "Enter a backup code" : "Enter your code"}
      intro={
        backup
          ? "One of the codes you saved when you turned on two-factor authentication. Each works once."
          : "Open your authenticator app and enter the 6-digit code for Parley."
      }
      submitLabel="Sign in"
      busy={busy}
      error={error}
      onSubmit={submit}
      footer={
        backup ? (
          <LinkButton onClick={() => switchTo(false)}>Use your authenticator app</LinkButton>
        ) : (
          <>
            Lost your phone? <LinkButton onClick={() => switchTo(true)}>Use a backup code</LinkButton>
          </>
        )
      }
      after={startOver}
    >
      {backup ? (
        <Field label="Backup code" name="code" autoComplete="off" autoFocus />
      ) : (
        <Field label="Code" name="code" autoComplete="one-time-code" inputMode="numeric" autoFocus />
      )}
      <Option>
        <Checkbox checked={trust} onChange={(change) => setTrust(change.target.checked)} />
        Trust this device for 30 days
      </Option>
    </AuthForm>
  )
}
