import { type Member, ROLE_PERMISSIONS, type Role, type TeamId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { InfoIcon, MembersIcon } from "../components/icons.tsx"
import {
  Dialog,
  Empty,
  initialsOf,
  LoadFailed,
  LoadingRows,
  SettingsPage,
  useToast,
  When,
} from "../components/settings.tsx"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/members")({ component: Members })

const team = getRouteApi("/t/$teamId")

const ROLES: ReadonlyArray<{ readonly role: Role; readonly label: string; readonly description: string }> = [
  { role: "member", label: "Member", description: "Works with contacts and companies." },
  { role: "admin", label: "Admin", description: "Also manages custom fields, members and service accounts." },
  { role: "owner", label: "Owner", description: "Also renames the team and changes its settings." },
]
const roleLabel = (role: Role) => ROLES.find((entry) => entry.role === role)?.label ?? role

function Members() {
  const { team: current } = team.useLoaderData()
  const { userId } = team.useRouteContext()
  const teamId = current.id as TeamId
  const canManage = ROLE_PERMISSIONS[current.role].has("members:manage")
  const isOwner = current.role === "owner"
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [toast, showToast] = useToast()
  const [inviting, setInviting] = useState(false)
  const [confirming, setConfirming] = useState<string>()
  const members = useQuery({ queryKey: ["members", teamId], queryFn: () => call("members.list", { teamId }) })
  const invitations = useQuery({
    queryKey: ["invitations", teamId],
    queryFn: () => call("invitations.list", { teamId }),
    enabled: canManage,
  })
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["members", teamId] }),
      queryClient.invalidateQueries({ queryKey: ["invitations", teamId] }),
    ])

  const changeRole = async (member: Member, role: Role) => {
    try {
      await call("members.update", { teamId, userId: member.userId, role })
      showToast(
        `${member.name} is now ${roleLabel(role).toLowerCase() === "admin" ? "an admin" : `a ${roleLabel(role).toLowerCase()}`}.`,
      )
    } catch (failure) {
      showToast(messageOf(failure))
    }
    await refresh()
  }

  const remove = async (member: Member) => {
    setConfirming(undefined)
    try {
      await call("members.remove", { teamId, userId: member.userId })
      if (member.userId === userId) {
        await navigate({ to: "/" })
        return
      }
      showToast(`${member.name} is removed from ${current.name}.`)
    } catch (failure) {
      showToast(messageOf(failure))
    }
    await refresh()
  }

  return (
    <SettingsPage
      title="Members"
      intro={`The people in ${current.name}. Everyone sees every contact and company; roles decide what they can change.`}
      action={
        canManage ? (
          <button className="btn primary sm" type="button" onClick={() => setInviting(true)}>
            Invite people
          </button>
        ) : null
      }
    >
      {canManage ? null : (
        <div className="notice">
          <span className="ic">
            <InfoIcon />
          </span>
          <span>Only admins and owners can invite people or change roles.</span>
        </div>
      )}
      {members.isPending ? (
        <LoadingRows />
      ) : members.isError ? (
        <LoadFailed
          title="Members didn't load"
          message={messageOf(members.error)}
          onRetry={() => void members.refetch()}
        />
      ) : (
        <div className="box">
          <table className="stable">
            <thead>
              <tr>
                <th scope="col" style={{ width: "40%" }}>
                  Name
                </th>
                <th scope="col" style={{ width: 150 }}>
                  Role
                </th>
                <th scope="col" style={{ width: 96 }}>
                  Joined
                </th>
                <th scope="col">
                  <span className="vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.data.map((member) => {
                const isYou = member.userId === userId
                // Owners are only changed by owners; everyone can leave.
                const editable = canManage && !isYou && (member.role !== "owner" || isOwner)
                return (
                  <tr key={member.userId}>
                    <td>
                      <div className="who">
                        <span className="av md" aria-hidden="true">
                          {initialsOf(member.name)}
                        </span>
                        <span className="stack">
                          <span className="n">
                            {member.name}
                            {isYou ? <span className="c-muted"> (you)</span> : null}
                          </span>
                          <span className="s sm-t">{member.email}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      {editable ? (
                        <select
                          className="fsel"
                          aria-label={`Role of ${member.name}`}
                          value={member.role}
                          onChange={(event) => void changeRole(member, event.target.value as Role)}
                        >
                          {ROLES.filter((entry) => entry.role !== "owner" || isOwner).map((entry) => (
                            <option key={entry.role} value={entry.role}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="c-muted">{roleLabel(member.role)}</span>
                      )}
                    </td>
                    <td>
                      <When at={member.joinedAt} />
                    </td>
                    <td className="c-act">
                      {confirming === member.userId ? (
                        <span className="confirm">
                          <button className="btn sm ghost" type="button" onClick={() => setConfirming(undefined)}>
                            Cancel
                          </button>
                          <button className="btn sm danger-solid" type="button" onClick={() => void remove(member)}>
                            {isYou ? "Leave" : "Remove"}
                          </button>
                        </span>
                      ) : isYou || editable ? (
                        <button className="btn sm danger" type="button" onClick={() => setConfirming(member.userId)}>
                          {isYou ? "Leave team" : "Remove"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (invitations.data?.length ?? 0) > 0 ? (
        <>
          <div className="intro">
            <h2>Invited</h2>
            <p>People who haven't accepted yet. Invitations work for 7 days.</p>
          </div>
          <div className="box">
            <table className="stable">
              <tbody>
                {invitations.data?.map((invitation) => (
                  <tr key={invitation.id}>
                    <td style={{ width: "40%" }}>
                      <div className="who">
                        <span className="av md" aria-hidden="true">
                          {invitation.email[0]?.toUpperCase()}
                        </span>
                        <span className="stack">
                          <span className="n">{invitation.email}</span>
                          <span className="s sm-t">Invited by {invitation.invitedBy ?? "someone"}</span>
                        </span>
                      </div>
                    </td>
                    <td className="c-muted" style={{ width: 150 }}>
                      {roleLabel(invitation.role)}
                    </td>
                    <td className="c-act">
                      <span className="confirm">
                        <button
                          className="btn sm ghost"
                          type="button"
                          onClick={async () => {
                            try {
                              await call("invitations.create", {
                                teamId,
                                email: invitation.email as never,
                                role: invitation.role,
                              })
                              showToast(`A fresh link is on its way to ${invitation.email}.`)
                            } catch (failure) {
                              showToast(messageOf(failure))
                            }
                            await refresh()
                          }}
                        >
                          Resend
                        </button>
                        <button
                          className="btn sm danger"
                          type="button"
                          onClick={async () => {
                            try {
                              await call("invitations.revoke", { teamId, invitationId: invitation.id })
                              showToast(`The invitation to ${invitation.email} is withdrawn.`)
                            } catch (failure) {
                              showToast(messageOf(failure))
                            }
                            await refresh()
                          }}
                        >
                          Withdraw
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : members.isSuccess && members.data.length === 1 && canManage ? (
        <Empty icon={<MembersIcon />} title="Just you so far">
          Invite your team. They get an email with a link to join {current.name}.
        </Empty>
      ) : null}

      {inviting ? (
        <InviteDialog
          teamId={teamId}
          isOwner={isOwner}
          onClose={() => setInviting(false)}
          onInvited={async (email) => {
            setInviting(false)
            showToast(`An invitation is on its way to ${email}.`)
            await refresh()
          }}
        />
      ) : null}
      {toast}
    </SettingsPage>
  )
}

function InviteDialog(props: {
  readonly teamId: TeamId
  readonly isOwner: boolean
  readonly onClose: () => void
  readonly onInvited: (email: string) => Promise<void>
}) {
  const [emails, setEmails] = useState("")
  const [role, setRole] = useState<Role>("member")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const list = emails
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean)

  const invite = async () => {
    setBusy(true)
    setError(undefined)
    for (const email of list) {
      try {
        await call("invitations.create", { teamId: props.teamId, email: email as never, role })
      } catch (failure) {
        setError(messageOf(failure))
        setBusy(false)
        return
      }
    }
    await props.onInvited(list.join(", "))
  }

  return (
    <Dialog
      title="Invite people"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy || list.length === 0}
            onClick={() => void invite()}
          >
            {list.length > 1 ? `Send ${list.length} invitations` : "Send invitation"}
          </button>
        </>
      }
    >
      <div className="fld">
        <label className="fl" htmlFor="invite-emails">
          Email addresses
        </label>
        <textarea
          id="invite-emails"
          className="note-inp"
          rows={3}
          placeholder="sam@acme.com, priya@acme.com"
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
        />
        <p className="hint sm-t">Separate addresses with commas or spaces. Each gets a link that works for 7 days.</p>
      </div>
      <fieldset className="fld">
        <legend>Role</legend>
        <div className="radios">
          {ROLES.filter((entry) => entry.role !== "owner" || props.isOwner).map((entry) => (
            <label key={entry.role} className={`ropt ${role === entry.role ? "on" : ""}`}>
              <input
                className="rd"
                type="radio"
                name="invite-role"
                checked={role === entry.role}
                onChange={() => setRole(entry.role)}
              />
              <span className="t">
                <span className="n">{entry.label}</span>
                <span className="d sm-t">{entry.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
