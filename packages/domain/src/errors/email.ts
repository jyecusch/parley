import { type DomainError, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"

/**
 * The email service couldn't be reached or failed on its side. Acceptance may be unknown; retry only with a durable idempotency key.
 * User messages never name the provider (Q-E8): self-hosters may use a different one.
 */
export class EmailServiceUnavailable
  extends Schema.TaggedError<EmailServiceUnavailable>()("EmailServiceUnavailable", { cause: Schema.Defect() })
  implements DomainError
{
  readonly isRetryable = true
  override readonly [ErrorReporter.severity] = "Warn" as const
  override get message() {
    return "email service unavailable"
  }
  get userMessage() {
    return userText`Parley couldn't confirm whether its email service accepted this email. Check its status before sending again.`
  }
}

/** The email service turned the message down, usually because the sending address or domain isn't verified. */
export class EmailRejected
  extends Schema.TaggedError<EmailRejected>()("EmailRejected", { reason: Schema.String })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Warn" as const
  override get message() {
    return `email rejected: ${this.reason}`
  }
  get userMessage() {
    return userText`The email service refused this email, so nothing was sent. Your Parley administrator may need to verify the sending address.`
  }
}

/** The email service is limiting how fast this instance sends. */
export class EmailSendingTooFast
  extends Schema.TaggedError<EmailSendingTooFast>()("EmailSendingTooFast", { retryAfter: Schema.Duration })
  implements DomainError
{
  readonly isRetryable = true
  override readonly [ErrorReporter.severity] = "Warn" as const
  override get message() {
    return "email service rate limit"
  }
  get userMessage() {
    return userText`Parley is sending email faster than its email service allows. Try again in a minute.`
  }
}

/** This Parley instance has no email service set up, so it can't send. */
export class EmailNotConfigured
  extends Schema.TaggedError<EmailNotConfigured>()("EmailNotConfigured", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Warn" as const
  override get message() {
    return "no email service configured"
  }
  get userMessage() {
    return userText`This Parley instance can't send email yet. Your Parley administrator needs to set up an email service.`
  }
}

/** A batch can no longer be replayed within the provider's duplicate protection guarantees. */
export class EmailBatchReplayUnsafe
  extends Schema.TaggedError<EmailBatchReplayUnsafe>()("EmailBatchReplayUnsafe", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Warn" as const
  override get message() {
    return "email batch replay is unsafe"
  }
  get userMessage() {
    return userText`The email service may have accepted this email. Automatic retries stopped to avoid sending it twice.`
  }
}

export const EmailErrors = [EmailServiceUnavailable, EmailRejected, EmailSendingTooFast, EmailNotConfigured] as const
export type EmailError = EmailServiceUnavailable | EmailRejected | EmailSendingTooFast | EmailNotConfigured
