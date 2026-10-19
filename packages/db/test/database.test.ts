import { describe, expect, it } from "@effect/vitest"
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database, DatabaseLive, schema } from "../src/index.ts"

const teamId = `test_${crypto.randomUUID()}`

describe("Database", () => {
  it.effect("runs Drizzle queries through Effect, with uuid, timestamps, arrays and transactions", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.query((d) =>
        d.insert(schema.organization).values({ id: teamId, name: "Test", slug: teamId, createdAt: new Date() }),
      )
      const id = crypto.randomUUID()
      yield* db.transaction(
        Effect.gen(function* () {
          yield* db.query((d) => d.insert(schema.contacts).values({ id, teamId, firstName: "Sam" }))
          yield* db.query((d) =>
            d.insert(schema.activity).values({
              id: crypto.randomUUID(),
              teamId,
              recordType: "contact",
              recordId: id,
              actorName: "Jane",
              kind: "created",
              changedFields: ["firstName"],
            }),
          )
        }),
      )
      const [row] = yield* db.query((d) => d.select().from(schema.contacts).where(eq(schema.contacts.id, id)))
      expect(row?.firstName).toBe("Sam")
      expect(row?.createdAt).toBeInstanceOf(Date)
      const [entry] = yield* db.query((d) =>
        d
          .select({ fields: schema.activity.changedFields })
          .from(schema.activity)
          .where(eq(schema.activity.recordId, id)),
      )
      expect(entry?.fields).toEqual(["firstName"])

      const failed = yield* db
        .transaction(
          Effect.gen(function* () {
            yield* db.query((d) =>
              d.update(schema.contacts).set({ firstName: "Changed" }).where(eq(schema.contacts.id, id)),
            )
            return yield* Effect.fail("rollback" as const)
          }),
        )
        .pipe(Effect.flip)
      expect(failed).toBe("rollback")
      const [after] = yield* db.query((d) => d.select().from(schema.contacts).where(eq(schema.contacts.id, id)))
      expect(after?.firstName).toBe("Sam")

      const unique = yield* db.query((d) => d.execute(sql`select 1/0`)).pipe(Effect.flip)
      expect(unique._tag).toBe("SqlError")
      yield* db.query((d) => d.delete(schema.organization).where(eq(schema.organization.id, teamId)))
    }).pipe(Effect.provide(DatabaseLive)),
  )
})
