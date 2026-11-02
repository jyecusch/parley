import { type DomainError, userText } from "@parley/errors"
import { Duration, Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"

/** Too many requests from one API key, connection or team in a short time (D47). */
export class RequestsTooFrequent
  extends Schema.TaggedError<RequestsTooFrequent>()("RequestsTooFrequent", { retryAfter: Schema.Duration })
  implements DomainError
{
  readonly isRetryable = true
  override readonly [ErrorReporter.severity] = "Warn" as const
  override get message() {
    return `rate limited for ${Duration.format(this.retryAfter)}`
  }
  get userMessage() {
    const seconds = Math.max(1, Math.ceil(Duration.toSeconds(this.retryAfter)))
    return userText`Too many requests in a short time. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`
  }
}

/** The database refused or dropped the connection, the pool was exhausted, or a statement timed out. */
export class DatabaseUnavailable
  extends Schema.TaggedError<DatabaseUnavailable>()("DatabaseUnavailable", { cause: Schema.Defect() })
  implements DomainError
{
  readonly isRetryable = true
  override readonly [ErrorReporter.severity] = "Warn" as const
  override get message() {
    return `database unavailable: ${String(this.cause)}`
  }
  get userMessage() {
    return userText`Parley couldn't complete a database request. If you were making a change, check whether it went through before trying again.`
  }
}

export const InfrastructureErrors = [RequestsTooFrequent, DatabaseUnavailable] as const
