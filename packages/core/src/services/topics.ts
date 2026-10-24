import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, TeamId, Topic, TopicId } from "@parley/domain"
import { and, asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { CanManageEmail, MemberOf } from "../proofs/permissions.ts"
import type { TopicInTeam } from "../proofs/topic-in-team.ts"
import { classifySqlError } from "./sql-errors.ts"

export interface TopicInput {
  readonly name?: string | undefined
  readonly description?: string | null | undefined
  readonly mode?: "opt-out" | "opt-in" | undefined
}

/** Topics (R38): kinds of marketing email a contact can unsubscribe from on its own. */
export class Topics extends Context.Service<
  Topics,
  {
    /** A team's topics. Anyone in the team may see them; the caller proves membership. */
    readonly list: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<Topic>, DatabaseUnavailable>
    /** Used only by the TopicInTeam prover. */
    readonly locate: (teamId: TeamId, topicId: TopicId) => Effect.Effect<Topic | undefined, DatabaseUnavailable>
    readonly create: <P, T>(
      access: CanManageEmail<P, T>,
      input: TopicInput & { readonly name: string },
    ) => Effect.Effect<Topic, DatabaseUnavailable>
    readonly update: <P, T, K>(
      target: TopicInTeam<K, T>,
      input: TopicInput,
      access: CanManageEmail<P, T>,
    ) => Effect.Effect<Topic, DatabaseUnavailable>
    readonly delete: <P, T, K>(
      target: TopicInTeam<K, T>,
      access: CanManageEmail<P, T>,
    ) => Effect.Effect<Topic, DatabaseUnavailable>
  }
>()("@parley/core/Topics") {
  static readonly layer = Layer.effect(
    Topics,
    Effect.gen(function* () {
      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const select = (teamId: TeamId, topicId?: string) =>
        run(
          db.query((d) =>
            d
              .select({
                row: schema.topics,
                unsubscribed: sql<number>`(select count(*)::int from "topic_unsubscribes" u
                  join "contacts" c on c.id = u.contact_id
                  where u.topic_id = "topics"."id" and c.deleted_at is null)`,
                members: sql<number>`(select count(*)::int from "topic_members" m
                  join "contacts" c on c.id = m.contact_id
                  where m.topic_id = "topics"."id" and c.deleted_at is null)`,
              })
              .from(schema.topics)
              .where(and(eq(schema.topics.teamId, teamId), topicId ? eq(schema.topics.id, topicId) : undefined))
              .orderBy(asc(schema.topics.name)),
          ),
        ).pipe(
          Effect.map((rows) =>
            rows.map(
              ({ row, unsubscribed, members }): Topic => ({
                id: row.id as TopicId,
                name: row.name,
                description: row.description,
                mode: row.mode,
                unsubscribedCount: Number(unsubscribed),
                memberCount: Number(members),
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
              }),
            ),
          ),
        )

      const one = (teamId: TeamId, topicId: string) =>
        Effect.flatMap(select(teamId, topicId), ([topic]) =>
          topic ? Effect.succeed(topic) : Effect.die(new Error("topic vanished")),
        )

      return {
        list: (member) => select(member.team.value),
        locate: (teamId, topicId) => Effect.map(select(teamId, topicId), (rows) => rows[0]),
        create: (access, input) =>
          Effect.gen(function* () {
            const id = crypto.randomUUID()
            const teamId = access.member.team.value
            yield* run(
              db.query((d) =>
                d.insert(schema.topics).values({
                  id,
                  teamId,
                  name: input.name,
                  description: input.description ?? null,
                  mode: input.mode ?? "opt-out",
                }),
              ),
            )
            return yield* one(teamId, id)
          }).pipe(Effect.withSpan("Topics.create")),
        update: (target, input) =>
          Effect.gen(function* () {
            const teamId = target.team.value
            yield* run(
              db.query((d) =>
                d
                  .update(schema.topics)
                  .set({
                    ...(input.name !== undefined ? { name: input.name } : {}),
                    ...(input.description !== undefined ? { description: input.description } : {}),
                    // A topic's mode can change; members and unsubscribes are both kept, so changing
                    // back restores who gets it (D149).
                    ...(input.mode !== undefined ? { mode: input.mode } : {}),
                    updatedAt: sql`now()`,
                  })
                  .where(and(eq(schema.topics.teamId, teamId), eq(schema.topics.id, target.topic.value))),
              ),
            )
            return yield* one(teamId, target.topic.value)
          }).pipe(Effect.withSpan("Topics.update")),
        delete: (target) =>
          Effect.gen(function* () {
            yield* run(
              db.query((d) =>
                d
                  .delete(schema.topics)
                  .where(and(eq(schema.topics.teamId, target.team.value), eq(schema.topics.id, target.topic.value))),
              ),
            )
            return target.found
          }).pipe(Effect.withSpan("Topics.delete")),
      }
    }),
  )
}
