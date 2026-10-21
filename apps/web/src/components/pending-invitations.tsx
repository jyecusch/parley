import type { Invitation, InvitationId, Team } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { Button, ErrorText, Hint } from "./ui/index.ts"

const KEY = ["my-invitations"] as const

/** The signed-in person's pending invitations: empty until their address is confirmed (D131). */
export const usePendingInvitations = () =>
  useQuery({ queryKey: KEY, queryFn: () => call("invitations.mine", {}), staleTime: 60_000 })

/**
 * Pending invitations, each with Join and Decline (D131). `onJoined` gets the team joined, to go
 * to it.
 */
export function PendingInvitations(props: {
  readonly invitations: ReadonlyArray<Invitation>
  readonly onJoined: (team: Team) => void
  readonly compact?: boolean
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<InvitationId>()
  const [error, setError] = useState<UserText>()
  const act = async (invitation: Invitation, action: "join" | "decline") => {
    setBusy(invitation.id)
    setError(undefined)
    try {
      if (action === "join") {
        const team = await call("invitations.accept", { invitationId: invitation.id })
        await queryClient.invalidateQueries({ queryKey: KEY })
        props.onJoined(team)
      } else {
        await call("invitations.decline", { invitationId: invitation.id })
        await queryClient.invalidateQueries({ queryKey: KEY })
      }
    } catch (failure) {
      setError(messageOf(failure))
    }
    setBusy(undefined)
  }
  return (
    <div className="flex flex-col gap-2">
      {props.invitations.map((invitation) => (
        <div
          key={invitation.id}
          className={
            props.compact
              ? "flex items-center gap-2 px-2.5 py-1.5"
              : "flex items-center gap-3 rounded-lg px-3.5 py-3 inset-ring inset-ring-line-strong"
          }
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{invitation.teamName}</span>
            <span className="truncate text-sm text-subtle">
              {invitation.invitedBy ? `${invitation.invitedBy} invited you` : "You're invited"}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== undefined}
            onClick={() => void act(invitation, "decline")}
          >
            Decline
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy !== undefined}
            onClick={() => void act(invitation, "join")}
          >
            {busy === invitation.id ? "Joining…" : "Join"}
          </Button>
        </div>
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {props.compact ? null : <Hint>Or create a team of your own below.</Hint>}
    </div>
  )
}
