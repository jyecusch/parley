import type { UserText } from "@parley/errors"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { AuthForm, Field } from "../components/auth-form.tsx"
import { getSession } from "../lib/auth.ts"
import { call, isApiFailure, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/new-team")({
  ssr: false,
  beforeLoad: async () => {
    if (!(await getSession())) throw redirect({ to: "/sign-in" })
  },
  component: NewTeam,
})

function NewTeam() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const submit = async (form: FormData) => {
    setBusy(true)
    try {
      const team = await call("teams.create", { name: String(form.get("name")).trim() })
      await navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id } })
    } catch (failure) {
      setBusy(false)
      setError(isApiFailure(failure) ? failure.error.userMessage : messageOf(failure))
    }
  }
  return (
    <AuthForm
      title="Name your team"
      intro="A team holds your contacts and companies. You can invite people and connect agents later."
      submitLabel="Create team"
      busy={busy}
      error={error}
      onSubmit={submit}
      footer="You'll be the team's owner."
    >
      <Field label="Team name" name="name" autoComplete="organization" autoFocus />
    </AuthForm>
  )
}
