import { Database, schema } from "@parley/db"
import { type DatabaseUnavailable, LastOwner, type Member, type Role, type TeamId, type UserId } from "@parley/domain"
import { and, asc, eq, ne, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { MemberInTeam } from "../proofs/member-in-team.ts"
import type { CanManageMembers, MemberOf } from "../proofs/permissions.ts"
import { classifySqlError } from "./sql-errors.ts"

export type MemberLookup =
  | { readonly _tag: "Member"; readonly teamName: string; readonly role: Role }
  | { readonly _tag: "NotMember"; readonly teamExists: boolean }

export const isRole = (role: string): role is Role => role === "owner" || role === "admin" || role === "member"

const ROLE_ORDER: Readonly<Record<Role, number>> = { owner: 0, admin: 1, member: 2 }

/**
 * Reads and changes team members. `lookup` is used only by the MemberOf prover, which turns it into a
 * proof; changes need proofs of their own.
 */
export class Members extends Context.Service<
  Members,
  {
    readonly lookup: (teamId: TeamId, userId: UserId) => Effect.Effect<MemberLookup, DatabaseUnavailable>
    readonly teamsOf: (
      userId: UserId,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly id: TeamId; readonly name: string; readonly role: Role; readonly gravatar: boolean }>,
      DatabaseUnavailable
    >
    /** The people in a team (not service accounts), owners first. */
    readonly people: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<Member>, DatabaseUnavailable>
    /** Used only by the MemberInTeam prover. */
    readonly person: (teamId: TeamId, userId: UserId) => Effect.Effect<Member | undefined, DatabaseUnavailable>
    readonly changeRole: <P, T, U>(
      target: MemberInTeam<T, U>,
      role: Role,
      access: CanManageMembers<P, T>,
    ) => Effect.Effect<Member, LastOwner | DatabaseUnavailable>
    /** Removes a member; the proof is either members:manage or the member leaving themselves. */
    readonly remove: <T, U>(target: MemberInTeam<T, U>) => Effect.Effect<Member, LastOwner | DatabaseUnavailable>
  }
>()("@parley/core/Members") {
  static readonly layer = Layer.effect(
    Members,
    Effect.gen(function* () {
      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const lookup = Effect.fn("Members.lookup")(function* (teamId: TeamId, userId: UserId) {
        const rows = yield* run(
          db.query((d) =>
            d
              .select({ teamName: schema.organization.name, role: schema.member.role, userId: schema.member.userId })
              .from(schema.organization)
              .leftJoin(
                schema.member,
                and(eq(schema.member.organizationId, schema.organization.id), eq(schema.member.userId, userId)),
              )
              .where(eq(schema.organization.id, teamId))
              .limit(1),
          ),
        )
        const [row] = rows
        if (!row) return { _tag: "NotMember", teamExists: false } satisfies MemberLookup
        if (row.userId === null || row.role === null || !isRole(row.role)) {
          return { _tag: "NotMember", teamExists: true } satisfies MemberLookup
        }
        return { _tag: "Member", teamName: row.teamName, role: row.role } satisfies MemberLookup
      })

      const teamsOf = Effect.fn("Members.teamsOf")(function* (userId: UserId) {
        const rows = yield* run(
          db.query((d) =>
            d
              .select({
                id: schema.organization.id,
                name: schema.organization.name,
                role: schema.member.role,
                gravatar: schema.teamSettings.gravatar,
              })
              .from(schema.member)
              .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
              .leftJoin(schema.teamSettings, eq(schema.teamSettings.teamId, schema.organization.id))
              .where(eq(schema.member.userId, userId))
              .orderBy(schema.organization.name),
          ),
        )
        return rows.flatMap((row) =>
          isRole(row.role)
            ? [{ id: row.id as TeamId, name: row.name, role: row.role, gravatar: row.gravatar ?? false }]
            : [],
        )
      })

      const peopleWhere = (teamId: TeamId, userId?: UserId) =>
        run(
          db.query((d) =>
            d
              .select({
                userId: schema.user.id,
                name: schema.user.name,
                email: schema.user.email,
                role: schema.member.role,
                joinedAt: schema.member.createdAt,
              })
              .from(schema.member)
              .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
              .where(
                and(
                  eq(schema.member.organizationId, teamId),
                  // Service accounts are members too, but they're listed on their own (D18).
                  ne(sql`coalesce(${schema.user.kind}, 'user')`, "service-account"),
                  userId ? eq(schema.member.userId, userId) : undefined,
                ),
              )
              .orderBy(asc(schema.user.name)),
          ),
        ).pipe(
          Effect.map((rows) =>
            rows
              .flatMap(
                (row): Array<Member> =>
                  isRole(row.role)
                    ? [
                        {
                          userId: row.userId as UserId,
                          name: row.name,
                          email: row.email,
                          role: row.role,
                          joinedAt: row.joinedAt.toISOString(),
                        },
                      ]
                    : [],
              )
              .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]),
          ),
        )

      const people = <P, T>(member: MemberOf<P, T>) => peopleWhere(member.team.value)
      const person = (teamId: TeamId, userId: UserId) => Effect.map(peopleWhere(teamId, userId), ([found]) => found)

      /**
       * Re-reads the team's owners under a row lock inside the write, so two concurrent changes can't
       * both remove the last owner (D36).
       */
      const ownersLocked = (teamId: TeamId) =>
        db.query((d) =>
          d
            .select({ userId: schema.member.userId })
            .from(schema.member)
            .where(and(eq(schema.member.organizationId, teamId), eq(schema.member.role, "owner")))
            .for("update"),
        )

      const changeRole = <P, T, U>(target: MemberInTeam<T, U>, role: Role, _access: CanManageMembers<P, T>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const userId = target.user.value
          const outcome = yield* run(
            db.transaction(
              Effect.gen(function* () {
                const owners = yield* ownersLocked(teamId)
                const isOwner = owners.some((owner) => owner.userId === userId)
                if (isOwner && role !== "owner" && owners.length === 1) return "last-owner" as const
                yield* db.query((d) =>
                  d
                    .update(schema.member)
                    .set({ role })
                    .where(and(eq(schema.member.organizationId, teamId), eq(schema.member.userId, userId))),
                )
                return "done" as const
              }),
            ),
          )
          if (outcome === "last-owner") return yield* new LastOwner({ team: target.teamName })
          const updated = yield* person(teamId, userId)
          if (!updated) return yield* Effect.die("member vanished after a role change")
          return updated
        }).pipe(Effect.withSpan("Members.changeRole"))

      const remove = <T, U>(target: MemberInTeam<T, U>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const userId = target.user.value
          const outcome = yield* run(
            db.transaction(
              Effect.gen(function* () {
                const owners = yield* ownersLocked(teamId)
                if (owners.length === 1 && owners[0]?.userId === userId) return "last-owner" as const
                yield* db.query((d) =>
                  d
                    .delete(schema.member)
                    .where(and(eq(schema.member.organizationId, teamId), eq(schema.member.userId, userId))),
                )
                return "done" as const
              }),
            ),
          )
          if (outcome === "last-owner") return yield* new LastOwner({ team: target.teamName })
          return target.found
        }).pipe(Effect.withSpan("Members.remove"))

      return { lookup, teamsOf, people, person, changeRole, remove }
    }),
  )
}
