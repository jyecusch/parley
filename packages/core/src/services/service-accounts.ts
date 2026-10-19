import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, Role, ServiceAccount, TeamId, UserId } from "@parley/domain"
import { and, asc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { MemberOf } from "../proofs/member-of.ts"
import type { CanManageServiceAccounts } from "../proofs/permissions.ts"
import type { Named } from "../proofs/proof.ts"
import { classifySqlError } from "./sql-errors.ts"

const isRole = (role: string): role is Role => role === "owner" || role === "admin" || role === "member"

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
      team: Named<T, TeamId>,
      input: { readonly name: string; readonly role: Role },
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
              })
              .from(schema.member)
              .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
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
                    ? [{ id: row.id as UserId, name: row.name, role: row.role, createdAt: row.createdAt.toISOString() }]
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
        team: Named<T, TeamId>,
        input: { readonly name: string; readonly role: Role },
        _access: CanManageServiceAccounts<P, T>,
      ) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const now = new Date()
          yield* db
            .transaction(
              Effect.gen(function* () {
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
              }),
            )
            .pipe(Effect.catchTag("SqlError", classifySqlError))
          return {
            id: id as UserId,
            name: input.name,
            role: input.role,
            createdAt: now.toISOString(),
          } satisfies ServiceAccount
        }).pipe(Effect.withSpan("ServiceAccounts.create"))

      return { list, locate, create }
    }),
  )
}
