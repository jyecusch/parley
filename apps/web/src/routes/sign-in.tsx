import type { UserText } from "@parley/errors"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { AuthForm, Field } from "../components/auth-form.tsx"
import { signIn } from "../lib/auth.ts"

export const Route = createFileRoute("/sign-in")({ ssr: false, component: SignIn })

function SignIn() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const submit = async (form: FormData) => {
    setBusy(true)
    const failure = await signIn(String(form.get("email")), String(form.get("password")))
    setBusy(false)
    if (failure) return setError(failure)
    await navigate({ to: "/" })
  }
  return (
    <AuthForm
      title="Sign in to Parley"
      intro="Contacts and companies for your team, and its agents."
      submitLabel="Sign in"
      busy={busy}
      error={error}
      onSubmit={submit}
      footer={
        <>
          New to Parley? <Link to="/sign-up">Create an account</Link>
        </>
      }
    >
      <Field label="Email" name="email" type="email" autoComplete="email" autoFocus />
      <Field label="Password" name="password" type="password" autoComplete="current-password" />
    </AuthForm>
  )
}
