import { Database, schema } from "@parley/db"
import {
  type BroadcastId,
  type ContactId,
  type DatabaseUnavailable,
  EmailIdempotencyKey,
  type TeamId,
  type TopicId,
} from "@parley/domain"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { Cause, Context, Duration, Effect, Layer, Ref, Schema } from "effect"
import { type MergeValues, renderEmail } from "../email/render.ts"
import { Mailer, type OutgoingEmail, type SentEmail } from "../mail/mailer.ts"
import { styleSentWith } from "./broadcasts.ts"
import type { SendAs } from "./sending.ts"
import { classifySqlError } from "./sql-errors.ts"
import { UnsubscribeLinks } from "./unsubscribe-links.ts"

type Batch = typeof schema.broadcastBatches.$inferSelect
type ClaimedBatch = Batch & { readonly claimToken: string }
type BatchOutcome =
  | { readonly status: "sent"; readonly accepted: ReadonlyArray<AcceptedRecipient> }
  | { readonly status: "failed" | "unknown" | "canceled"; readonly message: string | null }
interface AcceptedRecipient {
  readonly recipientId: string
  readonly providerId: string
}

const parseBatchAcceptance = (
  recipients: ReadonlyArray<{ readonly id: string }>,
  sent: ReadonlyArray<SentEmail>,
): ReadonlyArray<AcceptedRecipient> | undefined => {
  if (sent.length !== recipients.length || recipients.length === 0) return undefined
  const accepted: AcceptedRecipient[] = []
  const providerIds = new Set<string>()
  for (const [index, recipient] of recipients.entries()) {
    const providerId = sent[index]?.providerId
    if (typeof providerId !== "string" || !providerId || providerIds.has(providerId)) return undefined
    providerIds.add(providerId)
    accepted.push({ recipientId: recipient.id, providerId })
  }
  return accepted
}

const UNKNOWN = "The email service may have accepted this email. Automatic retries stopped to avoid sending it twice."
const RETRY_WINDOW_MS = (24 * 60 - 5) * 60_000

/** Durable broadcast delivery. Leases fence database writes; provider keys protect network retries. */
export class BroadcastSender extends Context.Service<
  BroadcastSender,
  {
    readonly sendBatch: Effect.Effect<number>
    readonly drain: Effect.Effect<number, DatabaseUnavailable>
  }
>()("@parley/core/BroadcastSender") {
  static readonly layer = Layer.effect(
    BroadcastSender,
    Effect.gen(function* () {
      const db = yield* Database
      const mailer = yield* Mailer
      const links = yield* UnsubscribeLinks
      const lastTeam = yield* Ref.make("")
      const batchesTable = schema.broadcastBatches
      const recipientsTable = schema.broadcastRecipients
      const broadcastsTable = schema.broadcasts
      const eligibleTeams = Effect.gen(function* () {
        const rows = yield* db.query((d) =>
          d.execute<{ team_id: string }>(sql`
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
        const teams = rows.rows.map((row) => row.team_id)
        const last = yield* Ref.get(lastTeam)
        const after = teams.findIndex((team) => team > last)
        return after < 0 ? teams : [...teams.slice(after), ...teams.slice(0, after)]
      })

      const claim = (teamId: string) =>
        db.transaction(
          Effect.gen(function* () {
            const [batch] = yield* db.query((d) =>
              d
                .select()
                .from(batchesTable)
                .where(
                  and(
                    eq(batchesTable.teamId, teamId),
                    eq(batchesTable.status, "pending"),
                    sql`${batchesTable.nextAttemptAt} <= now()`,
                    sql`(${batchesTable.leaseUntil} is null or ${batchesTable.leaseUntil} <= now())`,
                  ),
                )
                .orderBy(asc(batchesTable.nextAttemptAt))
                .limit(1)
                .for("update", { skipLocked: true }),
            )
            if (!batch) return undefined
            const claimToken = crypto.randomUUID()
            const [claimed] = yield* db.query((d) =>
              d
                .update(batchesTable)
                .set({ claimToken, leaseUntil: sql`now() + interval '10 minutes'` })
                .where(eq(batchesTable.id, batch.id))
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
                .from(broadcastsTable)
                .where(
                  and(
                    eq(broadcastsTable.teamId, teamId),
                    eq(broadcastsTable.status, "sending"),
                    sql`exists (select 1 from broadcast_recipients recipientsTable where recipientsTable.broadcast_id = ${broadcastsTable.id} and recipientsTable.status = 'queued' and recipientsTable.batch_id is null)`,
                  ),
                )
                .orderBy(asc(broadcastsTable.createdAt))
                .limit(1)
                .for("update", { skipLocked: true }),
            )
            if (!broadcast) return undefined
            const recipients = yield* db.query((d) =>
              d
                .select()
                .from(recipientsTable)
                .where(
                  and(
                    eq(recipientsTable.broadcastId, broadcast.id),
                    eq(recipientsTable.status, "queued"),
                    sql`${recipientsTable.batchId} is null`,
                  ),
                )
                .orderBy(asc(recipientsTable.createdAt), asc(recipientsTable.id))
                .limit(100)
                .for("update"),
            )
            const sender = broadcast.sentAs as SendAs | null
            const ready: Array<{ recipient: (typeof recipients)[number]; email: OutgoingEmail }> = []
            const failedIds: string[] = []
            for (const recipient of recipients) {
              if (!sender || !recipient.address) {
                failedIds.push(recipient.id)
                continue
              }
              const token = links.sign({
                teamId: broadcast.teamId as TeamId,
                contactId: recipient.contactId as ContactId | null,
                topicId: broadcast.topicId as TopicId | null,
                broadcastId: broadcast.id as BroadcastId,
                test: false,
              })
              const urls = links.urls(token)
              const merge = recipient.merge
              const values: MergeValues = {
                first_name: merge.first_name ?? "",
                last_name: merge.last_name ?? "",
                name: [merge.first_name, merge.last_name].filter(Boolean).join(" "),
                email: merge.email ?? recipient.address,
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
              ready.push({
                recipient,
                email: {
                  to: recipient.address,
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
                },
              })
            }
            if (failedIds.length > 0)
              yield* db.query((d) =>
                d
                  .update(recipientsTable)
                  .set({ status: "failed", error: "This broadcast couldn't be prepared for sending." })
                  .where(inArray(recipientsTable.id, failedIds)),
              )
            if (ready.length === 0) return { handled: recipients.length }
            const prepared = yield* mailer.prepareBatch(ready.map((entry) => entry.email)).pipe(Effect.result)
            if (prepared._tag === "Failure") {
              yield* db.query((d) =>
                d
                  .update(recipientsTable)
                  .set({ status: "failed", error: prepared.failure.userMessage })
                  .where(
                    inArray(
                      recipientsTable.id,
                      ready.map((entry) => entry.recipient.id),
                    ),
                  ),
              )
              return { handled: recipients.length }
            }
            const claimToken = crypto.randomUUID()
            const [batch] = yield* db.query((d) =>
              d
                .insert(batchesTable)
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
            if (!batch) return yield* Effect.die("Preparing a broadcast batch returned no row")
            const positions = sql.join(
              ready.map((entry, position) => sql`(${entry.recipient.id}::uuid, ${position}::integer)`),
              sql`, `,
            )
            yield* db.query((d) =>
              d.execute(sql`update broadcast_recipients r
              set batch_id = ${batch.id}, batch_position = selected.position
              from (values ${positions}) as selected(id, position)
              where r.id = selected.id and r.broadcast_id = ${broadcast.id} and r.team_id = ${teamId}`),
            )
            return { batch: { ...batch, claimToken }, handled: recipients.length }
          }),
        )

      const owned = (batch: ClaimedBatch) =>
        and(
          eq(batchesTable.id, batch.id),
          eq(batchesTable.status, "pending"),
          eq(batchesTable.claimToken, batch.claimToken),
          sql`${batchesTable.leaseUntil} > clock_timestamp()`,
        )

      const finish = (teamId: string) =>
        db.query((d) =>
          d.execute(sql`with finished as (
        select c.id from broadcasts c where c.team_id = ${teamId} and c.status = 'sending'
          and not exists (select 1 from broadcast_recipients r where r.broadcast_id = c.id and r.status = 'queued')
        for update of c skip locked
      ) update broadcasts set status = 'sent', finished_at = now(), updated_at = now()
        where id in (select id from finished)`),
        )

      const settle = (batch: ClaimedBatch, outcome: BatchOutcome) =>
        db.transaction(
          Effect.gen(function* () {
            const { status } = outcome
            const message = outcome.status === "sent" ? null : outcome.message
            const [changed] = yield* db.query((d) =>
              d
                .update(batchesTable)
                .set({ status, claimToken: null, leaseUntil: null, updatedAt: sql`now()` })
                .where(owned(batch))
                .returning(),
            )
            if (!changed) return
            if (outcome.status !== "sent") {
              yield* db.query((d) =>
                d
                  .update(recipientsTable)
                  .set({ status, error: message, nextAttemptAt: null, updatedAt: sql`now()` })
                  .where(and(eq(recipientsTable.batchId, batch.id), eq(recipientsTable.status, "queued"))),
              )
              return
            }
            const deliveries = sql.join(
              outcome.accepted.map(({ recipientId, providerId }) => sql`(${recipientId}::uuid, ${providerId}::text)`),
              sql`, `,
            )
            yield* db.query((d) =>
              d.execute(sql`with delivered as (
              update broadcast_recipients r set status = 'sent', error = null, next_attempt_at = null,
                provider_id = delivery.provider_id, sent_at = now(), updated_at = now()
              from (values ${deliveries}) as delivery(id, provider_id)
              where r.id = delivery.id and r.batch_id = ${batch.id} and r.status = 'queued'
              returning r.contact_id
            ) insert into activity (id, team_id, record_type, record_id, kind, changed_fields,
                related_record_type, related_record_id, related_name, actor_user_id, actor_name)
              select gen_random_uuid(), c.team_id, 'contact', delivered.contact_id, 'emailed', array[]::text[],
                'broadcast', c.id, c.name, c.sent_by_user_id, coalesce(c.sent_by_name, 'Parley')
              from delivered join broadcasts c on c.id = ${batch.broadcastId}
              where delivered.contact_id is not null`),
            )
          }),
        )

      const dispatch = (batch: ClaimedBatch) =>
        Effect.gen(function* () {
          const recipients = yield* db.query((d) =>
            d
              .select({ id: recipientsTable.id })
              .from(recipientsTable)
              .where(eq(recipientsTable.batchId, batch.id))
              .orderBy(asc(recipientsTable.batchPosition)),
          )
          if (batch.firstAttemptAt && batch.firstAttemptAt.getTime() + RETRY_WINDOW_MS <= Date.now()) {
            yield* settle(batch, { status: "unknown", message: UNKNOWN })
            return recipients.length
          }
          // Cancellation and the first possible dispatch serialize on the broadcast row.
          const attempt = yield* db.transaction(
            Effect.gen(function* () {
              const [broadcast] = yield* db.query((d) =>
                d
                  .select({ status: broadcastsTable.status })
                  .from(broadcastsTable)
                  .where(eq(broadcastsTable.id, batch.broadcastId))
                  .for("update"),
              )
              if (!batch.firstAttemptAt && broadcast?.status !== "sending") {
                yield* settle(batch, { status: "canceled", message: null })
                return undefined
              }
              const [started] = yield* db.query((d) =>
                d
                  .update(batchesTable)
                  .set({
                    firstAttemptAt: sql`coalesce(${batchesTable.firstAttemptAt}, now())`,
                    attempts: sql`${batchesTable.attempts} + 1`,
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
              idempotencyKey: Schema.decodeUnknownSync(EmailIdempotencyKey)(attempt.id),
              count: recipients.length,
              retryUntil: new Date(attempt.firstAttemptAt.getTime() + RETRY_WINDOW_MS),
            })
            .pipe(Effect.result)
          if (outcome._tag === "Success") {
            const accepted = parseBatchAcceptance(recipients, outcome.success)
            if (!accepted) {
              yield* Effect.logWarning("broadcast provider response did not match the batch")
              yield* retry(attempt, Duration.minutes(2))
            } else yield* settle(attempt, { status: "sent", accepted })
          } else {
            const error = outcome.failure
            yield* Effect.logWarning("broadcast provider request failed", error)
            switch (error._tag) {
              case "EmailSendingTooFast":
                yield* retry(attempt, error.retryAfter)
                break
              case "EmailServiceUnavailable":
              case "EmailDeliveryUnconfirmed":
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
            .update(batchesTable)
            .set({
              nextAttemptAt: sql`now() + make_interval(secs => ${Math.max(1, Math.ceil(Duration.toSeconds(after)))})`,
              claimToken: null,
              leaseUntil: null,
              updatedAt: sql`now()`,
            })
            .where(owned(batch)),
        )

      const sendNext = Effect.gen(function* () {
        const teams = yield* eligibleTeams
        for (const teamId of teams) {
          yield* Ref.set(lastTeam, teamId)
          const claimed = yield* claim(teamId)
          if (claimed) {
            const handled = yield* dispatch(claimed)
            yield* finish(teamId)
            return handled
          }
          const prepared = yield* prepare(teamId)
          if (prepared?.batch) yield* dispatch(prepared.batch)
          yield* finish(teamId)
          if (prepared) return prepared.handled
        }
        return undefined
      }).pipe(Effect.withSpan("BroadcastSender.sendBatch"))
      const sendBatch = sendNext.pipe(
        Effect.map((handled) => handled ?? 0),
        Effect.catchTag("SqlError", (error) =>
          Effect.logWarning("broadcast worker database operation failed", Cause.fail(error)).pipe(Effect.as(0)),
        ),
      )
      const drain = Effect.gen(function* () {
        let total = 0
        for (;;) {
          const handled = yield* sendNext
          if (handled === undefined) return total
          total += handled
        }
      }).pipe(Effect.catchTag("SqlError", classifySqlError))

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
