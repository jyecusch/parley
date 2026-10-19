import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, Role, TeamId, UserId } from "@parley/domain"
import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { classifySqlError } from "./sql-errors.ts"

export type MemberLookup =
  | { readonly _tag: "Member"; readonly teamName: string; readonly role: Role }
  | { readonly _tag: "NotMember"; readonly teamExists: boolean }

const isRole = (role: string): role is Role => role === "owner" || role === "admin" || role === "member"

/** Reads team members. Used only by the MemberOf prover, which is what turns a lookup into a proof. */
export class Members extends Context.Service<
  Members,
  {
    readonly lookup: (teamId: TeamId, userId: UserId) => Effect.Effect<MemberLookup, DatabaseUnavailable>
    readonly teamsOf: (
      userId: UserId,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly id: TeamId; readonly name: string; readonly role: Role }>,
      DatabaseUnavailable
    >
  }
>()("@parley/core/Members") {
  static readonly layer = Layer.effect(
    Members,
    Effect.gen(function* () {
      const db = yield* Database

      const lookup = Effect.fn("Members.lookup")(function* (teamId: TeamId, userId: UserId) {
        const rows = yield* db
          .query((d) =>
            d
              .select({ teamName: schema.organization.name, role: schema.member.role, userId: schema.member.userId })
              .from(schema.organization)
              .leftJoin(
                schema.member,
                and(eq(schema.member.organizationId, schema.organization.id), eq(schema.member.userId, userId)),
              )
              .where(eq(schema.organization.id, teamId))
              .limit(1),
          )
          .pipe(Effect.catchTag("SqlError", classifySqlError))
        const [row] = rows
        if (!row) return { _tag: "NotMember", teamExists: false } satisfies MemberLookup
        if (row.userId === null || row.role === null || !isRole(row.role)) {
          return { _tag: "NotMember", teamExists: true } satisfies MemberLookup
        }
        return { _tag: "Member", teamName: row.teamName, role: row.role } satisfies MemberLookup
      })

      const teamsOf = Effect.fn("Members.teamsOf")(function* (userId: UserId) {
        const rows = yield* db
          .query((d) =>
            d
              .select({ id: schema.organization.id, name: schema.organization.name, role: schema.member.role })
              .from(schema.member)
              .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
              .where(eq(schema.member.userId, userId))
              .orderBy(schema.organization.name),
          )
          .pipe(Effect.catchTag("SqlError", classifySqlError))
        return rows.flatMap((row) =>
          isRole(row.role) ? [{ id: row.id as TeamId, name: row.name, role: row.role }] : [],
        )
      })

      return { lookup, teamsOf }
    }),
  )
}
