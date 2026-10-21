import { Schema } from "effect"
import { Role } from "./access.ts"
import { InvitationId, UserId } from "./ids.ts"

const Timestamp = Schema.String.annotate({ description: "ISO 8601 timestamp" })

/** A person in a team. Service accounts are listed separately (serviceAccounts.list). */
export const Member = Schema.Struct({
  userId: UserId,
  name: Schema.String,
  email: Schema.String,
  role: Role,
  joinedAt: Timestamp,
})
export type Member = typeof Member.Type

/** An invitation to join a team, sent by email. */
export const Invitation = Schema.Struct({
  id: InvitationId,
  email: Schema.String,
  role: Role,
  status: Schema.Literals(["pending", "accepted", "declined", "revoked", "expired"]),
  invitedBy: Schema.NullOr(Schema.String),
  teamName: Schema.String,
  createdAt: Timestamp,
  expiresAt: Timestamp,
})
export type Invitation = typeof Invitation.Type

export const InvitableRole = Role.annotate({
  title: "Role",
  description: 'Defaults to "member". Only an owner can invite an owner.',
})
