import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, Role, ServiceAccount, TeamId, UserId } from "@parley/domain"
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Context, Effect, Layer } from "effect"
import type { MemberOf } from "../proofs/member-of.ts"
import type { CanManageServiceAccounts } from "../proofs/permissions.ts"
import type { ServiceAccountInTeam } from "../proofs/service-account-in-team.ts"
import type { MemberTransaction } from "./member-changes.ts"
import { classifySqlError } from "./sql-errors.ts"

const isRole = (role: string): role is Role => role === "owner" || role === "admin" || role === "member"

const creator = alias(schema.user, "creator")

/**
 * Service accounts: users of kind "service-account" that can never sign in, each a member
 * of one team (D18). Agents and API keys act as them (D94).
 */
export class ServiceAccounts extends Context.Service<
  ServiceAccounts,
  {
    readonly list: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<ServiceAccount>, DatabaseUnavailable>
    /** Used only by the ServiceAccountInTeam prover. */
    readonly locate: <P, T>(
      member: MemberOf<P, T>,
      serviceAccountId: UserId,
    ) => Effect.Effect<ServiceAccount | undefined, DatabaseUnavailable>
    readonly create: <P, T>(
      transaction: MemberTransaction<T>,
      input: { readonly name: string; readonly role: Exclude<Role, "owner"> },
      access: CanManageServiceAccounts<P, T>,
    ) => Effect.Effect<ServiceAccount, DatabaseUnavailable>
    readonly update: <P, T, S>(
      transaction: MemberTransaction<T>,
      target: ServiceAccountInTeam<P, T, S>,
      changes: { readonly name?: string | undefined; readonly role?: "admin" | "member" | undefined },
      access: CanManageServiceAccounts<P, T>,
    ) => Effect.Effect<ServiceAccount, DatabaseUnavailable>
    /** Deletes the account, its API keys and its connections. Its activity and notes keep its name. */
    readonly delete: <P, T, S>(
      transaction: MemberTransaction<T>,
      target: ServiceAccountInTeam<P, T, S>,
      access: CanManageServiceAccounts<P, T>,
    ) => Effect.Effect<ServiceAccount, DatabaseUnavailable>
  }
>()("@parley/core/ServiceAccounts") {
  static readonly layer = Layer.effect(
    ServiceAccounts,
    Effect.gen(function* () {
      const db = yield* Database

      const select = (teamId: TeamId, serviceAccountId?: UserId) =>
        db
          .query((d) =>
            d
              .select({
                id: schema.user.id,
                name: schema.user.name,
                role: schema.member.role,
                createdAt: schema.member.createdAt,
                creatorId: creator.id,
                creatorName: creator.name,
                connectionCount: sql<number>`(
                  select count(*)::int from ${schema.connections}
                  where ${schema.connections.actsAsUserId} = ${schema.user.id}
                    and ${schema.connections.teamId} = ${schema.member.organizationId}
                    and ${isNotNull(schema.connections.authorizedAt)}
                    and ${isNull(schema.connections.revokedAt)}
                )`,
              })
              .from(schema.member)
              .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
              .leftJoin(schema.serviceAccounts, eq(schema.serviceAccounts.userId, schema.user.id))
              .leftJoin(creator, eq(creator.id, schema.serviceAccounts.createdByUserId))
              .where(
                and(
                  eq(schema.member.organizationId, teamId),
                  eq(schema.user.kind, "service-account"),
                  serviceAccountId ? eq(schema.user.id, serviceAccountId) : undefined,
                ),
              )
              .orderBy(asc(schema.user.name)),
          )
          .pipe(
            Effect.catchTag("SqlError", classifySqlError),
            Effect.map((rows) =>
              rows.flatMap(
                (row): Array<ServiceAccount> =>
                  isRole(row.role)
                    ? [
                        {
                          id: row.id as UserId,
                          name: row.name,
                          role: row.role,
                          createdBy:
                            row.creatorId && row.creatorName
                              ? { userId: row.creatorId as UserId, name: row.creatorName }
                              : null,
                          connectionCount: row.connectionCount,
                          createdAt: row.createdAt.toISOString(),
                        },
                      ]
                    : [],
              ),
            ),
          )

      const list = <P, T>(member: MemberOf<P, T>) =>
        select(member.team.value).pipe(Effect.withSpan("ServiceAccounts.list"))

      const locate = <P, T>(member: MemberOf<P, T>, serviceAccountId: UserId) =>
        select(member.team.value, serviceAccountId).pipe(
          Effect.map(([found]) => found),
          Effect.withSpan("ServiceAccounts.locate"),
        )

      const create = <P, T>(
        transaction: MemberTransaction<T>,
        input: { readonly name: string; readonly role: Exclude<Role, "owner"> },
        access: CanManageServiceAccounts<P, T>,
      ) =>
        Effect.gen(function* () {
          const team = transaction.team
          const creatorId = access.member.principal.value.userId
          const id = crypto.randomUUID()
          const now = new Date()
          yield* db.query((d) =>
            d.insert(schema.user).values({
              id,
              name: input.name,
              // Never deliverable, never used to sign in: service accounts have no password (D18).
              email: `${id}@service-accounts.parley.invalid`,
              emailVerified: false,
              kind: "service-account",
              createdAt: now,
              updatedAt: now,
            }),
          )
          yield* db.query((d) =>
            d.insert(schema.member).values({
              id: crypto.randomUUID(),
              organizationId: team.value,
              userId: id,
              role: input.role,
              createdAt: now,
            }),
          )
          yield* db.query((d) =>
            d.insert(schema.serviceAccounts).values({ userId: id, teamId: team.value, createdByUserId: creatorId }),
          )
          const [created] = yield* select(team.value, id as UserId)
          if (!created) return yield* Effect.die(`service account ${id} vanished after creation`)
          return created
        }).pipe(Effect.catchTag("SqlError", classifySqlError), Effect.withSpan("ServiceAccounts.create"))

      const update = <P, T, S>(
        transaction: MemberTransaction<T>,
        target: ServiceAccountInTeam<P, T, S>,
        changes: { readonly name?: string | undefined; readonly role?: "admin" | "member" | undefined },
        _access: CanManageServiceAccounts<P, T>,
      ) =>
        Effect.gen(function* () {
          const id = target.serviceAccount.value
          const teamId = transaction.team.value
          if (changes.name !== undefined) {
            const name = changes.name
            yield* db.query((d) => d.update(schema.user).set({ name }).where(eq(schema.user.id, id)))
          }
          if (changes.role !== undefined) {
            const role = changes.role
            yield* db.query((d) =>
              d
                .update(schema.member)
                .set({ role })
                .where(and(eq(schema.member.organizationId, teamId), eq(schema.member.userId, id))),
            )
          }
          const [updated] = yield* select(teamId, id)
          if (!updated) return yield* Effect.die(`service account ${id} vanished`)
          return updated
        }).pipe(Effect.catchTag("SqlError", classifySqlError), Effect.withSpan("ServiceAccounts.update"))

      const remove = <P, T, S>(
        _transaction: MemberTransaction<T>,
        target: ServiceAccountInTeam<P, T, S>,
        _access: CanManageServiceAccounts<P, T>,
      ) =>
        Effect.gen(function* () {
          const id = target.serviceAccount.value
          // API keys name their owner without a foreign key, so they go first; the rest cascades.
          yield* db.query((d) => d.delete(schema.apikey).where(eq(schema.apikey.referenceId, id)))
          yield* db.query((d) => d.delete(schema.user).where(eq(schema.user.id, id)))
          return target.found
        }).pipe(Effect.catchTag("SqlError", classifySqlError), Effect.withSpan("ServiceAccounts.delete"))

      return { list, locate, create, update, delete: remove }
    }),
  )
}
