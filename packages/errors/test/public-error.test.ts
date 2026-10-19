import { describe, expect, it } from "@effect/vitest"
import { Duration, Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import {
  DisplayName,
  type DomainError,
  defectPublicError,
  PublicError,
  ReferenceId,
  toPublicError,
  userText,
} from "../src/index.ts"

class Throttled
  extends Schema.TaggedError<Throttled>()("Throttled", {
    team: DisplayName.schema,
    retryAfter: Schema.optional(Schema.Duration),
  })
  implements DomainError
{
  readonly isRetryable = true
  override readonly [ErrorReporter.severity] = "Warn" as const
  override get message() {
    return `throttled for ${this.team}`
  }
  get userMessage() {
    return userText`${this.team} is sending too many requests. Try again shortly.`
  }
}

describe("toPublicError", () => {
  it("keeps only the public fields and names the wait in millis", () => {
    const error = new Throttled({ team: DisplayName.fromRecord("Acme"), retryAfter: Duration.seconds(2) })
    expect(toPublicError(error)).toEqual({
      _tag: "Throttled",
      userMessage: "Acme is sending too many requests. Try again shortly.",
      isRetryable: true,
      retryAfterMillis: 2000,
    })
  })

  it("drops an infinite wait", () => {
    const error = new Throttled({ team: DisplayName.fromRecord("Acme"), retryAfter: Duration.infinity })
    expect(toPublicError(error).retryAfterMillis).toBeUndefined()
  })

  it("produces something the PublicError schema accepts", () => {
    const error = new Throttled({ team: DisplayName.fromRecord("Acme") })
    expect(Schema.is(PublicError)(toPublicError(error, { hint: 1 }))).toBe(true)
  })
})

describe("defectPublicError", () => {
  it("carries only the reference id", () => {
    const referenceId = ReferenceId.make()
    const publicError = defectPublicError(referenceId)
    expect(publicError._tag).toBe("InternalDefect")
    expect(publicError.details).toEqual({ referenceId })
    expect(publicError.userMessage).toContain(referenceId)
    expect(referenceId).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  })
})
