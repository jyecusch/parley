import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, Note, NoteId, RecordType, TeamId, UserId } from "@parley/domain"
import { and, asc, eq, type SQL, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { attribution } from "../principal.ts"
import type { NoteDeletable, NoteEditable } from "../proofs/note.ts"
import type { CanReadRecords, CanWriteRecords } from "../proofs/permissions.ts"
import type { Named } from "../proofs/proof.ts"
import type { RecordInTeam } from "../proofs/record-in-team.ts"
import { classifySqlError } from "./sql-errors.ts"

/** Notes on deleted records are hidden with them (D30). */
const onLiveRecord: SQL = sql`(
  (${schema.notes.recordType} = 'contact' and exists (
    select 1 from ${schema.contacts} c where c.id = ${schema.notes.recordId} and c.deleted_at is null))
  or (${schema.notes.recordType} = 'company' and exists (
    select 1 from ${schema.companies} co where co.id = ${schema.notes.recordId} and co.deleted_at is null))
)`

const summarize = (row: typeof schema.notes.$inferSelect): Note => ({
  id: row.id as NoteId,
  recordType: row.recordType as RecordType,
  recordId: row.recordId,
  body: row.body,
  authorUserId: row.authorUserId as UserId | null,
  authorName: row.authorName,
  via: row.viaName,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

/** Notes on contacts and companies (D74, D86). */
export class Notes extends Context.Service<
  Notes,
  {
    readonly list: <T>(target: RecordInTeam<T>) => Effect.Effect<ReadonlyArray<Note>, DatabaseUnavailable>
    /** Used only by the note provers. */
    readonly locate: <P, T>(
      team: Named<T, TeamId>,
      noteId: NoteId,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<Note | undefined, DatabaseUnavailable>
    readonly create: <P, T>(
      target: RecordInTeam<T>,
      body: string,
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<Note, DatabaseUnavailable>
    readonly update: <P, T, N>(target: NoteEditable<P, T, N>, body: string) => Effect.Effect<Note, DatabaseUnavailable>
    readonly delete: <P, T, N>(target: NoteDeletable<P, T, N>) => Effect.Effect<Note, DatabaseUnavailable>
  }
>()("@parley/core/Notes") {
  static readonly layer = Layer.effect(
    Notes,
    Effect.gen(function* () {
      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const select = (where: SQL | undefined) =>
        run(
          db.query((d) =>
            d
              .select()
              .from(schema.notes)
              .where(and(where, onLiveRecord))
              .orderBy(asc(schema.notes.createdAt), asc(schema.notes.id)),
          ),
        ).pipe(Effect.map((rows) => rows.map(summarize)))

      const byId = (teamId: TeamId, id: string) =>
        Effect.flatMap(select(and(eq(schema.notes.teamId, teamId), eq(schema.notes.id, id))), ([note]) =>
          note ? Effect.succeed(note) : Effect.die(`note ${id} vanished`),
        )

      const list = <T>(target: RecordInTeam<T>) =>
        select(and(eq(schema.notes.teamId, target.team.value), eq(schema.notes.recordId, target.recordId)))

      const locate = <P, T>(team: Named<T, TeamId>, noteId: NoteId, _access: CanReadRecords<P, T>) =>
        Effect.map(
          select(and(eq(schema.notes.teamId, team.value), sql`${schema.notes.id}::text = ${noteId}`)),
          ([note]) => note,
        )

      const create = <P, T>(target: RecordInTeam<T>, body: string, access: CanWriteRecords<P, T>) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const who = attribution(access.member.principal.value)
          yield* run(
            db.query((d) =>
              d.insert(schema.notes).values({
                id,
                teamId: target.team.value,
                recordType: target.recordType,
                recordId: target.recordId,
                body,
                authorUserId: who.actorUserId,
                authorName: who.actorName,
                viaApiKeyId: who.viaApiKeyId,
                viaConnectionId: who.viaConnectionId,
                viaName: who.viaName,
              }),
            ),
          )
          return yield* byId(target.team.value, id)
        }).pipe(Effect.withSpan("Notes.create"))

      const update = <P, T, N>(target: NoteEditable<P, T, N>, body: string) =>
        Effect.gen(function* () {
          yield* run(
            db.query((d) =>
              d.update(schema.notes).set({ body, updatedAt: sql`now()` }).where(eq(schema.notes.id, target.note.value)),
            ),
          )
          return yield* byId(target.team.value, target.note.value)
        }).pipe(Effect.withSpan("Notes.update"))

      const remove = <P, T, N>(target: NoteDeletable<P, T, N>) =>
        Effect.gen(function* () {
          yield* run(db.query((d) => d.delete(schema.notes).where(eq(schema.notes.id, target.note.value))))
          return target.found
        }).pipe(Effect.withSpan("Notes.delete"))

      return { list, locate, create, update, delete: remove }
    }),
  )
}
