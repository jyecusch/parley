import type { UserText } from "@parley/errors"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { AuthForm, Field } from "../components/auth-form.tsx"
import { agentRequest, signIn, withAgentRequest } from "../lib/auth.ts"

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
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const redirect = safeRedirect(search.redirect)
    return redirect ? { redirect } : {}
  },
  component: SignIn,
})

function SignIn() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const submit = async (form: FormData) => {
    setBusy(true)
    const outcome = await signIn(String(form.get("email")), String(form.get("password")))
    setBusy(false)
    if (outcome.failure) return setError(outcome.failure)
    // An agent is waiting: carry on to its consent page.
    if (outcome.next) return window.location.assign(outcome.next)
    if (search.redirect) return window.location.assign(search.redirect)
    await navigate({ to: "/" })
  }
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
      <Field label="Email" name="email" type="email" autoComplete="email" autoFocus />
      <Field label="Password" name="password" type="password" autoComplete="current-password" />
    </AuthForm>
  )
}
