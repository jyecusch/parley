import { DisplayName, type DomainError, EchoedInput, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { InvitationId, UserId } from "../ids.ts"

/** No person with that id is a member of this team. */
export class MemberNotFound
  extends Schema.TaggedError<MemberNotFound>()("MemberNotFound", { team: DisplayName.schema, userId: UserId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `user ${this.userId} is not a member of the team`
  }
  get userMessage() {
    return userText`That person isn't a member of ${this.team}. They may have left already.`
  }
}

/** The change would leave the team without an owner (D36). */
export class LastOwner
  extends Schema.TaggedError<LastOwner>()("LastOwner", { team: DisplayName.schema })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "change would leave the team without an owner"
  }
  get userMessage() {
    return userText`${this.team} needs at least one owner. Make someone else an owner first.`
  }
}

/** Only an owner can make someone an owner, or change or remove an owner. */
export class OwnerChangeNeedsOwner
  extends Schema.TaggedError<OwnerChangeNeedsOwner>()("OwnerChangeNeedsOwner", { team: DisplayName.schema })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "owner change attempted by a non-owner"
  }
  get userMessage() {
    return userText`Only an owner of ${this.team} can make someone an owner, or change or remove an owner.`
  }
}

/** The person is already in the team, so there's nothing to invite them to. */
export class AlreadyAMember
  extends Schema.TaggedError<AlreadyAMember>()("AlreadyAMember", {
    team: DisplayName.schema,
    email: EchoedInput.schema,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "invitee is already a member"
  }
  get userMessage() {
    return userText`${this.email} is already a member of ${this.team}.`
  }
}

/** No invitation with that id, or it was revoked. */
export class InvitationNotFound
  extends Schema.TaggedError<InvitationNotFound>()("InvitationNotFound", { invitationId: InvitationId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `invitation ${this.invitationId} not found`
  }
  get userMessage() {
    return userText`This invitation doesn't exist or was withdrawn. Ask whoever invited you to send a new one.`
  }
}

/** The invitation is past its expiry, or was already used. */
export class InvitationExpired
  extends Schema.TaggedError<InvitationExpired>()("InvitationExpired", { used: Schema.Boolean })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return this.used ? "invitation already accepted" : "invitation expired"
  }
  get userMessage() {
    return this.used
      ? userText`This invitation has already been used. Sign in to see your teams.`
      : userText`This invitation has expired. Ask whoever invited you to send a new one.`
  }
}

/** The invitation was sent to a different email address than the signed-in person's. */
export class InvitationForAnotherEmail
  extends Schema.TaggedError<InvitationForAnotherEmail>()("InvitationForAnotherEmail", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "invitation addressed to another email"
  }
  get userMessage() {
    return userText`This invitation was sent to a different email address. Sign in with the address it was sent to.`
  }
}

/** Only someone who proved they own the invited address may accept: confirm it first. */
export class EmailNotVerified
  extends Schema.TaggedError<EmailNotVerified>()("EmailNotVerified", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "email address not verified"
  }
  get userMessage() {
    return userText`Confirm your email address first, using the link we emailed you when you signed up. Then open this invitation again.`
  }
}
