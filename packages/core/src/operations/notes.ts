import type { createNote, deleteNote, listNotes, OperationInput, updateNote } from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveNoteDeletable, proveNoteEditable } from "../proofs/note.ts"
import { proveCanReadRecords, proveCanWriteRecords } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { proveRecordInTeam } from "../proofs/record-in-team.ts"
import { Notes } from "../services/notes.ts"

export const list = (principal: Principal, input: OperationInput<typeof listNotes>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const notes = yield* Notes
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const record = yield* proveRecordInTeam(team, input.recordType, input.recordId, canRead)
      return yield* notes.list(record)
    }),
  )

export const create = (principal: Principal, input: OperationInput<typeof createNote>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const notes = yield* Notes
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const record = yield* proveRecordInTeam(team, input.recordType, input.recordId, canRead)
      return yield* notes.create(record, input.body, canWrite)
    }),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateNote>) =>
  named(principal, input.teamId, input.noteId, (principal, team, note) =>
    Effect.gen(function* () {
      const notes = yield* Notes
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const target = yield* proveNoteEditable(team, note, canRead, canWrite)
      return yield* notes.update(target, input.body)
    }),
  )

export const remove = (principal: Principal, input: OperationInput<typeof deleteNote>) =>
  named(principal, input.teamId, input.noteId, (principal, team, note) =>
    Effect.gen(function* () {
      const notes = yield* Notes
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const target = yield* proveNoteDeletable(team, note, canRead, canWrite)
      return yield* notes.delete(target)
    }),
  )
