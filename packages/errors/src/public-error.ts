import { Duration, Schema } from "effect"
import type * as Cause from "effect/Cause"
import * as ErrorReporter from "effect/ErrorReporter"
import { type ReferenceId, UserText, userText } from "./user-text.ts"

/** The only shape an error takes when it leaves the core. */
export const PublicError = Schema.Struct({
  _tag: Schema.String,
  userMessage: UserText.schema,
  isRetryable: Schema.Boolean,
  retryAfterMillis: Schema.optional(Schema.Number),
  details: Schema.optional(Schema.Unknown),
})
export type PublicError = typeof PublicError.Type

/** An expected error. Every error class in Parley implements this. */
export interface DomainError extends Cause.YieldableError {
  readonly _tag: string
  /** For logs only. May quote foreign text and ids. */
  readonly message: string
  /** For users and agents. */
  readonly userMessage: UserText
  /** Whether the same request, unchanged, might succeed. */
  readonly isRetryable: boolean
  /** Set only when the other side said how long to wait. */
  readonly retryAfter?: Duration.Duration | undefined
  readonly [ErrorReporter.severity]: "Info" | "Warn"
}

/** The only way an error crosses an entrypoint. */
export const toPublicError = (error: DomainError, details?: unknown): PublicError => {
  const retryAfter = error.retryAfter
  return {
    _tag: error._tag,
    userMessage: error.userMessage,
    isRetryable: error.isRetryable,
    ...(retryAfter !== undefined && Duration.isFinite(retryAfter)
      ? { retryAfterMillis: Duration.toMillis(retryAfter) }
      : {}),
    ...(details !== undefined ? { details } : {}),
  }
}

/** What every entrypoint sends for a defect. Nothing from the defect itself leaves the server. */
export const defectPublicError = (referenceId: ReferenceId): PublicError => ({
  _tag: "InternalDefect",
  userMessage: userText`Something on our side failed, and nothing was changed. Try again. If it keeps happening, share reference ${referenceId} with your Parley administrator.`,
  isRetryable: false,
  details: { referenceId },
})
