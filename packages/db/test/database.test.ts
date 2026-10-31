import { describe, expect, it } from "@effect/vitest"
import { eq, sql } from "drizzle-orm"
import { Deferred, Duration, Effect, Fiber } from "effect"
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

      const divisionByZero = yield* db.query((d) => d.execute(sql`select 1/0`)).pipe(Effect.flip)
      expect(divisionByZero._tag).toBe("SqlError")
      yield* db.query((d) => d.delete(schema.organization).where(eq(schema.organization.id, teamId)))
    }).pipe(Effect.scoped, Effect.provide(DatabaseLive)),
  )
  it.effect("preserves SQL constraint details and rolls back a nested transaction independently", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const teamId = `test_${crypto.randomUUID()}`
      yield* db.query((d) =>
        d.insert(schema.organization).values({ id: teamId, name: "Test", slug: teamId, createdAt: new Date() }),
      )
      yield* Effect.addFinalizer(() =>
        db.query((d) => d.delete(schema.organization).where(eq(schema.organization.id, teamId))).pipe(Effect.orDie),
      )
      const duplicate = yield* db
        .query((d) =>
          d
            .insert(schema.organization)
            .values({ id: teamId, name: "Duplicate", slug: `${teamId}_duplicate`, createdAt: new Date() }),
        )
        .pipe(Effect.flip)
      expect(duplicate.reason).toMatchObject({ _tag: "UniqueViolation", constraint: "organization_pkey" })
      yield* db.transaction(
        Effect.gen(function* () {
          yield* db.query((d) =>
            d.update(schema.organization).set({ name: "Outer" }).where(eq(schema.organization.id, teamId)),
          )
          const failure = yield* db
            .transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d.update(schema.organization).set({ name: "Inner" }).where(eq(schema.organization.id, teamId)),
                )
                return yield* Effect.fail("rollback inner" as const)
              }),
            )
            .pipe(Effect.flip)
          expect(failure).toBe("rollback inner")
          const [inside] = yield* db.query((d) =>
            d.select().from(schema.organization).where(eq(schema.organization.id, teamId)),
          )
          expect(inside?.name).toBe("Outer")
        }),
      )
      const [committed] = yield* db.query((d) =>
        d.select().from(schema.organization).where(eq(schema.organization.id, teamId)),
      )
      expect(committed?.name).toBe("Outer")
    }).pipe(Effect.scoped, Effect.provide(DatabaseLive)),
  )

  it.live("interrupts an active PostgreSQL statement and rolls back its writes", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const teamId = `test_${crypto.randomUUID()}`
      yield* db.query((d) =>
        d.insert(schema.organization).values({ id: teamId, name: "Before", slug: teamId, createdAt: new Date() }),
      )
      yield* Effect.addFinalizer(() =>
        db.query((d) => d.delete(schema.organization).where(eq(schema.organization.id, teamId))).pipe(Effect.orDie),
      )
      const started = yield* Deferred.make<number>()
      const fiber = yield* Effect.forkScoped(
        db.transaction(
          Effect.gen(function* () {
            yield* db.query((d) =>
              d.update(schema.organization).set({ name: "Interrupted" }).where(eq(schema.organization.id, teamId)),
            )
            const result = yield* db.query((d) => d.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
            const pid = result.rows[0]?.pid
            if (!pid) return yield* Effect.die("PostgreSQL did not return its backend PID")
            yield* Deferred.succeed(started, pid)
            yield* db.query((d) => d.execute(sql`select pg_sleep(20)`))
          }),
        ),
      )
      const pid = yield* Deferred.await(started)
      yield* Effect.gen(function* () {
        for (;;) {
          const result = yield* db.query((d) =>
            d.execute<{ wait_event: string | null }>(sql`select wait_event from pg_stat_activity where pid = ${pid}`),
          )
          if (result.rows[0]?.wait_event === "PgSleep") return
          yield* Effect.sleep(Duration.millis(5))
        }
      }).pipe(Effect.timeout(Duration.seconds(5)))
      yield* Fiber.interrupt(fiber).pipe(Effect.timeout(Duration.seconds(3)))
      const [row] = yield* db.query((d) =>
        d.select().from(schema.organization).where(eq(schema.organization.id, teamId)),
      )
      expect(row?.name).toBe("Before")
      const result = yield* db.query((d) => d.execute<{ value: number }>(sql`select 1 as value`))
      expect(result.rows).toEqual([{ value: 1 }])
    }).pipe(Effect.scoped, Effect.provide(DatabaseLive)),
  )
})
