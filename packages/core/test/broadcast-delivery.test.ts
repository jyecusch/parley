import { readFileSync } from "node:fs"
import { describe, expect, it } from "@effect/vitest"
import { Database, schema } from "@parley/db"
import { EmailRejected, EmailServiceUnavailable } from "@parley/domain"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { Deferred, Duration, Effect, Fiber, Layer } from "effect"
import { SqlClient, Statement } from "effect/sql"
import { BroadcastSender, CoreLive, Mailer, implementations as run } from "../src/index.ts"
import type { DeliverBatchInput } from "../src/mail/mailer.ts"
import { withBroadcastQueue } from "./broadcast-queue.ts"
import { Fixture } from "./fixture.ts"

const seed = Effect.gen(function* () {
  const f = yield* Fixture
  const db = yield* Database
  const id = crypto.randomUUID()
  const contactId = crypto.randomUUID()
  yield* db.query((d) => d.insert(schema.contacts).values({ id: contactId, teamId: f.acme, firstName: "Ada" }))
  yield* db.query((d) =>
    d.insert(schema.broadcasts).values({
      id,
      teamId: f.acme,
      name: "Delivery test",
      status: "sending",
      subject: "Hello {{first_name}}",
      body: "Original body",
      sentAs: { from: "News <news@example.com>", legalName: "Example", postalAddress: "1 Example St" },
      sentByUserId: f.jane.userId,
      sentByName: "Jane",
    }),
  )
  yield* db.query((d) =>
    d.insert(schema.broadcastRecipients).values({
      id: crypto.randomUUID(),
      teamId: f.acme,
      broadcastId: id,
      contactId,
      address: "ada@example.com",
      name: "Ada",
      merge: { first_name: "Ada" },
      status: "queued",
    }),
  )
  yield* Effect.addFinalizer(() =>
    db.query((d) => d.delete(schema.broadcasts).where(eq(schema.broadcasts.id, id))).pipe(Effect.orDie),
  )
  return { ...f, id, contactId }
})

const worker = (deliverBatch: Mailer["Service"]["deliverBatch"]) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer
    return yield* BroadcastSender.pipe(
      Effect.provide(
        Layer.fresh(BroadcastSender.layer).pipe(Layer.provide(Layer.succeed(Mailer)({ ...mailer, deliverBatch }))),
      ),
    )
  })

const due = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* db.query((d) =>
      d
        .update(schema.broadcastBatches)
        .set({ nextAttemptAt: sql`now()`, leaseUntil: sql`now() - interval '1 second'` })
        .where(eq(schema.broadcastBatches.broadcastId, id)),
    )
  })

const state = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    const recipients = yield* db.query((d) =>
      d.select().from(schema.broadcastRecipients).where(eq(schema.broadcastRecipients.broadcastId, id)),
    )
    const batches = yield* db.query((d) =>
      d.select().from(schema.broadcastBatches).where(eq(schema.broadcastBatches.broadcastId, id)),
    )
    const activity = yield* db.query((d) =>
      d
        .select()
        .from(schema.activity)
        .where(and(eq(schema.activity.relatedRecordId, id), eq(schema.activity.kind, "emailed"))),
    )
    return { recipients, batches, activity }
  })

const accepted = (input: DeliverBatchInput) =>
  Array.from({ length: input.count }, (_, i) => ({ providerId: `${input.idempotencyKey}-${i}` }))

describe("durable broadcast delivery", () => {
  it.effect("replays the exact batch after acceptance with a lost response, despite later content changes", () =>
    Effect.gen(function* () {
      const f = yield* seed
      const db = yield* Database
      yield* db.query((d) =>
        d.insert(schema.broadcastRecipients).values({
          id: crypto.randomUUID(),
          teamId: f.acme,
          broadcastId: f.id,
          address: "grace@example.com",
          name: "Grace",
          status: "queued",
        }),
      )
      const calls: DeliverBatchInput[] = []
      const delivered = new Map<string, ReturnType<typeof accepted>>()
      const sender = yield* worker((input) =>
        Effect.gen(function* () {
          calls.push(input)
          const result = delivered.get(input.idempotencyKey) ?? accepted(input)
          delivered.set(input.idempotencyKey, result)
          if (calls.length === 1) return yield* new EmailServiceUnavailable({ cause: "Response lost after acceptance" })
          return result
        }),
      )
      expect(yield* sender.sendBatch).toBe(2)
      yield* db.query((d) =>
        d
          .update(schema.broadcasts)
          .set({ body: "Changed after dispatch", subject: "Changed" })
          .where(eq(schema.broadcasts.id, f.id)),
      )
      yield* db.query((d) =>
        d
          .update(schema.broadcastRecipients)
          .set({ merge: { first_name: "Different" } })
          .where(eq(schema.broadcastRecipients.broadcastId, f.id)),
      )
      yield* due(f.id)
      expect(yield* sender.drain).toBe(2)
      expect(calls).toHaveLength(2)
      expect(calls[1]?.payload).toBe(calls[0]?.payload)
      expect(calls[1]?.idempotencyKey).toBe(calls[0]?.idempotencyKey)
      expect(delivered.size).toBe(1)
      const result = yield* state(f.id)
      expect(result.recipients.find((recipient) => recipient.contactId === f.contactId)).toMatchObject({
        status: "sent",
        providerId: `${calls[0]?.idempotencyKey}-0`,
      })
      expect(result.batches[0]).toMatchObject({ status: "sent", attempts: 2 })
      expect(result.activity).toHaveLength(1)
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )

  it.effect("recovers after provider acceptance when the completion transaction fails", () =>
    Effect.gen(function* () {
      const f = yield* seed
      const client = yield* SqlClient.SqlClient
      const calls: DeliverBatchInput[] = []
      const sender = yield* worker((input) =>
        Effect.sync(() => {
          calls.push(input)
          return accepted(input)
        }),
      )
      let failed = false
      expect(
        yield* sender.sendBatch.pipe(
          Effect.provideService(Statement.CurrentTransformer, (statement) =>
            Effect.sync(() => {
              const [text, params] = statement.compile()
              if (!failed && text.startsWith('update "broadcast_batches"') && params[0] === "sent") {
                failed = true
                return client.unsafe("select 1 / 0")
              }
              return statement
            }),
          ),
        ),
      ).toBe(0)
      expect(failed).toBe(true)
      const before = yield* state(f.id)
      expect(before.batches[0]?.status).toBe("pending")
      expect(before.activity).toHaveLength(0)
      yield* due(f.id)
      yield* sender.drain
      expect(calls).toHaveLength(2)
      expect(calls[1]?.payload).toBe(calls[0]?.payload)
      expect(calls[1]?.idempotencyKey).toBe(calls[0]?.idempotencyKey)
      const after = yield* state(f.id)
      expect(after.recipients[0]?.status).toBe("sent")
      expect(after.activity).toHaveLength(1)
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )

  for (const late of ["success", "failure"] as const)
    it.effect(`fences a stale worker's ${late} after another worker completes`, () =>
      Effect.gen(function* () {
        const f = yield* seed
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const calls: DeliverBatchInput[] = []
        const deliver: Mailer["Service"]["deliverBatch"] = (input) =>
          Effect.gen(function* () {
            calls.push(input)
            if (calls.length === 1) {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              if (late === "failure") return yield* new EmailServiceUnavailable({ cause: "Late network failure" })
            }
            return accepted(input)
          })
        const first = yield* worker(deliver)
        const second = yield* worker(deliver)
        const fiber = yield* Effect.forkScoped(first.sendBatch)
        yield* Deferred.await(entered)
        expect(yield* second.sendBatch).toBe(0)
        expect(calls).toHaveLength(1)
        yield* due(f.id)
        expect(yield* second.sendBatch).toBe(1)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(fiber)
        const result = yield* state(f.id)
        expect(calls[1]?.idempotencyKey).toBe(calls[0]?.idempotencyKey)
        expect(result.batches[0]).toMatchObject({ status: "sent", attempts: 2, claimToken: null })
        expect(result.recipients[0]?.status).toBe("sent")
        expect(result.activity).toHaveLength(1)
      }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
    )

  it.effect("stops automatic retries outside the provider retention window and reports an unknown outcome", () =>
    Effect.gen(function* () {
      const f = yield* seed
      const db = yield* Database
      let calls = 0
      const sender = yield* worker(() => {
        calls++
        return Effect.fail(new EmailServiceUnavailable({ cause: "Lost response" }))
      })
      yield* sender.sendBatch
      yield* db.query((d) =>
        d
          .update(schema.broadcastBatches)
          .set({ firstAttemptAt: sql`now() - interval '24 hours'` })
          .where(eq(schema.broadcastBatches.broadcastId, f.id)),
      )
      yield* due(f.id)
      yield* sender.drain
      expect(calls).toBe(1)
      const result = yield* state(f.id)
      expect(result.batches[0]?.status).toBe("unknown")
      expect(result.recipients[0]).toMatchObject({ status: "unknown", providerId: null })
      expect(result.recipients[0]?.error).toContain("may have accepted")
      expect(result.activity).toHaveLength(0)
      const report = yield* run["broadcasts.get"](f.jane, { teamId: f.acme, broadcastId: f.id as never })
      expect(report.counts).toMatchObject({ unknown: 1, failed: 0, sent: 0, queued: 0 })
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )

  it.effect("reconciles an in-flight batch after cancellation without canceling its outcome", () =>
    Effect.gen(function* () {
      const f = yield* seed
      let calls = 0
      const sender = yield* worker((input) =>
        ++calls === 1
          ? Effect.fail(new EmailServiceUnavailable({ cause: "Lost response" }))
          : Effect.succeed(accepted(input)),
      )
      yield* sender.sendBatch
      const canceled = yield* run["broadcasts.cancel"](f.jane, { teamId: f.acme, broadcastId: f.id as never })
      expect(canceled.status).toBe("canceled")
      expect(canceled.counts).toMatchObject({ queued: 1, canceled: 0 })
      yield* due(f.id)
      yield* sender.drain
      const report = yield* run["broadcasts.get"](f.jane, { teamId: f.acme, broadcastId: f.id as never })
      expect(report.status).toBe("canceled")
      expect(report.counts).toMatchObject({ sent: 1, queued: 0 })
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )

  it.effect("cancels a prepared batch before its first possible dispatch", () =>
    Effect.gen(function* () {
      const f = yield* seed
      const db = yield* Database
      const id = crypto.randomUUID()
      yield* db.query((d) =>
        d.insert(schema.broadcastBatches).values({
          id,
          teamId: f.acme,
          broadcastId: f.id,
          payload: "[]",
          providerIdentity: "outbox",
          claimToken: crypto.randomUUID(),
          leaseUntil: sql`now() + interval '10 minutes'`,
        }),
      )
      yield* db.query((d) =>
        d
          .update(schema.broadcastRecipients)
          .set({ batchId: id, batchPosition: 0 })
          .where(eq(schema.broadcastRecipients.broadcastId, f.id)),
      )
      yield* run["broadcasts.cancel"](f.jane, { teamId: f.acme, broadcastId: f.id as never })
      let calls = 0
      const sender = yield* worker((input) => {
        calls++
        return Effect.succeed(accepted(input))
      })
      yield* sender.drain
      expect(calls).toBe(0)
      const result = yield* state(f.id)
      expect(result.batches[0]?.status).toBe("canceled")
      expect(result.recipients[0]?.status).toBe("canceled")
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )

  it.effect("drains another queued team after finishing a cleanup-only team", () =>
    Effect.gen(function* () {
      const first = yield* seed
      const second = yield* seed
      const db = yield* Database
      const ordered = yield* db.query((d) =>
        d
          .select({ id: schema.broadcasts.id })
          .from(schema.broadcasts)
          .where(inArray(schema.broadcasts.id, [first.id, second.id]))
          .orderBy(asc(schema.broadcasts.teamId)),
      )
      const cleanup = ordered[0]?.id
      const queued = ordered[1]?.id
      if (!cleanup || !queued) return yield* Effect.die("Expected two delivery fixtures")
      yield* db.query((d) =>
        d.delete(schema.broadcastRecipients).where(eq(schema.broadcastRecipients.broadcastId, cleanup)),
      )
      const calls: DeliverBatchInput[] = []
      const sender = yield* worker((input) => {
        calls.push(input)
        return Effect.succeed(accepted(input))
      })
      expect(yield* sender.drain).toBe(1)
      expect(calls).toHaveLength(1)
      const [finished] = yield* db.query((d) =>
        d.select({ status: schema.broadcasts.status }).from(schema.broadcasts).where(eq(schema.broadcasts.id, cleanup)),
      )
      expect(finished?.status).toBe("sent")
      expect((yield* state(queued)).recipients[0]?.status).toBe("sent")
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )

  for (const cleanupOnly of [false, true])
    it.live(
      `drains available work while the first team's ${cleanupOnly ? "cleanup-only" : "queued"} broadcast is locked`,
      () =>
        Effect.gen(function* () {
          const first = yield* seed
          const second = yield* seed
          const db = yield* Database
          const ordered = yield* db.query((d) =>
            d
              .select({ id: schema.broadcasts.id })
              .from(schema.broadcasts)
              .where(inArray(schema.broadcasts.id, [first.id, second.id]))
              .orderBy(asc(schema.broadcasts.teamId)),
          )
          const locked = ordered[0]?.id
          const available = ordered[1]?.id
          if (!locked || !available) return yield* Effect.die("Expected two delivery fixtures")
          if (cleanupOnly)
            yield* db.query((d) =>
              d.delete(schema.broadcastRecipients).where(eq(schema.broadcastRecipients.broadcastId, locked)),
            )
          const acquired = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const blocker = yield* Effect.forkScoped(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .select({ id: schema.broadcasts.id })
                    .from(schema.broadcasts)
                    .where(eq(schema.broadcasts.id, locked))
                    .for("update"),
                )
                yield* Deferred.succeed(acquired, undefined)
                yield* Deferred.await(release)
              }),
            ),
          )
          yield* Deferred.await(acquired)
          const calls: DeliverBatchInput[] = []
          const sender = yield* worker((input) => {
            calls.push(input)
            return Effect.succeed(accepted(input))
          })
          const handled = yield* sender.drain.pipe(
            Effect.timeout(Duration.seconds(3)),
            Effect.ensuring(Deferred.succeed(release, undefined)),
          )
          yield* Fiber.join(blocker)
          expect(handled).toBe(1)
          expect((yield* state(available)).recipients[0]?.status).toBe("sent")
          const [remainingBroadcast] = yield* db.query((d) =>
            d
              .select({ status: schema.broadcasts.status })
              .from(schema.broadcasts)
              .where(eq(schema.broadcasts.id, locked)),
          )
          expect(remainingBroadcast?.status).toBe("sending")
          if (!cleanupOnly) expect((yield* state(locked)).recipients[0]?.status).toBe("queued")
          expect(yield* sender.drain).toBe(cleanupOnly ? 0 : 1)
          expect(calls).toHaveLength(cleanupOnly ? 1 : 2)
          const [finished] = yield* db.query((d) =>
            d
              .select({ status: schema.broadcasts.status })
              .from(schema.broadcasts)
              .where(eq(schema.broadcasts.id, locked)),
          )
          expect(finished?.status).toBe("sent")
          if (!cleanupOnly) expect((yield* state(locked)).recipients[0]?.status).toBe("sent")
        }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
    )

  it.effect("continues past more than 100 invalid recipients to the remaining valid recipient", () =>
    Effect.gen(function* () {
      const f = yield* seed
      const db = yield* Database
      yield* db.query((d) =>
        d.insert(schema.broadcastRecipients).values(
          Array.from({ length: 101 }, (_, index) => ({
            id: crypto.randomUUID(),
            teamId: f.acme,
            broadcastId: f.id,
            address: null,
            name: `Invalid recipient ${index}`,
            status: "queued" as const,
            createdAt: new Date(0),
          })),
        ),
      )
      const calls: DeliverBatchInput[] = []
      const sender = yield* worker((input) => {
        calls.push(input)
        return Effect.succeed(accepted(input))
      })
      expect(yield* sender.drain).toBe(102)
      expect(calls.map((input) => input.count)).toEqual([1])
      const result = yield* state(f.id)
      expect(result.recipients.filter((recipient) => recipient.status === "failed")).toHaveLength(101)
      expect(result.recipients.find((recipient) => recipient.contactId === f.contactId)?.status).toBe("sent")
      expect(result.batches).toHaveLength(1)
      expect(result.activity).toHaveLength(1)
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )

  it.effect("completes 100 contacted recipients with bounded statements and correctly paired provider IDs", () =>
    Effect.gen(function* () {
      const f = yield* seed
      const db = yield* Database
      const contacts = Array.from({ length: 99 }, (_, index) => ({
        id: crypto.randomUUID(),
        teamId: f.acme,
        firstName: `Person ${index}`,
      }))
      yield* db.query((d) => d.insert(schema.contacts).values(contacts))
      yield* db.query((d) =>
        d.insert(schema.broadcastRecipients).values(
          contacts.map((contact, index) => ({
            id: crypto.randomUUID(),
            teamId: f.acme,
            broadcastId: f.id,
            contactId: contact.id,
            address: `person-${index}@example.com`,
            name: contact.firstName,
            merge: { first_name: contact.firstName },
            status: "queued" as const,
            createdAt: new Date(0),
          })),
        ),
      )
      let calls = 0
      const expectedIds = new Map<string, string>()
      const sender = yield* worker((input) =>
        Effect.sync(() => {
          calls++
          const emails = JSON.parse(input.payload) as ReadonlyArray<{ to: string | ReadonlyArray<string> }>
          return emails.map((email, index) => {
            const address = typeof email.to === "string" ? email.to : email.to[0]
            if (!address) throw new Error("Expected one address per provider payload")
            const providerId = `accepted-${index}`
            expectedIds.set(address, providerId)
            return { providerId }
          })
        }),
      )
      const statements: string[] = []
      expect(
        yield* sender.sendBatch.pipe(
          Effect.provideService(Statement.CurrentTransformer, (statement) =>
            Effect.sync(() => {
              const [text] = statement.compile()
              if (!/^(begin|commit|rollback|savepoint|release)\b/i.test(text)) statements.push(text)
              return statement
            }),
          ),
        ),
      ).toBe(100)
      expect(statements.length).toBeLessThanOrEqual(20)
      expect(yield* sender.drain).toBe(0)
      expect(yield* sender.sendBatch).toBe(0)
      expect(calls).toBe(1)
      expect(expectedIds.size).toBe(100)
      const result = yield* state(f.id)
      expect(result.recipients).toHaveLength(100)
      expect(result.activity).toHaveLength(100)
      expect(new Set(result.activity.map((entry) => entry.recordId)).size).toBe(100)
      for (const recipient of result.recipients) {
        expect(recipient.status).toBe("sent")
        expect(recipient.providerId).toBe(expectedIds.get(recipient.address ?? ""))
        expect(result.activity.filter((entry) => entry.recordId === recipient.contactId)).toHaveLength(1)
      }
      expect(result.batches[0]).toMatchObject({ status: "sent", attempts: 1 })
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )

  it.effect("splits new recipients into batches of at most 100", () =>
    Effect.gen(function* () {
      const f = yield* seed
      const db = yield* Database
      yield* db.query((d) =>
        d.insert(schema.broadcastRecipients).values(
          Array.from({ length: 100 }, (_, index) => ({
            id: crypto.randomUUID(),
            teamId: f.acme,
            broadcastId: f.id,
            address: `recipient-${index}@example.com`,
            name: `Recipient ${index}`,
            status: "queued" as const,
          })),
        ),
      )
      const calls: DeliverBatchInput[] = []
      const sender = yield* worker((input) => {
        calls.push(input)
        return Effect.succeed(accepted(input))
      })
      expect(yield* sender.drain).toBe(101)
      expect(calls.map((input) => input.count)).toEqual([100, 1])
      expect(calls[0]?.idempotencyKey).not.toBe(calls[1]?.idempotencyKey)
      expect((yield* state(f.id)).recipients.every((recipient) => recipient.status === "sent")).toBe(true)
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )

  for (const priorAttempt of [false, true])
    it.effect(
      `reports a rejection ${priorAttempt ? "after uncertainty as unknown" : "on the first attempt as failed"}`,
      () =>
        Effect.gen(function* () {
          const f = yield* seed
          let calls = 0
          const sender = yield* worker(() => {
            if (++calls === 1 && priorAttempt)
              return Effect.fail(new EmailServiceUnavailable({ cause: "Lost response" }))
            return Effect.fail(new EmailRejected({ reason: "Private provider diagnostic" }))
          })
          yield* sender.sendBatch
          if (priorAttempt) {
            yield* due(f.id)
            yield* sender.sendBatch
          }
          const result = yield* state(f.id)
          expect(result.recipients[0]?.status).toBe(priorAttempt ? "unknown" : "failed")
          expect(result.recipients[0]?.error).not.toContain("Private provider diagnostic")
        }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
    )

  it.effect("migrates attempted legacy recipients to unknown while keeping unattempted recipients queued", () =>
    Effect.gen(function* () {
      const f = yield* seed
      const db = yield* Database
      yield* db.query((d) =>
        d
          .update(schema.broadcastRecipients)
          .set({ attempts: 1 })
          .where(eq(schema.broadcastRecipients.broadcastId, f.id)),
      )
      const unattempted = crypto.randomUUID()
      yield* db.query((d) =>
        d.insert(schema.broadcastRecipients).values({
          id: unattempted,
          teamId: f.acme,
          broadcastId: f.id,
          address: "grace@example.com",
          name: "Grace",
          status: "queued",
        }),
      )
      const migration = readFileSync(
        new URL("../../db/migrations/20261031033107_broadcast_batches/migration.sql", import.meta.url),
        "utf8",
      )
      yield* db.query((d) => d.execute(sql.raw(migration.slice(migration.indexOf('UPDATE "broadcast_recipients"')))))
      const result = yield* state(f.id)
      expect(result.recipients.find((row) => row.id === unattempted)?.status).toBe("queued")
      expect(result.recipients.find((row) => row.id !== unattempted)).toMatchObject({
        status: "unknown",
        nextAttemptAt: null,
      })
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )

  it.effect("never records missing provider IDs as successful delivery", () =>
    Effect.gen(function* () {
      const f = yield* seed
      const sender = yield* worker(() => Effect.succeed([]))
      yield* sender.sendBatch
      const result = yield* state(f.id)
      expect(result.recipients[0]).toMatchObject({ status: "queued", providerId: null })
      expect(result.batches[0]?.status).toBe("pending")
      expect(result.activity).toHaveLength(0)
    }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
  )
  for (const receipt of ["sparse", "null", "duplicate"] as const)
    it.effect(`does not mark an invalid ${receipt} provider receipt as sent`, () =>
      Effect.gen(function* () {
        const f = yield* seed
        if (receipt === "duplicate") {
          const db = yield* Database
          yield* db.query((d) =>
            d.insert(schema.broadcastRecipients).values({
              id: crypto.randomUUID(),
              teamId: f.acme,
              broadcastId: f.id,
              address: "duplicate@example.com",
              name: "Duplicate",
              status: "queued",
            }),
          )
        }
        const sender = yield* worker((input) =>
          Effect.succeed(
            receipt === "sparse"
              ? new Array<{ providerId: string }>(input.count)
              : receipt === "duplicate"
                ? Array.from({ length: input.count }, () => ({ providerId: "duplicate-id" }))
                : (JSON.parse("[null]") as Array<{ providerId: string }>),
          ),
        )
        yield* sender.sendBatch
        const result = yield* state(f.id)
        expect(result.recipients[0]).toMatchObject({ status: "queued", providerId: null })
        expect(result.batches[0]?.status).toBe("pending")
        expect(result.activity).toHaveLength(0)
      }).pipe(withBroadcastQueue, Effect.provide(CoreLive)),
    )
})
