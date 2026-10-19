import { Database, schema } from "@parley/db"
import type {
  DatabaseUnavailable,
  Filter,
  InputRejected,
  RecordType,
  SavedView,
  SavedViewId,
  Sort,
  TeamId,
  UserId,
} from "@parley/domain"
import { and, asc, eq, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { attribution } from "../principal.ts"
import type { MemberOf } from "../proofs/member-of.ts"
import type { CanWriteRecords } from "../proofs/permissions.ts"
import type { SavedViewEditable } from "../proofs/saved-view.ts"
import { CustomFields } from "./custom-fields.ts"
import { checkFilter } from "./filter-sql.ts"
import { classifySqlError } from "./sql-errors.ts"

const EMPTY: Filter = { match: "all", conditions: [] }

const summarize = (row: typeof schema.savedViews.$inferSelect): SavedView => ({
  id: row.id as SavedViewId,
  recordType: row.recordType,
  name: row.name,
  shared: row.shared,
  ownerUserId: row.ownerUserId as UserId | null,
  ownerName: row.ownerName,
  filter: (row.filter as Filter | null) ?? EMPTY,
  sort: (row.sort as Sort | null) ?? null,
  columns: row.columns,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export interface SavedViewInput {
  readonly name?: string | undefined
  readonly shared?: boolean | undefined
  readonly filter?: Filter | undefined
  readonly sort?: Sort | null | undefined
  readonly columns?: ReadonlyArray<string> | undefined
}

/** Saved views (D59, D60): the team's shared ones and each person's own. */
export class SavedViews extends Context.Service<
  SavedViews,
  {
    readonly list: <P, T>(
      member: MemberOf<P, T>,
      recordType: RecordType | undefined,
    ) => Effect.Effect<ReadonlyArray<SavedView>, DatabaseUnavailable>
    /** Used only by the SavedViewEditable prover: a view the member can see. */
    readonly locate: <P, T>(
      member: MemberOf<P, T>,
      viewId: SavedViewId,
    ) => Effect.Effect<SavedView | undefined, DatabaseUnavailable>
    /** A shared view needs records:write, so the caller passes that proof for one. */
    readonly create: <P, T>(
      member: MemberOf<P, T>,
      recordType: RecordType,
      input: SavedViewInput & { readonly name: string },
      shareAccess: CanWriteRecords<P, T> | undefined,
    ) => Effect.Effect<SavedView, InputRejected | DatabaseUnavailable>
    readonly update: <P, T, V>(
      target: SavedViewEditable<P, T, V>,
      input: SavedViewInput,
    ) => Effect.Effect<SavedView, InputRejected | DatabaseUnavailable>
    readonly delete: <P, T, V>(target: SavedViewEditable<P, T, V>) => Effect.Effect<SavedView, DatabaseUnavailable>
  }
>()("@parley/core/SavedViews") {
  static readonly layer = Layer.effect(
    SavedViews,
    Effect.gen(function* () {
      const db = yield* Database
      const customFields = yield* CustomFields
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const visible = <P, T>(member: MemberOf<P, T>) =>
        and(
          eq(schema.savedViews.teamId, member.team.value),
          or(eq(schema.savedViews.shared, true), eq(schema.savedViews.ownerUserId, member.principal.value.userId)),
        )

      const select = (where: ReturnType<typeof and>) =>
        run(
          db.query((d) => d.select().from(schema.savedViews).where(where).orderBy(asc(schema.savedViews.createdAt))),
        ).pipe(Effect.map((rows) => rows.map(summarize)))

      const byId = (id: string) =>
        Effect.flatMap(select(and(eq(schema.savedViews.id, id))), ([view]) =>
          view ? Effect.succeed(view) : Effect.die(`saved view ${id} vanished`),
        )

      /** A view's filter must make sense for its record type, like a list's (D26). */
      const checked = (teamId: TeamId, recordType: RecordType, filter: Filter | undefined) =>
        filter
          ? Effect.flatMap(customFields.ofTeam(teamId, recordType), (fields) =>
              Effect.as(checkFilter(recordType, filter, fields), filter),
            )
          : Effect.succeed(undefined)

      const list = <P, T>(member: MemberOf<P, T>, recordType: RecordType | undefined) =>
        select(and(visible(member), recordType ? eq(schema.savedViews.recordType, recordType) : undefined))

      const locate = <P, T>(member: MemberOf<P, T>, viewId: SavedViewId) =>
        Effect.map(select(and(visible(member), sql`${schema.savedViews.id}::text = ${viewId}`)), ([view]) => view)

      const create = <P, T>(
        member: MemberOf<P, T>,
        recordType: RecordType,
        input: SavedViewInput & { readonly name: string },
        shareAccess: CanWriteRecords<P, T> | undefined,
      ) =>
        Effect.gen(function* () {
          const filter = (yield* checked(member.team.value, recordType, input.filter)) ?? EMPTY
          const id = crypto.randomUUID()
          const who = attribution(member.principal.value)
          yield* run(
            db.query((d) =>
              d.insert(schema.savedViews).values({
                id,
                teamId: member.team.value,
                recordType,
                name: input.name,
                shared: shareAccess !== undefined && input.shared === true,
                ownerUserId: who.actorUserId,
                ownerName: who.actorName,
                filter,
                sort: input.sort ?? null,
                columns: [...(input.columns ?? [])],
              }),
            ),
          )
          return yield* byId(id)
        }).pipe(Effect.withSpan("SavedViews.create"))

      const update = <P, T, V>(target: SavedViewEditable<P, T, V>, input: SavedViewInput) =>
        Effect.gen(function* () {
          const filter = yield* checked(target.team.value, target.found.recordType, input.filter)
          yield* run(
            db.query((d) =>
              d
                .update(schema.savedViews)
                .set({
                  ...(input.name !== undefined ? { name: input.name } : {}),
                  ...(input.shared !== undefined && target.canShare ? { shared: input.shared } : {}),
                  ...(filter !== undefined ? { filter } : {}),
                  ...(input.sort !== undefined ? { sort: input.sort } : {}),
                  ...(input.columns !== undefined ? { columns: [...input.columns] } : {}),
                  updatedAt: sql`now()`,
                })
                .where(eq(schema.savedViews.id, target.view.value)),
            ),
          )
          return yield* byId(target.view.value)
        }).pipe(Effect.withSpan("SavedViews.update"))

      const remove = <P, T, V>(target: SavedViewEditable<P, T, V>) =>
        Effect.gen(function* () {
          yield* run(db.query((d) => d.delete(schema.savedViews).where(eq(schema.savedViews.id, target.view.value))))
          return target.found
        }).pipe(Effect.withSpan("SavedViews.delete"))

      return { list, locate, create, update, delete: remove }
    }),
  )
}
