import { DisplayName, type DomainError, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { EmailStyleId } from "../ids.ts"

/** No email style with that id in this team. */
export class EmailStyleNotFound
  extends Schema.TaggedError<EmailStyleNotFound>()("EmailStyleNotFound", {
    team: DisplayName.schema,
    styleId: EmailStyleId,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `email style ${this.styleId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that email style in ${this.team}. It may have been deleted.`
  }
}

/** Templates or draft campaigns still use the style, so deleting it would change how they look. */
export class EmailStyleInUse
  extends Schema.TaggedError<EmailStyleInUse>()("EmailStyleInUse", {
    style: DisplayName.schema,
    templates: Schema.Number,
    campaigns: Schema.Number,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `email style in use by ${this.templates} templates and ${this.campaigns} campaigns`
  }
  get userMessage() {
    return userText`${this.style} is still used by ${this.templates} templates and ${this.campaigns} draft campaigns. Choose another style for them first.`
  }
}

/** The team's default style can't be deleted; another must be made the default first. */
export class EmailStyleIsDefault
  extends Schema.TaggedError<EmailStyleIsDefault>()("EmailStyleIsDefault", { style: DisplayName.schema })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "cannot delete the default email style"
  }
  get userMessage() {
    return userText`${this.style} is your team's default email style. Make another style the default before deleting it.`
  }
}

/** Custom HTML without a {{content}} slot would send emails with no body. */
export class CustomHtmlMissingContent
  extends Schema.TaggedError<CustomHtmlMissingContent>()("CustomHtmlMissingContent", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "custom html has no {{content}} slot"
  }
  get userMessage() {
    return userText`Your custom HTML needs {{content}} where the email's body should go.`
  }
}
