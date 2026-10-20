import type { InvitationId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ParleyMark } from "../components/logo.tsx"
import { getSession, signOut } from "../lib/auth.ts"
import { call, isApiFailure, messageOf } from "../lib/client.ts"

/** Where an invitation email's link lands. Signed out, it goes through sign-in and comes back. */
export const Route = createFileRoute("/invite/$invitationId")({
  ssr: false,
  beforeLoad: async ({ params }) => {
    const session = await getSession()
    if (!session) throw redirect({ to: "/sign-in", search: { redirect: `/invite/${params.invitationId}` } })
    return { user: session.user }
  },
  component: Invite,
})

function Invite() {
  const { invitationId } = Route.useParams()
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const [unverified, setUnverified] = useState(false)
  const [resent, setResent] = useState(false)
  const invitation = useQuery({
    queryKey: ["invitation", invitationId],
    queryFn: () => call("invitations.get", { invitationId: invitationId as InvitationId }),
    retry: false,
  })

  const accept = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const team = await call("invitations.accept", { invitationId: invitationId as InvitationId })
      await navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id }, search: {} })
    } catch (failure) {
      setError(messageOf(failure))
      setUnverified(isApiFailure(failure) && failure.error._tag === "EmailNotVerified")
      setBusy(false)
    }
  }

  /** Sends the confirmation link again, coming back to this invitation once it's followed. */
  const resend = async () => {
    await fetch("/api/auth/send-verification-email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, callbackURL: `/invite/${invitationId}` }),
    }).catch(() => undefined)
    setResent(true)
  }

  const switchAccount = async () => {
    await signOut()
    await navigate({ to: "/sign-in", search: { redirect: `/invite/${invitationId}` } })
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <ParleyMark height={32} />
        {invitation.isPending ? (
          <div className="sk" style={{ width: 200 }} />
        ) : invitation.isError ? (
          <>
            <div>
              <h1>This invitation doesn't work</h1>
              <p>{messageOf(invitation.error)}</p>
            </div>
            <p className="sm-t">
              Signed in as {user.email}.{" "}
              <button className="linkish" type="button" onClick={() => void switchAccount()}>
                Use another account
              </button>
            </p>
          </>
        ) : invitation.data.status !== "pending" ? (
          <div>
            <h1>This invitation has {invitation.data.status === "accepted" ? "been used" : "expired"}</h1>
            <p>Ask whoever invited you to {invitation.data.teamName} to send a new one.</p>
          </div>
        ) : (
          <>
            <div>
              <h1>Join {invitation.data.teamName}</h1>
              <p>
                {invitation.data.invitedBy ?? "Someone"} invited you to {invitation.data.teamName} on Parley.
              </p>
            </div>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            {unverified ? (
              resent ? (
                <p className="sm-t">We sent a new link to {user.email}. It brings you back here.</p>
              ) : (
                <button className="btn wide" type="button" onClick={() => void resend()}>
                  Email me the link again
                </button>
              )
            ) : null}
            <button className="btn primary wide" type="button" disabled={busy} onClick={() => void accept()}>
              Accept invitation
            </button>
            <p className="sm-t">
              Signed in as {user.email}.{" "}
              <button className="linkish" type="button" onClick={() => void switchAccount()}>
                Use another account
              </button>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
