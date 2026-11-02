import { describe, expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { HttpServerResponse } from "effect/http"
import { respondToFailures } from "../src/respond.ts"

describe("defects after a completed side effect", () => {
  it.effect("keeps the side effect and gives safe guidance without promising rollback", () =>
    Effect.gen(function* () {
      const changed = yield* Ref.make(false)
      const response = yield* respondToFailures(
        Ref.set(changed, true).pipe(Effect.andThen(Effect.die(new Error("private diagnostic marker")))),
      )
      expect(yield* Ref.get(changed)).toBe(true)
      const web = HttpServerResponse.toWeb(response)
      expect(web.status).toBe(500)
      const body = yield* Effect.tryPromise(() => web.json()).pipe(Effect.orDie)
      expect(body.error._tag).toBe("InternalDefect")
      expect(body.error.isRetryable).toBe(false)
      expect(body.error.details.referenceId).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
      expect(body.error.userMessage).toContain(body.error.details.referenceId)
      expect(body.error.userMessage).toContain("check whether it went through before trying again")
      expect(JSON.stringify(body)).not.toContain("private diagnostic marker")
      expect(body.error.userMessage).not.toContain("nothing was changed")
    }),
  )
})
