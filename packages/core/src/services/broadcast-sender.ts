import { Database, schema } from "@parley/db"
import type { BroadcastId, ContactId, TeamId, TopicId } from "@parley/domain"
import { and, asc, eq, sql } from "drizzle-orm"
import { Context, Duration, Effect, Layer, Ref } from "effect"
import { type MergeValues, renderEmail } from "../email/render.ts"
import { Mailer, type OutgoingEmail, type SentEmail } from "../mail/mailer.ts"
import { styleSentWith } from "./broadcasts.ts"
import type { SendAs } from "./sending.ts"
import { UnsubscribeLinks } from "./unsubscribe-links.ts"

type Batch = typeof schema.broadcastBatches.$inferSelect
type ClaimedBatch = Batch & { readonly claimToken: string }
type BatchOutcome =
  | { readonly status: "sent"; readonly sent: ReadonlyArray<SentEmail> }
  | { readonly status: "failed" | "unknown" | "canceled"; readonly message: string | null }
const UNKNOWN = "The email service may have accepted this email. Automatic retries stopped to avoid sending it twice."
const RETRY_WINDOW_MS = (24 * 60 - 5) * 60_000
const rowsOf = <A>(result: unknown): ReadonlyArray<A> =>
  Array.isArray(result) ? (result as ReadonlyArray<A>) : ((result as { readonly rows?: ReadonlyArray<A> }).rows ?? [])

/** Durable broadcast delivery. Leases fence database writes; provider keys protect network retries. */
export class BroadcastSender extends Context.Service<
  BroadcastSender,
  {
    readonly sendBatch: Effect.Effect<number>
    readonly drain: Effect.Effect<number>
  }
>()("@parley/core/BroadcastSender") {
  static readonly layer = Layer.effect(
    BroadcastSender,
    Effect.gen(function* () {
      const db = yield* Database
      const mailer = yield* Mailer
      const links = yield* UnsubscribeLinks
      const lastTeam = yield* Ref.make("")
      const b = schema.broadcastBatches
      const r = schema.broadcastRecipients
      const c = schema.broadcasts
      const nextTeam = Effect.gen(function* () {
        const rows = yield* db.query((d) =>
          d.execute(sql`
        select team_id from broadcast_batches where status = 'pending' and next_attempt_at <= now()
          and (lease_until is null or lease_until <= now())
        union
        select r.team_id from broadcast_recipients r join broadcasts c on c.id = r.broadcast_id
          where r.status = 'queued' and r.batch_id is null and c.status = 'sending'
        union
        select c.team_id from broadcasts c where c.status = 'sending'
          and not exists (select 1 from broadcast_recipients r where r.broadcast_id = c.id and r.status = 'queued')
        order by team_id`),
        )
        const teams = rowsOf<{ team_id: string }>(rows).map((row) => row.team_id)
        const last = yield* Ref.get(lastTeam)
        const next = teams.find((team) => team > last) ?? teams[0]
        if (next) yield* Ref.set(lastTeam, next)
        return next
      })

      const claim = (teamId: string) =>
        db.transaction(
          Effect.gen(function* () {
            const [batch] = yield* db.query((d) =>
              d
                .select()
                .from(b)
                .where(
                  and(
                    eq(b.teamId, teamId),
                    eq(b.status, "pending"),
                    sql`${b.nextAttemptAt} <= now()`,
                    sql`(${b.leaseUntil} is null or ${b.leaseUntil} <= now())`,
                  ),
                )
                .orderBy(asc(b.nextAttemptAt))
                .limit(1)
                .for("update", { skipLocked: true }),
            )
            if (!batch) return undefined
            const claimToken = crypto.randomUUID()
            const [claimed] = yield* db.query((d) =>
              d
                .update(b)
                .set({ claimToken, leaseUntil: sql`now() + interval '10 minutes'` })
                .where(eq(b.id, batch.id))
                .returning(),
            )
            return claimed ? { ...claimed, claimToken } : undefined
          }),
        )

      const prepare = (teamId: string) =>
        db.transaction(
          Effect.gen(function* () {
            const [broadcast] = yield* db.query((d) =>
              d
                .select()
                .from(c)
                .where(
                  and(
                    eq(c.teamId, teamId),
                    eq(c.status, "sending"),
                    sql`exists (select 1 from broadcast_recipients r where r.broadcast_id = ${c.id} and r.status = 'queued' and r.batch_id is null)`,
                  ),
                )
                .orderBy(asc(c.createdAt))
                .limit(1)
                .for("update", { skipLocked: true }),
            )
            if (!broadcast) return undefined
            const recipients = yield* db.query((d) =>
              d
                .select()
                .from(r)
                .where(and(eq(r.broadcastId, broadcast.id), eq(r.status, "queued"), sql`${r.batchId} is null`))
                .orderBy(asc(r.createdAt), asc(r.id))
                .limit(100)
                .for("update"),
            )
            const sender = broadcast.sentAs as SendAs | null
            const emails: OutgoingEmail[] = []
            const ready: typeof recipients = []
            for (const recipient of recipients) {
              const row = { ...recipient, contact_id: recipient.contactId }
              if (!sender || !row.address) {
                yield* db.query((d) =>
                  d
                    .update(r)
                    .set({ status: "failed", error: "This broadcast couldn't be prepared for sending." })
                    .where(eq(r.id, row.id)),
                )
                continue
              }
              const token = links.sign({
                teamId: broadcast.teamId as TeamId,
                contactId: row.contact_id as ContactId | null,
                topicId: broadcast.topicId as TopicId | null,
                broadcastId: broadcast.id as BroadcastId,
                test: false,
              })
              const urls = links.urls(token)
              const merge = row.merge
              const values: MergeValues = {
                first_name: merge.first_name ?? "",
                last_name: merge.last_name ?? "",
                name: [merge.first_name, merge.last_name].filter(Boolean).join(" "),
                email: merge.email ?? row.address,
                company: merge.company ?? "",
              }
              const rendered = renderEmail(
                broadcast,
                values,
                {
                  legalName: sender.legalName,
                  postalAddress: sender.postalAddress,
                  topicName: broadcast.topicName,
                  unsubscribeUrl: urls.page,
                },
                styleSentWith(broadcast.sentAs),
              )
              emails.push({
                to: row.address,
                from: sender.from,
                ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
                // RFC 8058: mail apps can unsubscribe in one click, without opening anything.
                headers: {
                  "List-Unsubscribe": `<${urls.oneClick}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              })
              ready.push(recipient)
            }
            if (ready.length === 0) return undefined
            const prepared = yield* mailer.prepareBatch(emails).pipe(Effect.result)
            if (prepared._tag === "Failure") {
              yield* db.query((d) =>
                d
                  .update(r)
                  .set({ status: "failed", error: prepared.failure.userMessage })
                  .where(
                    sql`${r.id} in (${sql.join(
                      ready.map((row) => sql`${row.id}`),
                      sql`,`,
                    )})`,
                  ),
              )
              return undefined
            }
            const claimToken = crypto.randomUUID()
            const [batch] = yield* db.query((d) =>
              d
                .insert(b)
                .values({
                  id: crypto.randomUUID(),
                  teamId,
                  broadcastId: broadcast.id,
                  ...prepared.success,
                  claimToken,
                  leaseUntil: sql`now() + interval '10 minutes'`,
                })
                .returning(),
            )
            if (!batch) return undefined
            for (const [position, recipient] of ready.entries())
              yield* db.query((d) =>
                d.update(r).set({ batchId: batch.id, batchPosition: position }).where(eq(r.id, recipient.id)),
              )
            return { ...batch, claimToken }
          }),
        )

      const owned = (batch: ClaimedBatch) =>
        and(
          eq(b.id, batch.id),
          eq(b.status, "pending"),
          eq(b.claimToken, batch.claimToken),
          sql`${b.leaseUntil} > clock_timestamp()`,
        )

      const finish = (teamId: string) =>
        db.query((d) =>
          d.execute(sql`update broadcasts c set status = 'sent', finished_at = now(), updated_at = now()
      where c.team_id = ${teamId} and c.status = 'sending' and not exists (select 1 from broadcast_recipients r where r.broadcast_id = c.id and r.status = 'queued')`),
        )

      const settle = (batch: ClaimedBatch, outcome: BatchOutcome) =>
        db.transaction(
          Effect.gen(function* () {
            const { status } = outcome
            const message = outcome.status === "sent" ? null : outcome.message
            const [changed] = yield* db.query((d) =>
              d
                .update(b)
                .set({ status, claimToken: null, leaseUntil: null, updatedAt: sql`now()` })
                .where(owned(batch))
                .returning(),
            )
            if (!changed) return
            const recipients = yield* db.query((d) =>
              d.select().from(r).where(eq(r.batchId, batch.id)).orderBy(asc(r.batchPosition)),
            )
            const [broadcast] = yield* db.query((d) => d.select().from(c).where(eq(c.id, batch.broadcastId)))
            if (outcome.status === "sent" && outcome.sent.length !== recipients.length)
              return yield* Effect.die("Batch completion does not match its recipients")
            for (const [index, recipient] of recipients.entries()) {
              const providerId = outcome.status === "sent" ? outcome.sent[index]?.providerId : null
              if (outcome.status === "sent" && !providerId)
                return yield* Effect.die("Batch completion is missing a provider ID")
              yield* db.query((d) =>
                d
                  .update(r)
                  .set({
                    status,
                    error: message,
                    nextAttemptAt: null,
                    ...(providerId ? { providerId, sentAt: sql`now()` } : {}),
                    updatedAt: sql`now()`,
                  })
                  .where(and(eq(r.id, recipient.id), eq(r.status, "queued"))),
              )
              if (status === "sent" && recipient.contactId && broadcast)
                yield* db.query((d) =>
                  d.insert(schema.activity).values({
                    id: crypto.randomUUID(),
                    teamId: batch.teamId,
                    recordType: "contact",
                    recordId: recipient.contactId as string,
                    kind: "emailed",
                    changedFields: [],
                    relatedRecordType: "broadcast",
                    relatedRecordId: broadcast.id,
                    relatedName: broadcast.name,
                    actorUserId: broadcast.sentByUserId,
                    actorName: broadcast.sentByName ?? "Parley",
                  }),
                )
            }
          }),
        )

      const dispatch = (batch: ClaimedBatch) =>
        Effect.gen(function* () {
          const recipients = yield* db.query((d) => d.select({ id: r.id }).from(r).where(eq(r.batchId, batch.id)))
          if (batch.firstAttemptAt && batch.firstAttemptAt.getTime() + RETRY_WINDOW_MS <= Date.now()) {
            yield* settle(batch, { status: "unknown", message: UNKNOWN })
            return recipients.length
          }
          // Cancellation and the first possible dispatch serialize on the broadcast row.
          const attempt = yield* db.transaction(
            Effect.gen(function* () {
              const [broadcast] = yield* db.query((d) =>
                d.select({ status: c.status }).from(c).where(eq(c.id, batch.broadcastId)).for("update"),
              )
              if (!batch.firstAttemptAt && broadcast?.status !== "sending") {
                yield* settle(batch, { status: "canceled", message: null })
                return undefined
              }
              const [started] = yield* db.query((d) =>
                d
                  .update(b)
                  .set({
                    firstAttemptAt: sql`coalesce(${b.firstAttemptAt}, now())`,
                    attempts: sql`${b.attempts} + 1`,
                    updatedAt: sql`now()`,
                  })
                  .where(owned(batch))
                  .returning(),
              )
              return started ? { ...started, claimToken: batch.claimToken } : undefined
            }),
          )
          if (!attempt?.firstAttemptAt) return recipients.length
          const outcome = yield* mailer
            .deliverBatch({
              payload: attempt.payload,
              providerIdentity: attempt.providerIdentity,
              idempotencyKey: attempt.id,
              count: recipients.length,
              retryUntil: new Date(attempt.firstAttemptAt.getTime() + RETRY_WINDOW_MS),
            })
            .pipe(Effect.result)
          if (outcome._tag === "Success") {
            if (outcome.success.length !== recipients.length || outcome.success.some((email) => !email.providerId)) {
              yield* Effect.logWarning("broadcast provider response did not match the batch")
              yield* retry(attempt, Duration.minutes(2))
            } else yield* settle(attempt, { status: "sent", sent: outcome.success })
          } else {
            const error = outcome.failure
            yield* Effect.logWarning("broadcast provider request failed", error)
            switch (error._tag) {
              case "EmailSendingTooFast":
                yield* retry(attempt, error.retryAfter)
                break
              case "EmailServiceUnavailable":
                yield* retry(attempt, Duration.minutes(Math.min(30, 2 ** Math.min(attempt.attempts, 5))))
                break
              case "EmailBatchReplayUnsafe":
                yield* settle(attempt, { status: "unknown", message: UNKNOWN })
                break
              default:
                yield* settle(attempt, {
                  status: attempt.attempts > 1 ? "unknown" : "failed",
                  message: attempt.attempts > 1 ? UNKNOWN : error.userMessage,
                })
            }
          }
          return recipients.length
        })

      const retry = (batch: ClaimedBatch, after: Duration.Duration) =>
        db.query((d) =>
          d
            .update(b)
            .set({
              nextAttemptAt: sql`now() + make_interval(secs => ${Math.max(1, Math.ceil(Duration.toSeconds(after)))})`,
              claimToken: null,
              leaseUntil: null,
              updatedAt: sql`now()`,
            })
            .where(owned(batch)),
        )

      const sendBatch = Effect.gen(function* () {
        const teamId = yield* nextTeam
        if (!teamId) return 0
        const batch = (yield* claim(teamId)) ?? (yield* prepare(teamId))
        const handled = batch ? yield* dispatch(batch) : 0
        yield* finish(teamId)
        return handled
      }).pipe(
        Effect.catchTag("SqlError", (error) => Effect.logWarning("broadcast sending failed", error).pipe(Effect.as(0))),
        Effect.withSpan("BroadcastSender.sendBatch"),
      )
      const drain = Effect.gen(function* () {
        let total = 0
        for (;;) {
          const handled = yield* sendBatch
          if (handled === 0) return total
          total += handled
        }
      })
      return { sendBatch, drain }
    }),
  )

  static readonly schedule = Layer.effectDiscard(
    Effect.gen(function* () {
      const sender = yield* BroadcastSender
      yield* Effect.forkScoped(
        Effect.forever(
          sender.sendBatch.pipe(
            Effect.flatMap((handled) => (handled > 0 ? Effect.void : Effect.sleep(Duration.seconds(2)))),
            Effect.catchCause((cause) =>
              Effect.logWarning("broadcast sender failed", cause).pipe(
                Effect.andThen(Effect.sleep(Duration.seconds(5))),
              ),
            ),
          ),
        ),
      )
    }),
  )
}
