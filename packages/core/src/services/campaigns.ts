import { Database, schema } from "@parley/db"
import {
  type Campaign,
  type CampaignCounts,
  type CampaignId,
  CampaignNotSending,
  type CampaignStatus,
  type DatabaseUnavailable,
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
import type { CampaignInTeam, CampaignIsDraft } from "../proofs/campaign-in-team.ts"
import type { CanSendEmail, CanWriteEmail, MemberOf } from "../proofs/permissions.ts"
import type { SegmentInTeam, SegmentOfTeam } from "../proofs/segment-in-team.ts"
import type { TemplateOfTeam } from "../proofs/template-in-team.ts"
import type { TopicsInTeam } from "../proofs/topic-in-team.ts"
import type { ContactScope } from "./contacts.ts"
import type { Sender } from "./sending.ts"
import { classifySqlError } from "./sql-errors.ts"
import type { ContentInput } from "./templates.ts"

type Row = typeof schema.campaigns.$inferSelect

/** Rows from a raw query, however the driver shapes the result. */
const rowsOf = <A>(result: unknown): ReadonlyArray<A> =>
  Array.isArray(result) ? (result as ReadonlyArray<A>) : ((result as { readonly rows?: ReadonlyArray<A> }).rows ?? [])

const ZERO: CampaignCounts = {
  recipients: 0,
  queued: 0,
  sent: 0,
  delivered: 0,
  skipped: 0,
  failed: 0,
  bounced: 0,
  markedAsSpam: 0,
  cancelled: 0,
}

const COUNT_KEY: Readonly<Record<RecipientStatus, keyof CampaignCounts>> = {
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
export interface DraftChanges<T> extends ContentInput {
  readonly name?: string | undefined
  readonly segment?: SegmentOfTeam<T> | null | undefined
  /** At most one topic: a campaign has one or none. */
  readonly topic?: TopicsInTeam<T> | null | undefined
}

/**
 * Campaigns (R42): drafts, and the record of what was sent. Process tier; the team comes with each
 * call. Sending itself is CampaignSender's: this service only queues the recipients.
 */
export class Campaigns extends Context.Service<
  Campaigns,
  {
    readonly list: <P, T>(
      member: MemberOf<P, T>,
      status: CampaignStatus | undefined,
    ) => Effect.Effect<ReadonlyArray<Campaign>, DatabaseUnavailable>
    /** Used only by the CampaignInTeam prover. */
    readonly locate: (teamId: TeamId, id: CampaignId) => Effect.Effect<Campaign | undefined, DatabaseUnavailable>
    readonly create: <P, T>(
      access: CanWriteEmail<P, T>,
      input: DraftChanges<T> & { readonly name: string; readonly template?: TemplateOfTeam<T> | undefined },
    ) => Effect.Effect<Campaign, DatabaseUnavailable>
    readonly update: <P, T, C>(
      target: CampaignInTeam<C, T>,
      draft: CampaignIsDraft<C>,
      input: DraftChanges<T>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Campaign, DatabaseUnavailable>
    readonly delete: <P, T, C>(
      target: CampaignInTeam<C, T>,
      draft: CampaignIsDraft<C>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Campaign, DatabaseUnavailable>
    readonly duplicate: <P, T, C>(
      target: CampaignInTeam<C, T>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Campaign, DatabaseUnavailable>
    /**
     * Fixes the recipients and starts sending (R42): the segment's contacts now, each queued or
     * skipped with the reason. The sender and footer are copied onto the campaign.
     */
    readonly queue: <P, T, C, S>(
      target: CampaignInTeam<C, T>,
      draft: CampaignIsDraft<C>,
      segment: SegmentInTeam<S, T>,
      scope: ContactScope,
      sender: Sender,
      access: CanSendEmail<P, T>,
    ) => Effect.Effect<Campaign, SegmentHasNoRecipients | DatabaseUnavailable>
    readonly cancel: <P, T, C>(
      target: CampaignInTeam<C, T>,
      access: CanSendEmail<P, T>,
    ) => Effect.Effect<Campaign, CampaignNotSending | DatabaseUnavailable>
    readonly recipients: <C, T>(
      target: CampaignInTeam<C, T>,
      query: {
        readonly status?: RecipientStatus | undefined
        readonly limit?: number | undefined
        readonly cursor?: string | undefined
      },
    ) => Effect.Effect<
      { readonly items: ReadonlyArray<Recipient>; readonly nextCursor: string | null },
      DatabaseUnavailable
    >
  }
>()("@parley/core/Campaigns") {
  static readonly layer = Layer.effect(
    Campaigns,
    Effect.gen(function* () {
      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const countsOf = (ids: ReadonlyArray<string>) =>
        ids.length === 0
          ? Effect.succeed(new Map<string, CampaignCounts>())
          : run(
              db.query((d) =>
                d
                  .select({
                    campaignId: schema.campaignRecipients.campaignId,
                    status: schema.campaignRecipients.status,
                    count: sql<number>`count(*)::int`,
                  })
                  .from(schema.campaignRecipients)
                  .where(inArray(schema.campaignRecipients.campaignId, [...ids]))
                  .groupBy(schema.campaignRecipients.campaignId, schema.campaignRecipients.status),
              ),
            ).pipe(
              Effect.map((rows) => {
                const byCampaign = new Map<string, CampaignCounts>()
                for (const row of rows) {
                  const current = byCampaign.get(row.campaignId) ?? ZERO
                  const count = Number(row.count)
                  byCampaign.set(row.campaignId, {
                    ...current,
                    recipients: current.recipients + count,
                    [COUNT_KEY[row.status]]: current[COUNT_KEY[row.status]] + count,
                  })
                }
                return byCampaign
              }),
            )

      const toCampaign = (row: Row, counts: Map<string, CampaignCounts>, names: Map<string, string>): Campaign => ({
        id: row.id as CampaignId,
        name: row.name,
        subject: row.subject,
        previewText: row.previewText,
        body: row.body,
        status: row.status,
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
          return rows.map((row) => toCampaign(row, counts, names))
        })

      const rowOf = (teamId: string, id: string) =>
        run(
          db.query((d) =>
            d
              .select()
              .from(schema.campaigns)
              .where(and(eq(schema.campaigns.teamId, teamId), eq(schema.campaigns.id, id))),
          ),
        ).pipe(Effect.map(([row]) => row))

      const one = (teamId: string, id: string) =>
        Effect.gen(function* () {
          const row = yield* rowOf(teamId, id)
          if (!row) return yield* Effect.die(new Error("campaign vanished"))
          const [campaign] = yield* summarize(teamId, [row])
          return campaign as Campaign
        })

      const changesOf = <T>(input: DraftChanges<T>) => ({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.previewText !== undefined ? { previewText: input.previewText } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.segment !== undefined ? { segmentId: input.segment?.found.id ?? null } : {}),
        ...(input.topic !== undefined ? { topicId: input.topic?.found[0]?.id ?? null } : {}),
      })

      const insertDraft = (teamId: string, values: Partial<typeof schema.campaigns.$inferInsert> & { name: string }) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          yield* run(db.query((d) => d.insert(schema.campaigns).values({ ...values, id, teamId, status: "draft" })))
          return yield* one(teamId, id)
        })

      const queue = <P, T, C, S>(
        target: CampaignInTeam<C, T>,
        _draft: CampaignIsDraft<C>,
        segment: SegmentInTeam<S, T>,
        scope: ContactScope,
        sender: Sender,
        access: CanSendEmail<P, T>,
      ) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const campaignId = target.campaign.value
          const topicId = target.found.topicId
          const principal = access.member.principal.value
          const queued = yield* db
            .transaction(
              Effect.gen(function* () {
                // Two people pressing Send at once: the second finds it's no longer a draft.
                const [locked] = yield* db
                  .query((d) =>
                    d.execute(
                      sql`select status from "campaigns" where id = ${campaignId} and team_id = ${teamId} for update`,
                    ),
                  )
                  .pipe(Effect.map((result) => rowsOf<{ status: string }>(result)))
                if (locked?.status !== "draft") return 0
                const topicJoin = topicId
                  ? sql`left join "topic_unsubscribes" tu on tu.contact_id = "contacts"."id" and tu.topic_id = ${topicId}`
                  : sql`left join (select null::uuid as contact_id) tu on false`
                yield* db.query((d) =>
                  d.execute(sql`
                    insert into "campaign_recipients"
                      (id, team_id, campaign_id, contact_id, address, name, merge, status, skip_reason)
                    select gen_random_uuid(), "contacts"."team_id", ${campaignId}, "contacts"."id", e.address,
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
                    .from(schema.campaignRecipients)
                    .where(
                      and(
                        eq(schema.campaignRecipients.campaignId, campaignId),
                        eq(schema.campaignRecipients.status, "queued"),
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
                    .update(schema.campaigns)
                    .set({
                      status: "sending",
                      sentAs: sender,
                      segmentName: segment.found.name,
                      topicName: target.found.topicName,
                      sentByUserId: principal.userId,
                      sentByName: principal.name,
                      sendingStartedAt: sql`now()`,
                      updatedAt: sql`now()`,
                    })
                    .where(eq(schema.campaigns.id, campaignId)),
                )
                return queuedCount
              }),
            )
            .pipe(Effect.catchTag("SqlError", classifySqlError))
          void queued
          return yield* one(teamId, campaignId)
        }).pipe(Effect.withSpan("Campaigns.queue"))

      const cancel = <T, C>(target: CampaignInTeam<C, T>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const campaignId = target.campaign.value
          const changed = yield* run(
            db.transaction(
              Effect.gen(function* () {
                const updated = yield* db.query((d) =>
                  d
                    .update(schema.campaigns)
                    .set({ status: "cancelled", finishedAt: sql`now()`, updatedAt: sql`now()` })
                    .where(
                      and(
                        eq(schema.campaigns.teamId, teamId),
                        eq(schema.campaigns.id, campaignId),
                        eq(schema.campaigns.status, "sending"),
                      ),
                    )
                    .returning({ id: schema.campaigns.id }),
                )
                if (updated.length === 0) return false
                yield* db.query((d) =>
                  d
                    .update(schema.campaignRecipients)
                    .set({ status: "cancelled", updatedAt: sql`now()` })
                    .where(
                      and(
                        eq(schema.campaignRecipients.campaignId, campaignId),
                        eq(schema.campaignRecipients.status, "queued"),
                      ),
                    ),
                )
                return true
              }),
            ),
          )
          if (!changed) return yield* new CampaignNotSending({ campaign: DisplayName.fromRecord(target.found.name) })
          return yield* one(teamId, campaignId)
        }).pipe(Effect.withSpan("Campaigns.cancel"))

      const recipients = <C, T>(
        target: CampaignInTeam<C, T>,
        query: {
          readonly status?: RecipientStatus | undefined
          readonly limit?: number | undefined
          readonly cursor?: string | undefined
        },
      ) =>
        Effect.gen(function* () {
          const limit = query.limit ?? 100
          const offset = query.cursor ? Number(Buffer.from(query.cursor, "base64url").toString()) || 0 : 0
          const rows = yield* run(
            db.query((d) =>
              d
                .select()
                .from(schema.campaignRecipients)
                .where(
                  and(
                    eq(schema.campaignRecipients.campaignId, target.campaign.value),
                    eq(schema.campaignRecipients.teamId, target.team.value),
                    query.status ? eq(schema.campaignRecipients.status, query.status) : undefined,
                  ),
                )
                .orderBy(schema.campaignRecipients.name, schema.campaignRecipients.id)
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
                  .from(schema.campaigns)
                  .where(
                    and(
                      eq(schema.campaigns.teamId, member.team.value),
                      status ? eq(schema.campaigns.status, status) : undefined,
                    ),
                  )
                  .orderBy(desc(schema.campaigns.updatedAt)),
              ),
            )
            return yield* summarize(member.team.value, rows)
          }),
        locate: (teamId, id) =>
          Effect.gen(function* () {
            const row = yield* rowOf(teamId, id)
            if (!row) return undefined
            const [campaign] = yield* summarize(teamId, [row])
            return campaign
          }),
        create: (access, input) => {
          const from = input.template?.found
          return insertDraft(access.member.team.value, {
            ...(from ? { subject: from.subject, previewText: from.previewText, body: from.body } : {}),
            ...changesOf(input),
            name: input.name,
          }).pipe(Effect.withSpan("Campaigns.create"))
        },
        update: (target, _draft, input) =>
          Effect.gen(function* () {
            const teamId = target.team.value
            yield* run(
              db.query((d) =>
                d
                  .update(schema.campaigns)
                  .set({ ...changesOf(input), updatedAt: sql`now()` })
                  .where(
                    and(
                      eq(schema.campaigns.teamId, teamId),
                      eq(schema.campaigns.id, target.campaign.value),
                      eq(schema.campaigns.status, "draft"),
                    ),
                  ),
              ),
            )
            return yield* one(teamId, target.campaign.value)
          }).pipe(Effect.withSpan("Campaigns.update")),
        delete: (target) =>
          Effect.gen(function* () {
            yield* run(
              db.query((d) =>
                d
                  .delete(schema.campaigns)
                  .where(
                    and(
                      eq(schema.campaigns.teamId, target.team.value),
                      eq(schema.campaigns.id, target.campaign.value),
                      eq(schema.campaigns.status, "draft"),
                    ),
                  ),
              ),
            )
            return target.found
          }).pipe(Effect.withSpan("Campaigns.delete")),
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
            })
          }).pipe(Effect.withSpan("Campaigns.duplicate")),
        queue,
        cancel,
        recipients,
      }
    }),
  )
}
