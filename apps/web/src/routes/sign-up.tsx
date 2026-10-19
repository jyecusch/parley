import type { UserText } from "@parley/errors"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { AuthForm, Field } from "../components/auth-form.tsx"
import { signUp } from "../lib/auth.ts"

export const Route = createFileRoute("/sign-up")({ ssr: false, component: SignUp })

function SignUp() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const submit = async (form: FormData) => {
    setBusy(true)
    const failure = await signUp(String(form.get("name")), String(form.get("email")), String(form.get("password")))
    setBusy(false)
    if (failure) return setError(failure)
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
          Already have an account? <Link to="/sign-in">Sign in</Link>
        </>
      }
    >
      <Field label="Name" name="name" autoComplete="name" autoFocus />
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field label="Password" name="password" type="password" autoComplete="new-password" />
    </AuthForm>
  )
}
