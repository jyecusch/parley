import type { UserText } from "@parley/errors"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { AuthForm, Field } from "../components/auth-form.tsx"
import { agentRequest, signUp, withAgentRequest } from "../lib/auth.ts"

export const Route = createFileRoute("/sign-up")({ ssr: false, component: SignUp })

function SignUp() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const submit = async (form: FormData) => {
    setBusy(true)
    const outcome = await signUp(String(form.get("name")), String(form.get("email")), String(form.get("password")))
    setBusy(false)
    if (outcome.failure) return setError(outcome.failure)
    // A new account has no team yet, so an agent's request waits until one is created.
    if (agentRequest()) return window.location.assign(withAgentRequest("/new-team"))
    await navigate({ to: "/new-team" })
  }
  return (
    <AuthForm
      title="Create your account"
      intro="You'll set up your team next."
      submitLabel="Create account"
      busy={busy}
      error={error}
      onSubmit={submit}
      footer={
        <>
          Already have an account? <a href={withAgentRequest("/sign-in")}>Sign in</a>
        </>
      }
    >
      <Field label="Name" name="name" autoComplete="name" autoFocus />
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field label="Password" name="password" type="password" autoComplete="new-password" />
    </AuthForm>
  )
}
