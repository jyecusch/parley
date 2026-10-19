import { DisplayName, type DomainError, EchoedInput, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { ContactId } from "../ids.ts"

/**
 * No contact with that id in this team that isn't deleted. Also returned when the id belongs to
 * another team (D37) and when restoring a contact that has been purged.
 */
export class ContactNotFound
  extends Schema.TaggedError<ContactNotFound>()("ContactNotFound", { team: DisplayName.schema, contactId: ContactId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `contact ${this.contactId} not found in team`
  }
  get userMessage() {
    return userText`We can't find this contact in ${this.team}. It may have been deleted. Search contacts to find who you're looking for.`
  }
}

/** Another contact in the team already has this email address (D24). Also possible on restore. */
export class ContactEmailTaken
  extends Schema.TaggedError<ContactEmailTaken>()("ContactEmailTaken", {
    team: DisplayName.schema,
    email: EchoedInput.schema,
    existing: ContactId,
    existingName: DisplayName.schema,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `email already used by contact ${this.existing}`
  }
  get userMessage() {
    return userText`${this.email} is already used by ${this.existingName} in ${this.team}. Open ${this.existingName} to update it there, or use a different email.`
  }
}
