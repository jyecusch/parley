import {
  CannotDeleteOthersNote,
  type DatabaseUnavailable,
  type Note,
  type NoteId,
  NoteNotFound,
  NotNoteAuthor,
  type TeamId,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { Notes } from "../services/notes.ts"
import type { CanReadRecords, CanWriteRecords } from "./permissions.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const NoteEditableProver = defineProof("NoteEditable")
const NoteDeletableProver = defineProof("NoteDeletable")

interface Found<T, N> {
  readonly team: Named<T, TeamId>
  readonly note: Named<N, NoteId>
  readonly found: Note
}

/** P wrote note N, on a live record in team T, and may write records there (D86). */
export interface NoteEditable<P, T, N> extends Proof<"NoteEditable", [P, T, N]>, Found<T, N> {}

/** P may delete note N: P wrote it, or P is an admin or owner of team T (D86). */
export interface NoteDeletable<P, T, N> extends Proof<"NoteDeletable", [P, T, N]>, Found<T, N> {}

const locate = <P, T, N>(team: Named<T, TeamId>, note: Named<N, NoteId>, read: CanReadRecords<P, T>) =>
  Effect.gen(function* () {
    const notes = yield* Notes
    const found = yield* notes.locate(team, note.value, read)
    if (!found) return yield* new NoteNotFound({ team: read.member.teamName, noteId: note.value })
    return found
  })

export const proveNoteEditable = <P, T, N>(
  team: Named<T, TeamId>,
  note: Named<N, NoteId>,
  read: CanReadRecords<P, T>,
  write: CanWriteRecords<P, T>,
): Effect.Effect<NoteEditable<P, T, N>, NoteNotFound | NotNoteAuthor | DatabaseUnavailable, Notes> =>
  Effect.gen(function* () {
    const found = yield* locate(team, note, read)
    if (found.authorUserId !== write.member.principal.value.userId) {
      return yield* new NotNoteAuthor({ author: DisplayName.fromRecord(found.authorName) })
    }
    return NoteEditableProver.prove([write.member.principal, team, note], { team, note, found })
  })

export const proveNoteDeletable = <P, T, N>(
  team: Named<T, TeamId>,
  note: Named<N, NoteId>,
  read: CanReadRecords<P, T>,
  write: CanWriteRecords<P, T>,
): Effect.Effect<NoteDeletable<P, T, N>, NoteNotFound | CannotDeleteOthersNote | DatabaseUnavailable, Notes> =>
  Effect.gen(function* () {
    const found = yield* locate(team, note, read)
    const member = write.member
    const isAuthor = found.authorUserId === member.principal.value.userId
    // An admin's power counts only if whoever connected an agent acting as one is an admin too (D94).
    const isAdmin =
      member.role !== "member" && (member.connectedBy === undefined || member.connectedBy.role !== "member")
    if (!isAuthor && !isAdmin) {
      return yield* new CannotDeleteOthersNote({ author: DisplayName.fromRecord(found.authorName) })
    }
    return NoteDeletableProver.prove([member.principal, team, note], { team, note, found })
  })
