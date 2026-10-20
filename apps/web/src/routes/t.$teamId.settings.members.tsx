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
import {
  Avatar,
  Box,
  Button,
  ErrorText,
  Field,
  Fieldset,
  Notice,
  RadioCard,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
} from "../components/ui/index.ts"
import { RowActions, RowIdentity, SettingsSubIntro } from "../components/ui/settings-extra.tsx"
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
          <Button variant="primary" size="sm" onClick={() => setInviting(true)}>
            Invite people
          </Button>
        ) : null
      }
    >
      {canManage ? null : (
        <Notice icon={<InfoIcon />}>Only admins and owners can invite people or change roles.</Notice>
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
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col" className="w-[40%]">
                  Name
                </Th>
                <Th scope="col" className="w-44">
                  Role
                </Th>
                <Th scope="col" className="w-28">
                  Joined
                </Th>
                <Th scope="col">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {members.data.map((member) => {
                const isYou = member.userId === userId
                // Owners are only changed by owners; everyone can leave.
                const editable = canManage && !isYou && (member.role !== "owner" || isOwner)
                return (
                  <Tr key={member.userId}>
                    <Td>
                      <RowIdentity
                        mark={<Avatar size="md">{initialsOf(member.name)}</Avatar>}
                        name={
                          <>
                            {member.name}
                            {isYou ? <span className="font-normal text-subtle"> (you)</span> : null}
                          </>
                        }
                        sub={member.email}
                      />
                    </Td>
                    <Td>
                      {editable ? (
                        <Select
                          variant="inline"
                          aria-label={`Role of ${member.name}`}
                          value={member.role}
                          onChange={(event) => void changeRole(member, event.target.value as Role)}
                        >
                          {ROLES.filter((entry) => entry.role !== "owner" || isOwner).map((entry) => (
                            <option key={entry.role} value={entry.role}>
                              {entry.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-subtle">{roleLabel(member.role)}</span>
                      )}
                    </Td>
                    <Td>
                      <When at={member.joinedAt} />
                    </Td>
                    <Td className="text-right">
                      {confirming === member.userId ? (
                        <RowActions>
                          <Button size="sm" variant="ghost" onClick={() => setConfirming(undefined)}>
                            Cancel
                          </Button>
                          <Button size="sm" variant="danger-solid" onClick={() => void remove(member)}>
                            {isYou ? "Leave" : "Remove"}
                          </Button>
                        </RowActions>
                      ) : isYou || editable ? (
                        <Button size="sm" variant="danger" onClick={() => setConfirming(member.userId)}>
                          {isYou ? "Leave team" : "Remove"}
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        </Box>
      )}

      {canManage && (invitations.data?.length ?? 0) > 0 ? (
        <>
          <SettingsSubIntro title="Invited">
            People who haven't accepted yet. Invitations work for 7 days.
          </SettingsSubIntro>
          <Box>
            <Table kind="settings">
              <tbody>
                {invitations.data?.map((invitation) => (
                  <Tr key={invitation.id}>
                    <Td className="w-[40%]">
                      <RowIdentity
                        mark={<Avatar size="md">{invitation.email[0]?.toUpperCase()}</Avatar>}
                        name={invitation.email}
                        sub={`Invited by ${invitation.invitedBy ?? "someone"}`}
                      />
                    </Td>
                    <Td className="w-44 text-subtle">{roleLabel(invitation.role)}</Td>
                    <Td className="text-right">
                      <RowActions>
                        <Button
                          size="sm"
                          variant="ghost"
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
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
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
                        </Button>
                      </RowActions>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Box>
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
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || list.length === 0} onClick={() => void invite()}>
            {list.length > 1 ? `Send ${list.length} invitations` : "Send invitation"}
          </Button>
        </>
      }
    >
      <Field
        label="Email addresses"
        htmlFor="invite-emails"
        hint="Separate addresses with commas or spaces. Each gets a link that works for 7 days."
      >
        <Textarea
          id="invite-emails"
          rows={3}
          placeholder="sam@acme.com, priya@acme.com"
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
        />
      </Field>
      <Fieldset legend="Role">
        {ROLES.filter((entry) => entry.role !== "owner" || props.isOwner).map((entry) => (
          <RadioCard
            key={entry.role}
            name="invite-role"
            label={entry.label}
            description={entry.description}
            checked={role === entry.role}
            onChange={() => setRole(entry.role)}
          />
        ))}
      </Fieldset>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}
