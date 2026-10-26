import { Database, schema } from "@parley/db"
import type { BroadcastId, ContactId, EmailError, TeamId, TopicId } from "@parley/domain"
import { eq, inArray, sql } from "drizzle-orm"
import { Config, Context, Duration, Effect, Layer, Ref } from "effect"
import { type MergeValues, renderEmail } from "../email/render.ts"
import { Mailer, type OutgoingEmail } from "../mail/mailer.ts"
import { styleSentWith } from "./broadcasts.ts"
import type { Sender } from "./sending.ts"
import { UnsubscribeLinks } from "./unsubscribe-links.ts"

const BATCH = 100
/** How long a claimed batch is held before another server may try it again. */
const LEASE_MINUTES = 10
const MAX_ATTEMPTS = 5

interface Claimed {
  readonly id: string
  readonly broadcast_id: string
  readonly contact_id: string | null
  readonly address: string | null
  readonly name: string
  readonly merge: Record<string, string>
  readonly attempts: number
}

/** Rows from a raw query, however the driver shapes the result. */
const rowsOf = <A>(result: unknown): ReadonlyArray<A> =>
  Array.isArray(result) ? (result as ReadonlyArray<A>) : ((result as { readonly rows?: ReadonlyArray<A> }).rows ?? [])

/**
 * Sends queued broadcast email in the background (R43). Process tier: shared by every team, so it
 * holds no team's data. Each message carries its own team's sender and footer, copied onto the
 * broadcast when it started (03-tiers). Postgres is the queue, so several servers can share it.
 */
export class BroadcastSender extends Context.Service<
  BroadcastSender,
  {
    /** Sends one batch for the next team in turn, if any is due. How many recipients it handled. */
    readonly sendBatch: Effect.Effect<number>
    /** Sends until nothing is due. For tests and for draining on demand. */
    readonly drain: Effect.Effect<number>
  }
>()("@parley/core/BroadcastSender") {
  static readonly layer = Layer.effect(
    BroadcastSender,
    Effect.gen(function* () {
      const db = yield* Database
      const mailer = yield* Mailer
      const links = yield* UnsubscribeLinks
      // Teams take turns, a batch each, so one big broadcast doesn't hold up everyone else's.
      const lastTeam = yield* Ref.make("")

      const nextTeam = Effect.gen(function* () {
        const teams = rowsOf<{ team_id: string }>(
          yield* db.query((d) =>
            d.execute(sql`select distinct r.team_id from "broadcast_recipients" r
              join "broadcasts" c on c.id = r.broadcast_id
              where r.status = 'queued' and c.status = 'sending'
                and (r.next_attempt_at is null or r.next_attempt_at <= now())
              order by r.team_id`),
          ),
        ).map((row) => row.team_id)
        const last = yield* Ref.get(lastTeam)
        const next = teams.find((team) => team > last) ?? teams[0]
        if (next) yield* Ref.set(lastTeam, next)
        return next
      })

      const claim = (teamId: string) =>
        db
          .query((d) =>
            d.execute(sql`update "broadcast_recipients"
              set next_attempt_at = now() + make_interval(mins => ${LEASE_MINUTES}),
                attempts = attempts + 1, updated_at = now()
              where id in (
                select r.id from "broadcast_recipients" r join "broadcasts" c on c.id = r.broadcast_id
                where r.team_id = ${teamId} and r.status = 'queued' and c.status = 'sending'
                  and (r.next_attempt_at is null or r.next_attempt_at <= now())
                order by r.created_at limit ${BATCH}
                for update of r skip locked)
              returning id, broadcast_id, contact_id, address, name, merge, attempts`),
          )
          .pipe(Effect.map(rowsOf<Claimed>))

      const markSent = (claimed: Claimed, providerId: string) =>
        db.query((d) =>
          d
            .update(schema.broadcastRecipients)
            .set({
              status: "sent",
              providerId: providerId || null,
              sentAt: sql`now()`,
              nextAttemptAt: null,
              error: null,
              updatedAt: sql`now()`,
            })
            .where(eq(schema.broadcastRecipients.id, claimed.id)),
        )

      const markFailed = (ids: ReadonlyArray<string>, error: string) =>
        db.query((d) =>
          d
            .update(schema.broadcastRecipients)
            .set({ status: "failed", error, nextAttemptAt: null, updatedAt: sql`now()` })
            .where(inArray(schema.broadcastRecipients.id, [...ids])),
        )

      const retryLater = (ids: ReadonlyArray<string>, after: Duration.Duration) =>
        db.query((d) =>
          d
            .update(schema.broadcastRecipients)
            .set({
              nextAttemptAt: sql`now() + make_interval(secs => ${Math.ceil(Duration.toSeconds(after))})`,
              updatedAt: sql`now()`,
            })
            .where(inArray(schema.broadcastRecipients.id, [...ids])),
        )

      /** What happens to a batch the provider didn't take: wait and retry, or give up in our words. */
      const handleFailure = (claimed: ReadonlyArray<Claimed>, error: EmailError) =>
        Effect.gen(function* () {
          const ids = claimed.map((row) => row.id)
          switch (error._tag) {
            case "EmailSendingTooFast":
              return yield* retryLater(ids, error.retryAfter ?? Duration.minutes(1))
            case "EmailServiceUnavailable": {
              const exhausted = claimed.filter((row) => row.attempts >= MAX_ATTEMPTS).map((row) => row.id)
              const again = claimed.filter((row) => row.attempts < MAX_ATTEMPTS)
              if (exhausted.length > 0) yield* markFailed(exhausted, error.userMessage)
              for (const row of again) yield* retryLater([row.id], Duration.minutes(2 ** row.attempts))
              return
            }
            default:
              return yield* markFailed(ids, error.userMessage)
          }
        })

      /** A broadcast with nothing left queued is sent. */
      const finish = (broadcastIds: ReadonlyArray<string>) =>
        Effect.forEach(broadcastIds, (broadcastId) =>
          db.query((d) =>
            d.execute(sql`update "broadcasts" set status = 'sent', finished_at = now(), updated_at = now()
              where id = ${broadcastId} and status = 'sending'
                and not exists (select 1 from "broadcast_recipients" r
                  where r.broadcast_id = ${broadcastId} and r.status = 'queued')`),
          ),
        )

      const sendBatch = Effect.gen(function* () {
        const teamId = yield* nextTeam
        if (!teamId) return 0
        const claimed = yield* claim(teamId)
        if (claimed.length === 0) return 0
        const broadcastIds = [...new Set(claimed.map((row) => row.broadcast_id))]
        const broadcasts = yield* db.query((d) =>
          d.select().from(schema.broadcasts).where(inArray(schema.broadcasts.id, broadcastIds)),
        )
        const byId = new Map(broadcasts.map((broadcast) => [broadcast.id, broadcast]))

        const ready: Array<{ readonly row: Claimed; readonly email: OutgoingEmail }> = []
        for (const row of claimed) {
          const broadcast = byId.get(row.broadcast_id)
          const sender = broadcast?.sentAs as Sender | null | undefined
          if (!broadcast || !sender || !row.address) {
            yield* markFailed([row.id], "This broadcast couldn't be prepared for sending.")
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
          ready.push({
            row,
            email: {
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
            },
          })
        }

        if (ready.length > 0) {
          const outcome = yield* Effect.result(mailer.sendBatch(ready.map((entry) => entry.email)))
          if (outcome._tag === "Failure") {
            yield* handleFailure(
              ready.map((entry) => entry.row),
              outcome.failure,
            )
          } else {
            yield* db.transaction(
              Effect.forEach(ready, (entry, index) =>
                Effect.gen(function* () {
                  yield* markSent(entry.row, outcome.success[index]?.providerId ?? "")
                  const broadcast = byId.get(entry.row.broadcast_id)
                  if (!broadcast || !entry.row.contact_id) return
                  // Credited to whoever pressed Send (R49).
                  yield* db.query((d) =>
                    d.insert(schema.activity).values({
                      id: crypto.randomUUID(),
                      teamId: broadcast.teamId,
                      recordType: "contact",
                      recordId: entry.row.contact_id as string,
                      kind: "emailed",
                      changedFields: [],
                      relatedRecordType: "broadcast",
                      relatedRecordId: broadcast.id,
                      relatedName: broadcast.name,
                      actorUserId: broadcast.sentByUserId,
                      actorName: broadcast.sentByName ?? "Parley",
                    }),
                  )
                }),
              ),
            )
          }
        }
        yield* finish(broadcastIds)
        return claimed.length
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

  /** Keeps sending: paced to EMAIL_BATCHES_PER_SECOND (default 2, Resend's limit), idle checks every 2s. */
  static readonly schedule = Layer.effectDiscard(
    Effect.gen(function* () {
      const sender = yield* BroadcastSender
      const perSecond = yield* Config.withDefault(Config.Number("EMAIL_BATCHES_PER_SECOND"), 2).pipe(Effect.orDie)
      const pause = Duration.millis(Math.ceil(1000 / Math.max(perSecond, 0.1)))
      yield* Effect.forkScoped(
        Effect.forever(
          sender.sendBatch.pipe(
            Effect.flatMap((handled) => Effect.sleep(handled > 0 ? pause : Duration.seconds(2))),
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
