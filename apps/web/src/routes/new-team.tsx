import type { UserText } from "@parley/errors"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { AuthForm, Field } from "../components/auth-form.tsx"
import { PendingInvitations, usePendingInvitations } from "../components/pending-invitations.tsx"
import { agentRequest, getSession, withAgentRequest } from "../lib/auth.ts"
import { call, isApiFailure, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/new-team")({
  ssr: false,
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) throw redirect({ to: "/sign-in" })
    return { emailVerified: session.user.emailVerified }
  },
  component: NewTeam,
})

function NewTeam() {
  const navigate = useNavigate()
  const { emailVerified } = Route.useRouteContext()
  // Invitations waiting for this person: join one instead of creating a team (D131).
  const invitations = usePendingInvitations().data ?? []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const submit = async (form: FormData) => {
    setBusy(true)
    try {
      const team = await call("teams.create", { name: String(form.get("name")).trim() })
      // An agent is waiting to connect: go back to its consent page, now that there's a team.
      if (agentRequest()) return window.location.assign(withAgentRequest("/connect"))
      await navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id } })
    } catch (failure) {
      setBusy(false)
      setError(isApiFailure(failure) ? failure.error.userMessage : messageOf(failure))
    }
  }
  return (
    <AuthForm
      title={invitations.length > 0 ? "Join a team, or create one" : "Name your team"}
      intro={
        invitations.length > 0
          ? `You've been invited to ${invitations.length === 1 ? "a team" : `${invitations.length} teams`}.`
          : agentRequest()
            ? "A team holds your contacts and companies. Create one, then choose what your agent can do in it."
            : "A team holds your contacts and companies. You can invite people and connect agents later."
      }
      before={
        invitations.length > 0 ? (
          <PendingInvitations
            invitations={invitations}
            onJoined={(team) =>
              agentRequest()
                ? window.location.assign(withAgentRequest("/connect"))
                : void navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id } })
            }
          />
        ) : null
      }
      submitLabel="Create team"
      busy={busy}
      error={error}
      onSubmit={submit}
      footer={
        emailVerified
          ? "You'll be the team's owner."
          : "You'll be the team's owner. Invited to a team? Open the invitation's link in your email, or confirm your email address to see your invitations here."
      }
    >
      <Field label="Team name" name="name" autoComplete="organization" autoFocus />
    </AuthForm>
  )
}
