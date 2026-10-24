import { Database, schema } from "@parley/db"
import {
  type Broadcast,
  type BroadcastCounts,
  type BroadcastId,
  BroadcastNotSending,
  type BroadcastStatus,
  type DatabaseUnavailable,
  type EmailStyleId,
  type Recipient,
  type RecipientStatus,
  SegmentHasNoRecipients,
  type SegmentId,
  type SkipReason,
  type TeamId,
  type TopicId,
  type UserId,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { PLAIN_STYLE, type RenderStyle } from "../email/render.ts"
import type { BroadcastInTeam, BroadcastIsDraft } from "../proofs/broadcast-in-team.ts"
import type { CanSendEmail, CanWriteEmail, MemberOf } from "../proofs/permissions.ts"
import type { SegmentInTeam, SegmentOfTeam } from "../proofs/segment-in-team.ts"
import type { TemplateOfTeam } from "../proofs/template-in-team.ts"
import type { TopicsInTeam } from "../proofs/topic-in-team.ts"
import type { ContactScope } from "./contacts.ts"
import type { Sender } from "./sending.ts"
import { classifySqlError } from "./sql-errors.ts"
import { type ContentInput, type StyleChoice, styleColumnOf } from "./templates.ts"

type Row = typeof schema.broadcasts.$inferSelect

/** Rows from a raw query, however the driver shapes the result. */
const rowsOf = <A>(result: unknown): ReadonlyArray<A> =>
  Array.isArray(result) ? (result as ReadonlyArray<A>) : ((result as { readonly rows?: ReadonlyArray<A> }).rows ?? [])

const ZERO: BroadcastCounts = {
  recipients: 0,
  queued: 0,
  sent: 0,
  delivered: 0,
  skipped: 0,
  failed: 0,
  bounced: 0,
  markedAsSpam: 0,
  cancelled: 0,
  unsubscribed: 0,
}

/**
 * What a broadcast was sent as, copied when sending starts (R42): the sender, footer and email
 * style. Broadcasts sent before email styles have no style and render plain.
 */
export interface SentAs extends Sender {
  readonly style?: RenderStyle | undefined
}

/** The look a sent broadcast was sent with. */
export const styleSentWith = (sentAs: unknown): RenderStyle => ({
  ...PLAIN_STYLE,
  // Older snapshots predate settings added since (such as footerAlign); the plain look fills them in.
  ...(sentAs as SentAs | null | undefined)?.style,
})

const COUNT_KEY: Readonly<Record<RecipientStatus, keyof BroadcastCounts>> = {
  queued: "queued",
  sent: "sent",
  delivered: "delivered",
  skipped: "skipped",
  failed: "failed",
  bounced: "bounced",
  "marked-as-spam": "markedAsSpam",
  cancelled: "cancelled",
}

/** What changes on a draft. Undefined leaves a field; null clears the segment or topic. */
export interface DraftChanges<T> extends ContentInput, StyleChoice<T> {
  readonly name?: string | undefined
  readonly segment?: SegmentOfTeam<T> | null | undefined
  /** At most one topic: a broadcast has one or none. */
  readonly topic?: TopicsInTeam<T> | null | undefined
}

/**
 * Broadcasts (R42): drafts, and the record of what was sent. Process tier; the team comes with each
 * call. Sending itself is BroadcastSender's: this service only queues the recipients.
 */
export class Broadcasts extends Context.Service<
  Broadcasts,
  {
    readonly list: <P, T>(
      member: MemberOf<P, T>,
      status: BroadcastStatus | undefined,
    ) => Effect.Effect<ReadonlyArray<Broadcast>, DatabaseUnavailable>
    /** Used only by the BroadcastInTeam prover. */
    readonly locate: (teamId: TeamId, id: BroadcastId) => Effect.Effect<Broadcast | undefined, DatabaseUnavailable>
    readonly create: <P, T>(
      access: CanWriteEmail<P, T>,
      input: DraftChanges<T> & { readonly name: string; readonly template?: TemplateOfTeam<T> | undefined },
    ) => Effect.Effect<Broadcast, DatabaseUnavailable>
    readonly update: <P, T, C>(
      target: BroadcastInTeam<C, T>,
      draft: BroadcastIsDraft<C>,
      input: DraftChanges<T>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Broadcast, DatabaseUnavailable>
    readonly delete: <P, T, C>(
      target: BroadcastInTeam<C, T>,
      draft: BroadcastIsDraft<C>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Broadcast, DatabaseUnavailable>
    readonly duplicate: <P, T, C>(
      target: BroadcastInTeam<C, T>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Broadcast, DatabaseUnavailable>
    /**
     * Fixes the recipients and starts sending (R42): the segment's contacts now, each queued or
     * skipped with the reason. The sender and footer are copied onto the broadcast.
     */
    readonly queue: <P, T, C, S>(
      target: BroadcastInTeam<C, T>,
      draft: BroadcastIsDraft<C>,
      segment: SegmentInTeam<S, T>,
      scope: ContactScope,
      sentAs: SentAs,
      access: CanSendEmail<P, T>,
    ) => Effect.Effect<Broadcast, SegmentHasNoRecipients | DatabaseUnavailable>
    /** The look a broadcast that's no longer a draft was sent with. */
    readonly sentStyle: <C, T>(target: BroadcastInTeam<C, T>) => Effect.Effect<RenderStyle, DatabaseUnavailable>
    readonly cancel: <P, T, C>(
      target: BroadcastInTeam<C, T>,
      access: CanSendEmail<P, T>,
    ) => Effect.Effect<Broadcast, BroadcastNotSending | DatabaseUnavailable>
    readonly recipients: <C, T>(
      target: BroadcastInTeam<C, T>,
      query: {
        readonly status?: RecipientStatus | undefined
        readonly unsubscribed?: boolean | undefined
        readonly limit?: number | undefined
        readonly cursor?: string | undefined
      },
    ) => Effect.Effect<
      { readonly items: ReadonlyArray<Recipient>; readonly nextCursor: string | null },
      DatabaseUnavailable
    >
  }
>()("@parley/core/Broadcasts") {
  static readonly layer = Layer.effect(
    Broadcasts,
    Effect.gen(function* () {
      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      /**
       * Who unsubscribed through each broadcast's link (D119), by contact: "everything" when they
       * left all marketing email, "topic" when they left only the broadcast's topic.
       */
      const unsubscribesOf = (ids: ReadonlyArray<string>) =>
        ids.length === 0
          ? Effect.succeed(new Map<string, Map<string, "everything" | "topic">>())
          : run(
              db.query((d) =>
                d
                  .select({
                    broadcastId: schema.activity.relatedRecordId,
                    contactId: schema.activity.recordId,
                    everything: sql<boolean>`bool_or(${schema.activity.topicName} is null)`,
                  })
                  .from(schema.activity)
                  .where(
                    and(
                      eq(schema.activity.kind, "unsubscribed"),
                      eq(schema.activity.relatedRecordType, "broadcast"),
                      inArray(schema.activity.relatedRecordId, [...ids]),
                    ),
                  )
                  .groupBy(schema.activity.relatedRecordId, schema.activity.recordId),
              ),
            ).pipe(
              Effect.map((rows) => {
                const byBroadcast = new Map<string, Map<string, "everything" | "topic">>()
                for (const row of rows) {
                  if (!row.broadcastId) continue
                  const contacts = byBroadcast.get(row.broadcastId) ?? new Map<string, "everything" | "topic">()
                  contacts.set(row.contactId, row.everything ? "everything" : "topic")
                  byBroadcast.set(row.broadcastId, contacts)
                }
                return byBroadcast
              }),
            )

      const countsOf = (ids: ReadonlyArray<string>) =>
        ids.length === 0
          ? Effect.succeed(new Map<string, BroadcastCounts>())
          : run(
              db.query((d) =>
                d
                  .select({
                    broadcastId: schema.broadcastRecipients.broadcastId,
                    status: schema.broadcastRecipients.status,
                    count: sql<number>`count(*)::int`,
                  })
                  .from(schema.broadcastRecipients)
                  .where(inArray(schema.broadcastRecipients.broadcastId, [...ids]))
                  .groupBy(schema.broadcastRecipients.broadcastId, schema.broadcastRecipients.status),
              ),
            ).pipe(
              Effect.map((rows) => {
                const byBroadcast = new Map<string, BroadcastCounts>()
                for (const row of rows) {
                  const current = byBroadcast.get(row.broadcastId) ?? ZERO
                  const count = Number(row.count)
                  byBroadcast.set(row.broadcastId, {
                    ...current,
                    recipients: current.recipients + count,
                    [COUNT_KEY[row.status]]: current[COUNT_KEY[row.status]] + count,
                  })
                }
                return byBroadcast
              }),
              Effect.flatMap((byBroadcast) =>
                Effect.map(unsubscribesOf(ids), (unsubscribes) => {
                  for (const [broadcastId, contacts] of unsubscribes) {
                    byBroadcast.set(broadcastId, {
                      ...(byBroadcast.get(broadcastId) ?? ZERO),
                      unsubscribed: contacts.size,
                    })
                  }
                  return byBroadcast
                }),
              ),
            )

      const toBroadcast = (row: Row, counts: Map<string, BroadcastCounts>, names: Map<string, string>): Broadcast => ({
        id: row.id as BroadcastId,
        name: row.name,
        subject: row.subject,
        previewText: row.previewText,
        body: row.body,
        status: row.status,
        styleId: row.styleId as EmailStyleId | null,
        segmentId: row.segmentId as SegmentId | null,
        segmentName:
          row.status === "draft" ? (row.segmentId ? (names.get(row.segmentId) ?? null) : null) : row.segmentName,
        topicId: row.topicId as TopicId | null,
        topicName: row.status === "draft" ? (row.topicId ? (names.get(row.topicId) ?? null) : null) : row.topicName,
        sentByUserId: row.sentByUserId as UserId | null,
        sentByName: row.sentByName,
        sendingStartedAt: row.sendingStartedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
        counts: row.status === "draft" ? null : (counts.get(row.id) ?? ZERO),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })

      /** Drafts show their segment's and topic's current names; sent ones keep the names as sent. */
      const namesOf = (teamId: string) =>
        Effect.gen(function* () {
          const [segments, topics] = yield* Effect.all([
            run(
              db.query((d) =>
                d
                  .select({ id: schema.segments.id, name: schema.segments.name })
                  .from(schema.segments)
                  .where(eq(schema.segments.teamId, teamId)),
              ),
            ),
            run(
              db.query((d) =>
                d
                  .select({ id: schema.topics.id, name: schema.topics.name })
                  .from(schema.topics)
                  .where(eq(schema.topics.teamId, teamId)),
              ),
            ),
          ])
          return new Map([...segments, ...topics].map((entry) => [entry.id, entry.name]))
        })

      const summarize = (teamId: string, rows: ReadonlyArray<Row>) =>
        Effect.gen(function* () {
          const [counts, names] = yield* Effect.all([countsOf(rows.map((row) => row.id)), namesOf(teamId)])
          return rows.map((row) => toBroadcast(row, counts, names))
        })

      const rowOf = (teamId: string, id: string) =>
        run(
          db.query((d) =>
            d
              .select()
              .from(schema.broadcasts)
              .where(and(eq(schema.broadcasts.teamId, teamId), eq(schema.broadcasts.id, id))),
          ),
        ).pipe(Effect.map(([row]) => row))

      const one = (teamId: string, id: string) =>
        Effect.gen(function* () {
          const row = yield* rowOf(teamId, id)
          if (!row) return yield* Effect.die(new Error("broadcast vanished"))
          const [broadcast] = yield* summarize(teamId, [row])
          return broadcast as Broadcast
        })

      const changesOf = <T>(input: DraftChanges<T>) => ({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.previewText !== undefined ? { previewText: input.previewText } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.segment !== undefined ? { segmentId: input.segment?.found.id ?? null } : {}),
        ...(input.topic !== undefined ? { topicId: input.topic?.found[0]?.id ?? null } : {}),
        ...styleColumnOf(input),
      })

      const insertDraft = (teamId: string, values: Partial<typeof schema.broadcasts.$inferInsert> & { name: string }) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          yield* run(db.query((d) => d.insert(schema.broadcasts).values({ ...values, id, teamId, status: "draft" })))
          return yield* one(teamId, id)
        })

      const queue = <P, T, C, S>(
        target: BroadcastInTeam<C, T>,
        _draft: BroadcastIsDraft<C>,
        segment: SegmentInTeam<S, T>,
        scope: ContactScope,
        sentAs: SentAs,
        access: CanSendEmail<P, T>,
      ) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const broadcastId = target.broadcast.value
          const topicId = target.found.topicId
          const principal = access.member.principal.value
          const queued = yield* db
            .transaction(
              Effect.gen(function* () {
                // Two people pressing Send at once: the second finds it's no longer a draft.
                const [locked] = yield* db
                  .query((d) =>
                    d.execute(
                      sql`select status from "broadcasts" where id = ${broadcastId} and team_id = ${teamId} for update`,
                    ),
                  )
                  .pipe(Effect.map((result) => rowsOf<{ status: string }>(result)))
                if (locked?.status !== "draft") return 0
                // Who isn't on the topic: opt-out topics, those who left it; opt-in topics, everyone
                // who hasn't joined it (D149).
                const topicJoin = topicId
                  ? sql`left join lateral (select "contacts"."id" as contact_id where case
                      when (select t.mode from "topics" t where t.id = ${topicId}) = 'opt-in'
                        then not exists (select 1 from "topic_members" m
                          where m.contact_id = "contacts"."id" and m.topic_id = ${topicId})
                      else exists (select 1 from "topic_unsubscribes" u
                          where u.contact_id = "contacts"."id" and u.topic_id = ${topicId}) end) tu on true`
                  : sql`left join (select null::uuid as contact_id) tu on false`
                yield* db.query((d) =>
                  d.execute(sql`
                    insert into "broadcast_recipients"
                      (id, team_id, broadcast_id, contact_id, address, name, merge, status, skip_reason)
                    select gen_random_uuid(), "contacts"."team_id", ${broadcastId}, "contacts"."id", e.address,
                      coalesce(nullif(trim(concat_ws(' ', "contacts"."first_name", "contacts"."last_name")), ''), e.address, 'Contact'),
                      jsonb_build_object(
                        'first_name', coalesce("contacts"."first_name", ''),
                        'last_name', coalesce("contacts"."last_name", ''),
                        'email', coalesce(e.address, ''),
                        'company', coalesce(co.name, '')),
                      case
                        when e.address is null or "contacts"."subscription_status" <> 'subscribed'
                          or tu.contact_id is not null then 'skipped'
                        else 'queued' end,
                      case
                        when e.address is null then 'no-email'
                        when "contacts"."subscription_status" <> 'subscribed' then "contacts"."subscription_status"
                        when tu.contact_id is not null then 'unsubscribed-from-topic'
                        else null end
                    from "contacts"
                    left join lateral (
                      select ce.address from "contact_emails" ce
                      where ce.contact_id = "contacts"."id" and ce.active
                      order by ce.is_primary desc, ce.position asc limit 1) e on true
                    left join lateral (
                      select c2.name from "affiliations" a join "companies" c2 on c2.id = a.company_id
                      where a.contact_id = "contacts"."id" and c2.deleted_at is null
                      order by a.created_at asc limit 1) co on true
                    ${topicJoin}
                    where "contacts"."team_id" = ${teamId} and "contacts"."deleted_at" is null and (${scope.where})
                  `),
                )
                const [count] = yield* db.query((d) =>
                  d
                    .select({ queued: sql<number>`count(*)::int` })
                    .from(schema.broadcastRecipients)
                    .where(
                      and(
                        eq(schema.broadcastRecipients.broadcastId, broadcastId),
                        eq(schema.broadcastRecipients.status, "queued"),
                      ),
                    ),
                )
                const queuedCount = Number(count?.queued ?? 0)
                // Nobody to send to: undo the snapshot and leave the draft as it was.
                if (queuedCount === 0)
                  return yield* Effect.fail(
                    new SegmentHasNoRecipients({ segment: DisplayName.fromRecord(segment.found.name) }),
                  )
                yield* db.query((d) =>
                  d
                    .update(schema.broadcasts)
                    .set({
                      status: "sending",
                      sentAs,
                      segmentName: segment.found.name,
                      topicName: target.found.topicName,
                      sentByUserId: principal.userId,
                      sentByName: principal.name,
                      sendingStartedAt: sql`now()`,
                      updatedAt: sql`now()`,
                    })
                    .where(eq(schema.broadcasts.id, broadcastId)),
                )
                return queuedCount
              }),
            )
            .pipe(Effect.catchTag("SqlError", classifySqlError))
          void queued
          return yield* one(teamId, broadcastId)
        }).pipe(Effect.withSpan("Broadcasts.queue"))

      const cancel = <T, C>(target: BroadcastInTeam<C, T>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const broadcastId = target.broadcast.value
          const changed = yield* run(
            db.transaction(
              Effect.gen(function* () {
                const updated = yield* db.query((d) =>
                  d
                    .update(schema.broadcasts)
                    .set({ status: "cancelled", finishedAt: sql`now()`, updatedAt: sql`now()` })
                    .where(
                      and(
                        eq(schema.broadcasts.teamId, teamId),
                        eq(schema.broadcasts.id, broadcastId),
                        eq(schema.broadcasts.status, "sending"),
                      ),
                    )
                    .returning({ id: schema.broadcasts.id }),
                )
                if (updated.length === 0) return false
                yield* db.query((d) =>
                  d
                    .update(schema.broadcastRecipients)
                    .set({ status: "cancelled", updatedAt: sql`now()` })
                    .where(
                      and(
                        eq(schema.broadcastRecipients.broadcastId, broadcastId),
                        eq(schema.broadcastRecipients.status, "queued"),
                      ),
                    ),
                )
                return true
              }),
            ),
          )
          if (!changed) return yield* new BroadcastNotSending({ broadcast: DisplayName.fromRecord(target.found.name) })
          return yield* one(teamId, broadcastId)
        }).pipe(Effect.withSpan("Broadcasts.cancel"))

      const recipients = <C, T>(
        target: BroadcastInTeam<C, T>,
        query: {
          readonly status?: RecipientStatus | undefined
          readonly unsubscribed?: boolean | undefined
          readonly limit?: number | undefined
          readonly cursor?: string | undefined
        },
      ) =>
        Effect.gen(function* () {
          const limit = query.limit ?? 100
          const offset = query.cursor ? Number(Buffer.from(query.cursor, "base64url").toString()) || 0 : 0
          const unsubscribed = (yield* unsubscribesOf([target.broadcast.value])).get(target.broadcast.value)
          const unsubscribedIds = [...(unsubscribed?.keys() ?? [])]
          if (query.unsubscribed && unsubscribedIds.length === 0) return { items: [], nextCursor: null }
          const rows = yield* run(
            db.query((d) =>
              d
                .select()
                .from(schema.broadcastRecipients)
                .where(
                  and(
                    eq(schema.broadcastRecipients.broadcastId, target.broadcast.value),
                    eq(schema.broadcastRecipients.teamId, target.team.value),
                    query.status ? eq(schema.broadcastRecipients.status, query.status) : undefined,
                    query.unsubscribed ? inArray(schema.broadcastRecipients.contactId, unsubscribedIds) : undefined,
                  ),
                )
                .orderBy(schema.broadcastRecipients.name, schema.broadcastRecipients.id)
                .limit(limit + 1)
                .offset(offset),
            ),
          )
          const items = rows.slice(0, limit).map(
            (row): Recipient => ({
              contactId: row.contactId as Recipient["contactId"],
              name: row.name,
              address: row.address,
              status: row.status,
              skipReason: row.skipReason as SkipReason | null,
              error: row.error,
              sentAt: row.sentAt?.toISOString() ?? null,
              unsubscribed: (row.contactId ? unsubscribed?.get(row.contactId) : undefined) ?? null,
            }),
          )
          return {
            items,
            nextCursor: rows.length > limit ? Buffer.from(String(offset + limit)).toString("base64url") : null,
          }
        })

      return {
        list: (member, status) =>
          Effect.gen(function* () {
            const rows = yield* run(
              db.query((d) =>
                d
                  .select()
                  .from(schema.broadcasts)
                  .where(
                    and(
                      eq(schema.broadcasts.teamId, member.team.value),
                      status ? eq(schema.broadcasts.status, status) : undefined,
                    ),
                  )
                  .orderBy(desc(schema.broadcasts.updatedAt)),
              ),
            )
            return yield* summarize(member.team.value, rows)
          }),
        locate: (teamId, id) =>
          Effect.gen(function* () {
            const row = yield* rowOf(teamId, id)
            if (!row) return undefined
            const [broadcast] = yield* summarize(teamId, [row])
            return broadcast
          }),
        create: (access, input) => {
          const from = input.template?.found
          return insertDraft(access.member.team.value, {
            ...(from
              ? { subject: from.subject, previewText: from.previewText, body: from.body, styleId: from.styleId }
              : {}),
            ...changesOf(input),
            name: input.name,
          }).pipe(Effect.withSpan("Broadcasts.create"))
        },
        update: (target, _draft, input) =>
          Effect.gen(function* () {
            const teamId = target.team.value
            yield* run(
              db.query((d) =>
                d
                  .update(schema.broadcasts)
                  .set({ ...changesOf(input), updatedAt: sql`now()` })
                  .where(
                    and(
                      eq(schema.broadcasts.teamId, teamId),
                      eq(schema.broadcasts.id, target.broadcast.value),
                      eq(schema.broadcasts.status, "draft"),
                    ),
                  ),
              ),
            )
            return yield* one(teamId, target.broadcast.value)
          }).pipe(Effect.withSpan("Broadcasts.update")),
        delete: (target) =>
          Effect.gen(function* () {
            yield* run(
              db.query((d) =>
                d
                  .delete(schema.broadcasts)
                  .where(
                    and(
                      eq(schema.broadcasts.teamId, target.team.value),
                      eq(schema.broadcasts.id, target.broadcast.value),
                      eq(schema.broadcasts.status, "draft"),
                    ),
                  ),
              ),
            )
            return target.found
          }).pipe(Effect.withSpan("Broadcasts.delete")),
        duplicate: (target, access) =>
          Effect.gen(function* () {
            const source = target.found
            return yield* insertDraft(access.member.team.value, {
              name: `${source.name} (copy)`.slice(0, 120),
              subject: source.subject,
              previewText: source.previewText,
              body: source.body,
              segmentId: source.segmentId,
              topicId: source.topicId,
              styleId: source.styleId,
            })
          }).pipe(Effect.withSpan("Broadcasts.duplicate")),
        queue,
        sentStyle: (target) =>
          Effect.map(rowOf(target.team.value, target.broadcast.value), (row) => styleSentWith(row?.sentAs)),
        cancel,
        recipients,
      }
    }),
  )
}
