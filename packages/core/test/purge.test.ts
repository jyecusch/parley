import { describe, expect, it } from "@effect/vitest"
import { Database } from "@parley/db"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { CoreLive, Purge, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

describe("purge", () => {
  it.effect("removes records deleted over 30 days ago, with their notes, and nothing else", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const db = yield* Database
      const purge = yield* Purge
      const old = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Old" })
      const recent = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Recent" })
      yield* run["notes.create"](f.jane, { teamId: f.acme, recordType: "contact", recordId: old.id, body: "Gone soon" })
      yield* run["contacts.delete"](f.jane, { teamId: f.acme, contactId: old.id })
      yield* run["contacts.delete"](f.jane, { teamId: f.acme, contactId: recent.id })
      // Age one deletion past the restore window.
      yield* db
        .query((d) =>
          d.execute(sql`update "contacts" set deleted_at = now() - interval '31 days' where id = ${old.id}`),
        )
        .pipe(Effect.orDie)
      const purged = yield* purge.run
      expect(purged.contacts).toBeGreaterThanOrEqual(1)
      const gone = yield* run["contacts.restore"](f.jane, { teamId: f.acme, contactId: old.id }).pipe(Effect.flip)
      expect(gone._tag).toBe("ContactNotFound")
      const notes = yield* db
        .query((d) => d.execute(sql`select count(*)::int as n from "notes" where record_id = ${old.id}`))
        .pipe(Effect.orDie)
      expect(JSON.stringify(notes)).toContain("0")
      const back = yield* run["contacts.restore"](f.jane, { teamId: f.acme, contactId: recent.id })
      expect(back.deletedAt).toBeNull()
    }).pipe(Effect.provide(CoreLive)),
  )
})
