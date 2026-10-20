import type { InvitationId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ParleyMark } from "../components/logo.tsx"
import { Button, ErrorText, Skeleton } from "../components/ui/index.ts"
import { AuthHeading, AuthPage, LinkButton } from "../components/ui/public.tsx"
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

  const signedInAs = (
    <p className="m-0 text-sm text-muted">
      Signed in as {user.email}. <LinkButton onClick={() => void switchAccount()}>Use another account</LinkButton>
    </p>
  )

  return (
    <AuthPage>
      <ParleyMark className="h-8 self-start" />
      {invitation.isPending ? (
        <Skeleton className="w-60" />
      ) : invitation.isError ? (
        <>
          <AuthHeading title="This invitation doesn't work">{messageOf(invitation.error)}</AuthHeading>
          {signedInAs}
        </>
      ) : invitation.data.status !== "pending" ? (
        <AuthHeading title={`This invitation has ${invitation.data.status === "accepted" ? "been used" : "expired"}`}>
          Ask whoever invited you to {invitation.data.teamName} to send a new one.
        </AuthHeading>
      ) : (
        <>
          <AuthHeading title={`Join ${invitation.data.teamName}`}>
            {invitation.data.invitedBy ?? "Someone"} invited you to {invitation.data.teamName} on Parley.
          </AuthHeading>
          {error ? <ErrorText className="text-base">{error}</ErrorText> : null}
          {unverified ? (
            resent ? (
              <p className="m-0 text-sm text-muted">We sent a new link to {user.email}. It brings you back here.</p>
            ) : (
              <Button size="lg" wide onClick={() => void resend()}>
                Email me the link again
              </Button>
            )
          ) : null}
          <Button variant="primary" size="lg" wide disabled={busy} onClick={() => void accept()}>
            Accept invitation
          </Button>
          {signedInAs}
        </>
      )}
    </AuthPage>
  )
}
