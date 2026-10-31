import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { CoreLive } from "../src/index.ts"
import { proveMemberOf } from "../src/proofs/member-of.ts"
import { proveCanReadRecords } from "../src/proofs/permissions.ts"
import { named } from "../src/proofs/proof.ts"
import { Fixture } from "./fixture.ts"

describe("named values", () => {
  it.effect("reads values while their effect runs and expires retained closures afterward", () =>
    Effect.gen(function* () {
      const retained = yield* named("team-a", (team) =>
        Effect.sync(() => {
          expect(team.value).toBe("team-a")
          return () => team.value
        }),
      )
      expect(retained).toThrow("Named value used outside its Effect execution")
    }),
  )

  it.effect("expires named values when the effect fails", () =>
    Effect.gen(function* () {
      let retained = () => "not acquired"
      const outcome = yield* named("team-a", (team) =>
        Effect.gen(function* () {
          retained = () => team.value
          return yield* Effect.fail("refused")
        }),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(outcome)).toBe(true)
      expect(retained).toThrow("Named value used outside its Effect execution")
    }),
  )

  it.effect("expires named values when constructing the callback's effect throws", () =>
    Effect.gen(function* () {
      let retained = () => "not acquired"
      const outcome = yield* named("team-a", (team): Effect.Effect<never> => {
        retained = () => team.value
        throw new Error("callback defect")
      }).pipe(Effect.exit)
      expect(Exit.isFailure(outcome)).toBe(true)
      expect(retained).toThrow("Named value used outside its Effect execution")
    }),
  )

  it.effect("expires named values when the effect is interrupted", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<() => string>()
      const fiber = yield* named("team-a", (team) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(ready, () => team.value)
          return yield* Effect.never
        }),
      ).pipe(Effect.forkChild)
      const retained = yield* Deferred.await(ready)
      expect(retained()).toBe("team-a")
      yield* Fiber.interrupt(fiber)
      expect(retained).toThrow("Named value used outside its Effect execution")
    }),
  )

  it.effect("allocates independent named values for each execution of the same effect", () =>
    Effect.gen(function* () {
      const work = named("team-a", (team) => Effect.sync(() => () => team.value))
      const first = yield* work
      const second = yield* work
      expect(first).not.toBe(second)
      expect(first).toThrow("Named value used outside its Effect execution")
      expect(second).toThrow("Named value used outside its Effect execution")
    }),
  )

  it.effect("keeps outer named values live until the outer effect completes", () =>
    Effect.gen(function* () {
      const retained = yield* named("team-a", (team) =>
        Effect.gen(function* () {
          const contact = yield* named("contact-a", (contact) => Effect.sync(() => () => contact.value))
          expect(contact).toThrow("Named value used outside its Effect execution")
          expect(team.value).toBe("team-a")
          return () => team.value
        }),
      )
      expect(retained).toThrow("Named value used outside its Effect execution")
    }),
  )
})

describe("proofs", () => {
  it.effect("freezes checked facts and expires both the kind and carried fields", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const retained = yield* named(f.jane, f.acme, (principal, team) =>
        Effect.gen(function* () {
          const member = yield* proveMemberOf(principal, team)
          const read = yield* proveCanReadRecords(member)
          expect(read.kind).toBe("CanReadRecords")
          expect(read.member.role).toBe("owner")
          expect(() => Object.assign(member, { role: "member" })).toThrow()
          expect(() => Object.assign(read, { kind: "CanWriteRecords" })).toThrow()
          return { kind: () => read.kind, role: () => read.member.role }
        }),
      )
      expect(retained.kind).toThrow("Named value used outside its Effect execution")
      expect(retained.role).toThrow("Named value used outside its Effect execution")
    }).pipe(Effect.provide(CoreLive)),
  )
})
