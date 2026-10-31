import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, TeamId } from "@parley/domain"
import { eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { SqlError } from "effect/sql"
import { type Named, named } from "../proofs/proof.ts"
import { classifySqlError } from "./sql-errors.ts"

/** MemberTransaction identifies a team locked until its callback's Effect finishes. */
class MemberTransaction<in out T> {
  readonly #team: Named<T, TeamId>

  constructor(team: Named<T, TeamId>) {
    this.#team = team
    Object.freeze(this)
  }

  get team(): Named<T, TeamId> {
    void this.#team.value
    return this.#team
  }
}

export type { MemberTransaction }

/** MemberChanges locks a team before executing a callback that builds fresh authorization proofs. */
export class MemberChanges extends Context.Service<
  MemberChanges,
  {
    readonly inTeam: <Result, Error, Requirements>(
      teamId: TeamId,
      use: <T>(transaction: MemberTransaction<T>) => Effect.Effect<Result, Error, Requirements>,
    ) => Effect.Effect<Result, Error | DatabaseUnavailable, Requirements>
  }
>()("@parley/core/MemberChanges") {
  static readonly layer = Layer.effect(
    MemberChanges,
    Effect.gen(function* () {
      const db = yield* Database
      const inTeam = <Result, Error, Requirements>(
        teamId: TeamId,
        use: <T>(transaction: MemberTransaction<T>) => Effect.Effect<Result, Error, Requirements>,
      ) =>
        db
          .transaction(
            Effect.gen(function* () {
              // Proof queries must see changes committed while the team lock was waiting.
              yield* db.query((d) => d.execute(sql`set transaction isolation level read committed`))
              yield* db.query((d) =>
                d
                  .select({ id: schema.organization.id })
                  .from(schema.organization)
                  .where(eq(schema.organization.id, teamId))
                  .for("update"),
              )
              return yield* named(teamId, (team) => use(new MemberTransaction(team)))
            }),
          )
          .pipe(Effect.catchIf(SqlError.isSqlError, classifySqlError), Effect.withSpan("MemberChanges.inTeam"))
      return { inTeam }
    }),
  )
}
