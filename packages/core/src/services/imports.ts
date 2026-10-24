import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, Import, ImportId, RecordType, TeamId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { and, desc, eq, getTableColumns, inArray } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { Principal } from "../principal.ts"
import type { ImportInTeam } from "../proofs/import-in-team.ts"
import type { CanReadRecords, CanWriteRecords } from "../proofs/permissions.ts"
import type { Named } from "../proofs/proof.ts"
import { classifySqlError } from "./sql-errors.ts"

/** Imports still to finish: the runner works on these, and they can be canceled (D135). */
export const UNFINISHED = ["queued", "running", "fetching-logos"] as const

/** How many imports imports.list returns. */
const LIST_LIMIT = 50

type ImportRow = typeof schema.imports.$inferSelect
const {
  failed: _failed,
  warnings: _warnings,
  options: _options,
  principal: _principal,
  ...summaryColumns
} = getTableColumns(schema.imports)
type SummaryRow = Omit<ImportRow, "failed" | "warnings" | "options" | "principal">

/** An import as the API shows it. Its failed and warning rows only when `rows` is given. */
const toImport = (row: SummaryRow, rows?: Pick<ImportRow, "failed" | "warnings">): Import => ({
  id: row.id as ImportId,
  recordType: row.recordType,
  status: row.status,
  fileName: row.fileName,
  totalRows: row.totalRows,
  processedRows: row.processedRows,
  created: row.created,
  updated: row.updated,
  failedCount: row.failedCount,
  warningCount: row.warningCount,
  logos: row.logosTotal === null ? null : { total: row.logosTotal, done: row.logosDone },
  failed: (rows?.failed ?? []) as Import["failed"],
  warnings: (rows?.warnings ?? []) as Import["warnings"],
  startedByName: row.startedByName,
  error: row.error as UserText | null,
  createdAt: row.createdAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
})

/** A principal as stored with an import: its scopes, a set, as a list. */
export const storePrincipal = (principal: Principal): unknown =>
  "scopes" in principal ? { ...principal, scopes: [...principal.scopes] } : principal

export const revivePrincipal = (stored: unknown): Principal => {
  const value = stored as Principal & { readonly scopes?: ReadonlyArray<string> }
  return Array.isArray(value.scopes) ? ({ ...value, scopes: new Set(value.scopes) } as Principal) : value
}

/** What imports.start hands over: the file, already split into parts, and how to read it. */
export interface NewImport {
  readonly recordType: RecordType
  readonly fileName: string | undefined
  /** The mapping (as resolved when it started), set, owners and multiSelect. */
  readonly options: unknown
  readonly totalRows: number
  readonly parts: ReadonlyArray<{ readonly csv: string; readonly firstLine: number }>
}

/** Imports run in the background (D135): starting, finding and canceling them. The runner is ImportRunner. */
export class Imports extends Context.Service<
  Imports,
  {
    readonly start: <P, T>(access: CanWriteRecords<P, T>, file: NewImport) => Effect.Effect<Import, DatabaseUnavailable>
    /** Used only by the ImportInTeam prover. With its failed and warning rows. */
    readonly locate: (teamId: TeamId, id: ImportId) => Effect.Effect<Import | undefined, DatabaseUnavailable>
    readonly list: <P, T>(
      team: Named<T, TeamId>,
      recordType: RecordType | undefined,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<ReadonlyArray<Import>, DatabaseUnavailable>
    /** Stops an unfinished import; rows already imported stay. Anything else is returned as it is. */
    readonly cancel: <P, T, I>(
      target: ImportInTeam<I, T>,
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<Import, DatabaseUnavailable>
  }
>()("@parley/core/Imports") {
  static readonly layer = Layer.effect(
    Imports,
    Effect.gen(function* () {
      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const locate = (teamId: TeamId, id: ImportId) =>
        run(
          db.query((d) =>
            d
              .select()
              .from(schema.imports)
              .where(and(eq(schema.imports.teamId, teamId), eq(schema.imports.id, id))),
          ),
        ).pipe(
          Effect.map(([row]) => (row ? toImport(row, row) : undefined)),
          Effect.withSpan("Imports.locate"),
        )

      const start = <P, T>(access: CanWriteRecords<P, T>, file: NewImport) =>
        Effect.gen(function* () {
          const principal = access.member.principal.value
          const id = crypto.randomUUID() as ImportId
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d.insert(schema.imports).values({
                    id,
                    teamId: access.member.team.value,
                    recordType: file.recordType,
                    fileName: file.fileName ?? null,
                    options: file.options,
                    totalRows: file.totalRows,
                    startedByUserId: principal.userId,
                    startedByName: principal.name,
                    principal: storePrincipal(principal),
                  }),
                )
                // Inserted a few at a time, so one statement never carries the whole file.
                for (let from = 0; from < file.parts.length; from += 20) {
                  const batch = file.parts.slice(from, from + 20)
                  yield* db.query((d) =>
                    d.insert(schema.importParts).values(
                      batch.map((part, offset) => ({
                        id: crypto.randomUUID(),
                        importId: id,
                        position: from + offset,
                        firstLine: part.firstLine,
                        csv: part.csv,
                      })),
                    ),
                  )
                }
              }),
            ),
          )
          const created = yield* locate(access.member.team.value, id)
          return created as Import
        }).pipe(Effect.withSpan("Imports.start"))

      const list = <P, T>(team: Named<T, TeamId>, recordType: RecordType | undefined, _access: CanReadRecords<P, T>) =>
        run(
          db.query((d) =>
            d
              .select(summaryColumns)
              .from(schema.imports)
              .where(
                and(
                  eq(schema.imports.teamId, team.value),
                  recordType ? eq(schema.imports.recordType, recordType) : undefined,
                ),
              )
              .orderBy(desc(schema.imports.createdAt))
              .limit(LIST_LIMIT),
          ),
        ).pipe(
          Effect.map((rows) => rows.map((row) => toImport(row))),
          Effect.withSpan("Imports.list"),
        )

      const cancel = <P, T, I>(target: ImportInTeam<I, T>, _access: CanWriteRecords<P, T>) =>
        Effect.gen(function* () {
          const id = target.import.value
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                const stopped = yield* db.query((d) =>
                  d
                    .update(schema.imports)
                    .set({ status: "canceled", finishedAt: new Date(), claimedAt: null, updatedAt: new Date() })
                    .where(
                      and(
                        eq(schema.imports.teamId, target.team.value),
                        eq(schema.imports.id, id),
                        inArray(schema.imports.status, [...UNFINISHED]),
                      ),
                    )
                    .returning({ id: schema.imports.id }),
                )
                if (stopped.length === 0) return
                yield* db.query((d) => d.delete(schema.importParts).where(eq(schema.importParts.importId, id)))
                yield* db.query((d) => d.delete(schema.importLogos).where(eq(schema.importLogos.importId, id)))
              }),
            ),
          )
          return (yield* locate(target.team.value, id)) ?? target.found
        }).pipe(Effect.withSpan("Imports.cancel"))

      return { start, locate, list, cancel }
    }),
  )
}
