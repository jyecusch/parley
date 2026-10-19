import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, Team, TeamId, UserId } from "@parley/domain"
import { eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { BetterAuth } from "../auth/authenticator.ts"
import type { CanManageTeam } from "../proofs/permissions.ts"
import { classifySqlError } from "./sql-errors.ts"

const slugOf = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "team"
  }-${crypto.randomUUID().slice(0, 6)}`

/** Creates teams through Better-Auth's server API, where its client-facing route is disabled (D17). */
export class Teams extends Context.Service<
  Teams,
  {
    readonly create: (owner: UserId, name: string) => Effect.Effect<Team>
    readonly update: <P, T>(
      access: CanManageTeam<P, T>,
      changes: { readonly name?: string | undefined; readonly gravatar?: boolean | undefined },
    ) => Effect.Effect<Team, DatabaseUnavailable>
  }
>()("@parley/core/Teams") {
  static readonly layer = Layer.effect(
    Teams,
    Effect.gen(function* () {
      const auth = yield* BetterAuth
      const db = yield* Database

      const create = Effect.fn("Teams.create")(function* (owner: UserId, name: string) {
        const team = yield* Effect.tryPromise(() =>
          auth.api.createOrganization({ body: { name, slug: slugOf(name), userId: owner } }),
        ).pipe(Effect.orDie)
        if (!team) return yield* Effect.die("Better-Auth returned no team")
        return { id: team.id as TeamId, name, role: "owner", gravatar: false } satisfies Team
      })

      const update = <P, T>(
        access: CanManageTeam<P, T>,
        changes: { readonly name?: string | undefined; readonly gravatar?: boolean | undefined },
      ) =>
        Effect.gen(function* () {
          const teamId = access.member.team.value
          yield* db
            .transaction(
              Effect.gen(function* () {
                if (changes.name !== undefined) {
                  const name = changes.name
                  yield* db.query((d) =>
                    d.update(schema.organization).set({ name }).where(eq(schema.organization.id, teamId)),
                  )
                }
                if (changes.gravatar !== undefined) {
                  const gravatar = changes.gravatar
                  yield* db.query((d) =>
                    d
                      .insert(schema.teamSettings)
                      .values({ teamId, gravatar })
                      .onConflictDoUpdate({
                        target: schema.teamSettings.teamId,
                        set: { gravatar: sql`excluded.gravatar` },
                      }),
                  )
                }
              }),
            )
            .pipe(Effect.catchTag("SqlError", classifySqlError))
          const [row] = yield* db
            .query((d) =>
              d
                .select({ name: schema.organization.name, gravatar: schema.teamSettings.gravatar })
                .from(schema.organization)
                .leftJoin(schema.teamSettings, eq(schema.teamSettings.teamId, schema.organization.id))
                .where(eq(schema.organization.id, teamId)),
            )
            .pipe(Effect.catchTag("SqlError", classifySqlError))
          return {
            id: teamId,
            name: row?.name ?? "",
            role: access.member.role,
            gravatar: row?.gravatar ?? false,
          } satisfies Team
        }).pipe(Effect.withSpan("Teams.update"))

      return { create, update }
    }),
  )
}
