import { type DomainError, UserText, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"

export const FieldProblemKind = Schema.Literals([
  "missing",
  "not-allowed",
  "wrong-type",
  "too-short",
  "too-long",
  "invalid-format",
  "out-of-range",
  "conflict",
])
export type FieldProblemKind = typeof FieldProblemKind.Type

export const FieldProblem = Schema.Struct({
  /** A key path in our input schema, such as "emails.0.address". */
  field: Schema.String,
  problem: FieldProblemKind,
  userMessage: UserText.schema,
})
export type FieldProblem = typeof FieldProblem.Type

/**
 * The request was well-formed but its content was rejected. Lists every field problem at once,
 * in our own words, and never echoes the rejected value (D26).
 */
export class InputRejected
  extends Schema.TaggedError<InputRejected>()("InputRejected", { problems: Schema.Array(FieldProblem) })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `input rejected: ${this.problems.map((p) => `${p.field} ${p.problem}`).join(", ")}`
  }
  get userMessage() {
    const [only] = this.problems
    if (this.problems.length === 1 && only) return only.userMessage
    const count = this.problems.length
    return userText`${count} fields need fixing before this can be saved.`
  }
}
