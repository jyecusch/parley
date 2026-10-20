import { Database, schema } from "@parley/db"
import type {
  ContactId,
  ContactSubscriptions,
  DatabaseUnavailable,
  SubscriptionStatus,
  TeamId,
  TopicId,
  UnsubscribeChange,
  UnsubscribePage,
} from "@parley/domain"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { ContactInTeam } from "../proofs/contact-in-team.ts"
import type { CanManageEmail, CanReadRecords, CanWriteRecords } from "../proofs/permissions.ts"
import type { TopicsInTeam } from "../proofs/topic-in-team.ts"
import type { UnsubscribeLinkValid } from "../proofs/unsubscribe-link.ts"
import { activityRow } from "./activity.ts"
import { classifySqlError } from "./sql-errors.ts"

/** "sam@acme.com" → "s**@acme.com": enough to recognise, not enough to harvest. */
const mask = (address: string) => {
  const [local = "", domain = ""] = address.split("@")
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`
}

/** Who changed a subscription through an unsubscribe link: the contact themselves. */
const viaLink = (name: string) => ({
  actorUserId: null,
  actorName: name,
  viaApiKeyId: null,
  viaConnectionId: null,
  viaName: "unsubscribe link",
})

/**
 * Subscriptions (R37, R38, R39): which topics a contact has left, and changes made from the
 * unsubscribe page. A contact's overall subscription status lives on the contact.
 */
export class Subscriptions extends Context.Service<
  Subscriptions,
  {
    readonly ofContact: <P, T, C>(
      target: ContactInTeam<C, T>,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<ContactSubscriptions, DatabaseUnavailable>
    readonly updateTopics: <P, T, C>(
      target: ContactInTeam<C, T>,
      topics: TopicsInTeam<T>,
      subscribed: ReadonlyMap<TopicId, boolean>,
      access: CanWriteRecords<P, T>,
      /** Needed to put someone back on a topic they left. */
      resubscribe?: CanManageEmail<P, T>,
    ) => Effect.Effect<ContactSubscriptions, DatabaseUnavailable>
    readonly page: <L>(link: UnsubscribeLinkValid<L>) => Effect.Effect<UnsubscribePage, DatabaseUnavailable>
    readonly apply: <L>(
      link: UnsubscribeLinkValid<L>,
      change: UnsubscribeChange,
    ) => Effect.Effect<UnsubscribePage, DatabaseUnavailable>
  }
>()("@parley/core/Subscriptions") {
  static readonly layer = Layer.effect(
    Subscriptions,
    Effect.gen(function* () {
      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const topicsWithState = (teamId: TeamId, contactId: string) =>
        run(
          db.query((d) =>
            d
              .select({
                id: schema.topics.id,
                name: schema.topics.name,
                description: schema.topics.description,
                left: sql<boolean>`exists (select 1 from "topic_unsubscribes" u
                  where u.topic_id = "topics"."id" and u.contact_id = ${contactId})`,
              })
              .from(schema.topics)
              .where(eq(schema.topics.teamId, teamId))
              .orderBy(asc(schema.topics.name)),
          ),
        )

      const contactOf = (teamId: TeamId, contactId: string) =>
        run(
          db.query((d) =>
            d
              .select({
                status: schema.contacts.subscriptionStatus,
                firstName: schema.contacts.firstName,
                lastName: schema.contacts.lastName,
                deletedAt: schema.contacts.deletedAt,
                address: sql<string | null>`(select e.address from "contact_emails" e
                  where e.contact_id = "contacts"."id" order by e.is_primary desc, e.position asc limit 1)`,
              })
              .from(schema.contacts)
              .where(and(eq(schema.contacts.teamId, teamId), eq(schema.contacts.id, contactId))),
          ),
        ).pipe(Effect.map(([row]) => (row && !row.deletedAt ? row : undefined)))

      const subscriptionsOf = (teamId: TeamId, contactId: string) =>
        Effect.gen(function* () {
          const [contact, topics] = yield* Effect.all([
            contactOf(teamId, contactId),
            topicsWithState(teamId, contactId),
          ])
          const result: ContactSubscriptions = {
            contactId: contactId as ContactId,
            status: contact?.status ?? "unsubscribed",
            topics: topics.map((topic) => ({
              topicId: topic.id as TopicId,
              name: topic.name,
              subscribed: !topic.left,
            })),
          }
          return result
        })

      /** Leaves or rejoins one topic. Returns whether anything changed. */
      const setTopic = (teamId: TeamId, contactId: string, topicId: string, subscribed: boolean) =>
        subscribed
          ? db
              .query((d) =>
                d
                  .delete(schema.topicUnsubscribes)
                  .where(
                    and(
                      eq(schema.topicUnsubscribes.contactId, contactId),
                      eq(schema.topicUnsubscribes.topicId, topicId),
                    ),
                  )
                  .returning({ topicId: schema.topicUnsubscribes.topicId }),
              )
              .pipe(Effect.map((rows) => rows.length > 0))
          : db
              .query((d) =>
                d
                  .insert(schema.topicUnsubscribes)
                  .values({ teamId, contactId, topicId })
                  .onConflictDoNothing()
                  .returning({ topicId: schema.topicUnsubscribes.topicId }),
              )
              .pipe(Effect.map((rows) => rows.length > 0))

      const updateTopics = <P, T, C>(
        target: ContactInTeam<C, T>,
        topics: TopicsInTeam<T>,
        wanted: ReadonlyMap<TopicId, boolean>,
        access: CanWriteRecords<P, T>,
        resubscribe?: CanManageEmail<P, T>,
      ) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const contactId = target.contact.value
          yield* run(
            db.transaction(
              Effect.forEach(topics.found, (topic) =>
                Effect.gen(function* () {
                  const subscribed = wanted.get(topic.id)
                  if (subscribed === undefined) return
                  if (subscribed && !resubscribe) {
                    const [left] = yield* db.query((d) =>
                      d
                        .select({ topicId: schema.topicUnsubscribes.topicId })
                        .from(schema.topicUnsubscribes)
                        .where(
                          and(
                            eq(schema.topicUnsubscribes.contactId, contactId),
                            eq(schema.topicUnsubscribes.topicId, topic.id),
                          ),
                        ),
                    )
                    if (left) return yield* Effect.die(new Error("rejoining a topic needs email:manage"))
                  }
                  const changed = yield* setTopic(teamId, contactId, topic.id, subscribed)
                  if (!changed) return
                  yield* db.query((d) =>
                    d.insert(schema.activity).values(
                      activityRow(access.member.principal.value, {
                        teamId,
                        recordType: "contact",
                        recordId: contactId,
                        kind: subscribed ? "resubscribed" : "unsubscribed",
                        topicName: topic.name,
                      }),
                    ),
                  )
                }),
              ),
            ),
          )
          return yield* subscriptionsOf(teamId, contactId)
        }).pipe(Effect.withSpan("Subscriptions.updateTopics"))

      const page = <L>(link: UnsubscribeLinkValid<L>) =>
        Effect.gen(function* () {
          const { teamId, contactId, topicId, test } = link.facts
          const [team] = yield* run(
            db.query((d) =>
              d
                .select({ name: schema.organization.name, legalName: schema.emailSettings.legalName })
                .from(schema.organization)
                .leftJoin(schema.emailSettings, eq(schema.emailSettings.teamId, schema.organization.id))
                .where(eq(schema.organization.id, teamId)),
            ),
          )
          const contact = contactId ? yield* contactOf(teamId, contactId) : undefined
          const topics = contact && contactId ? yield* topicsWithState(teamId, contactId) : []
          const result: UnsubscribePage = {
            senderName: team?.legalName ?? team?.name ?? "the sender",
            address: contact?.address ? mask(contact.address) : null,
            // A contact that no longer exists gets nothing more, which reads as unsubscribed.
            status: contact?.status ?? (test ? "subscribed" : "unsubscribed"),
            topicId: topics.some((topic) => topic.id === topicId) ? topicId : null,
            topics: topics.map((topic) => ({
              id: topic.id as TopicId,
              name: topic.name,
              description: topic.description,
              subscribed: !topic.left,
            })),
            test,
          }
          return result
        })

      const apply = <L>(link: UnsubscribeLinkValid<L>, change: UnsubscribeChange) =>
        Effect.gen(function* () {
          const { teamId, contactId, topicId, campaignId, test } = link.facts
          const contact = contactId && !test ? yield* contactOf(teamId, contactId) : undefined
          if (!contact || !contactId) return yield* page(link)
          const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.address || "Contact"
          const actor = viaLink(name)
          const recordActivity = (kind: "unsubscribed" | "resubscribed", topicName: string | null) =>
            db.query((d) =>
              d.insert(schema.activity).values({
                id: crypto.randomUUID(),
                teamId,
                recordType: "contact",
                recordId: contactId,
                kind,
                changedFields: [],
                topicName,
                ...(campaignId ? { relatedRecordType: "campaign" as const, relatedRecordId: campaignId } : {}),
                ...actor,
              }),
            )
          const setStatus = (status: SubscriptionStatus) =>
            Effect.gen(function* () {
              if (status === contact.status) return
              // From the page, only an unsubscribe can be undone. A bounce needs a new address, and a
              // spam report shouldn't be reversible by whoever a link was forwarded to.
              if (status === "subscribed" && contact.status !== "unsubscribed") return
              yield* db.query((d) =>
                d
                  .update(schema.contacts)
                  .set({ subscriptionStatus: status, updatedAt: sql`now()` })
                  .where(and(eq(schema.contacts.teamId, teamId), eq(schema.contacts.id, contactId))),
              )
              yield* recordActivity(status === "subscribed" ? "resubscribed" : "unsubscribed", null)
            })
          const setOneTopic = (id: string, subscribed: boolean) =>
            Effect.gen(function* () {
              const [topic] = yield* db.query((d) =>
                d
                  .select({ name: schema.topics.name })
                  .from(schema.topics)
                  .where(and(eq(schema.topics.teamId, teamId), eq(schema.topics.id, id))),
              )
              if (!topic) return
              const changed = yield* setTopic(teamId, contactId, id, subscribed)
              if (changed) yield* recordActivity(subscribed ? "resubscribed" : "unsubscribed", topic.name)
            })

          yield* run(
            db.transaction(
              Effect.gen(function* () {
                switch (change.kind) {
                  case "one-click":
                    // RFC 8058: one request, no questions. The campaign's topic if it had one, else everything.
                    if (topicId) {
                      const [exists] = yield* db.query((d) =>
                        d
                          .select({ id: schema.topics.id })
                          .from(schema.topics)
                          .where(and(eq(schema.topics.teamId, teamId), inArray(schema.topics.id, [topicId]))),
                      )
                      if (exists) return yield* setOneTopic(topicId, false)
                    }
                    return yield* setStatus("unsubscribed")
                  case "all":
                    return yield* setStatus(change.subscribed ? "subscribed" : "unsubscribed")
                  case "topic":
                    return yield* setOneTopic(change.topicId, change.subscribed)
                }
              }),
            ),
          )
          return yield* page(link)
        }).pipe(Effect.withSpan("Subscriptions.apply"))

      return {
        ofContact: (target) => subscriptionsOf(target.team.value, target.contact.value),
        updateTopics,
        page,
        apply,
      }
    }),
  )
}
