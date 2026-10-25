import { Schema } from "effect"
import { Role } from "../access.ts"
import { EmailAddress } from "../contact-values.ts"
import { SignInRequired } from "../errors/access.ts"
import { EmailErrors } from "../errors/email.ts"
import {
  AlreadyAMember,
  InvitationExpired,
  InvitationForAnotherEmail,
  InvitationNotFound,
  LastOwner,
  MemberNotFound,
  OwnerChangeNeedsOwner,
} from "../errors/members.ts"
import { ServiceAccountCannotBeOwner } from "../errors/service-accounts.ts"
import { InvitationId, TeamId, UserId } from "../ids.ts"
import { InvitableRole, Invitation, Member } from "../member.ts"
import { defineOperation, defineTeamOperation } from "../operation.ts"
import { Team } from "./teams.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneMember = { ...InTeam, userId: UserId.annotate({ description: "The member's user id, from members.list." }) }

export const listMembers = defineTeamOperation({
  name: "members.list",
  description:
    "List the people in a team with their roles, owners first. Service accounts are in serviceAccounts.list.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(Member),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/members" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: [],
})

export const updateMember = defineTeamOperation({
  name: "members.update",
  description:
    "Change a member's role. Needs members:manage; only an owner can make someone an owner or change an owner, and a team always keeps at least one owner.",
  input: Schema.Struct({ ...OneMember, role: Role.annotate({ title: "Role" }) }),
  output: Member,
  errors: [ServiceAccountCannotBeOwner, MemberNotFound, LastOwner, OwnerChangeNeedsOwner],
  http: { method: "PATCH", path: "/teams/:teamId/members/:userId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["members:manage"],
})

export const removeMember = defineTeamOperation({
  name: "members.remove",
  description:
    "Remove someone from a team, or leave it yourself. Their notes and activity stay. Needs members:manage to remove someone else; a team always keeps at least one owner.",
  input: Schema.Struct(OneMember),
  output: Member,
  errors: [SignInRequired, MemberNotFound, LastOwner, OwnerChangeNeedsOwner],
  http: { method: "DELETE", path: "/teams/:teamId/members/:userId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: [],
})

export const listInvitations = defineTeamOperation({
  name: "invitations.list",
  description: "List a team's pending invitations, newest first.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(Invitation),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/invitations" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["members:manage"],
})

export const createInvitation = defineTeamOperation({
  name: "invitations.create",
  description:
    "Invite someone to a team by email. They get a link that's good for 7 days. Inviting the same address again sends a fresh link.",
  input: Schema.Struct({
    ...InTeam,
    email: EmailAddress.annotate({ title: "Email" }),
    role: Schema.optional(InvitableRole),
  }),
  output: Invitation,
  errors: [AlreadyAMember, OwnerChangeNeedsOwner, ...EmailErrors],
  http: { method: "POST", path: "/teams/:teamId/invitations" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["members:manage"],
})

export const revokeInvitation = defineTeamOperation({
  name: "invitations.revoke",
  description: "Withdraw a pending invitation. Its link stops working.",
  input: Schema.Struct({
    ...InTeam,
    invitationId: InvitationId.annotate({ description: "The invitation's id, from invitations.list." }),
  }),
  output: Invitation,
  errors: [InvitationNotFound],
  http: { method: "POST", path: "/teams/:teamId/invitations/:invitationId/revoke" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["members:manage"],
})

export const getInvitation = defineOperation({
  name: "invitations.get",
  description: "See an invitation you were sent: which team, from whom, and whether it's still good.",
  input: Schema.Struct({ invitationId: InvitationId.annotate({ description: "From the invitation link." }) }),
  output: Invitation,
  errors: [InvitationNotFound, InvitationForAnotherEmail],
  http: { method: "GET", path: "/invitations/:invitationId" },
  hints: { readOnly: true, destructive: false, idempotent: true },
})

export const acceptInvitation = defineOperation({
  name: "invitations.accept",
  description:
    "Accept an invitation you were sent and join the team. Only a signed-in person can. Accepting also confirms your email address, since the invitation was sent to it.",
  input: Schema.Struct({ invitationId: InvitationId.annotate({ description: "From the invitation link." }) }),
  output: Team,
  errors: [SignInRequired, InvitationNotFound, InvitationExpired, InvitationForAnotherEmail],
  http: { method: "POST", path: "/invitations/:invitationId/accept" },
  hints: { readOnly: false, destructive: false, idempotent: true },
})

export const myInvitations = defineOperation({
  name: "invitations.mine",
  description:
    "Your pending invitations to join teams. Empty until you confirm your email address, so nobody can see invitations meant for an address they don't own.",
  input: Schema.Struct({}),
  output: Schema.Array(Invitation),
  errors: [SignInRequired],
  http: { method: "GET", path: "/invitations" },
  hints: { readOnly: true, destructive: false, idempotent: true },
})

export const declineInvitation = defineOperation({
  name: "invitations.decline",
  description: "Turn down an invitation you were sent. The team sees it's no longer pending.",
  input: Schema.Struct({ invitationId: InvitationId.annotate({ description: "From invitations.mine." }) }),
  output: Invitation,
  errors: [SignInRequired, InvitationNotFound, InvitationForAnotherEmail],
  http: { method: "POST", path: "/invitations/:invitationId/decline" },
  hints: { readOnly: false, destructive: true, idempotent: false },
})
