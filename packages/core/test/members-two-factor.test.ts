import { describe, expect, it } from "@effect/vitest"
import { Database, schema } from "@parley/db"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

describe("who uses two-factor authentication (D173)", () => {
  it.effect("is shown to owners and admins, and to nobody else", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const db = yield* Database
      yield* db.query((d) =>
        d.update(schema.user).set({ twoFactorEnabled: true }).where(eq(schema.user.id, f.sam.userId)),
      )

      const asOwner = yield* run["members.list"](f.jane, { teamId: f.acme })
      expect(asOwner.find((member) => member.userId === f.sam.userId)?.twoFactorEnabled).toBe(true)
      expect(asOwner.find((member) => member.userId === f.jane.userId)?.twoFactorEnabled).toBe(false)

      // Sam is a member: the same list, without anyone's status.
      const asMember = yield* run["members.list"](f.sam, { teamId: f.acme })
      expect(asMember.length).toBe(asOwner.length)
      expect(asMember.every((member) => !("twoFactorEnabled" in member))).toBe(true)

      // An owner's API key without members:manage doesn't see it either.
      const asKey = yield* run["members.list"](f.janeReadOnlyKey, { teamId: f.acme })
      expect(asKey.every((member) => !("twoFactorEnabled" in member))).toBe(true)
    }).pipe(Effect.provide(CoreLive)),
  )
})
