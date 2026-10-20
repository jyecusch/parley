import { Schema } from "effect"
import { CompanyNotFound } from "../errors/companies.ts"
import { ContactNotFound } from "../errors/contacts.ts"
import { CannotDeleteOthersNote, NoteNotFound, NotNoteAuthor } from "../errors/notes.ts"
import { NoteId, TeamId } from "../ids.ts"
import { Note, NoteBody } from "../note.ts"
import { defineTeamOperation } from "../operation.ts"
import { RecordType } from "../record-type.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OnRecord = {
  ...InTeam,
  recordType: RecordType.annotate({ description: "contact or company." }),
  recordId: Schema.String.annotate({ description: "The contact's or company's id." }),
}
const OneNote = { ...InTeam, noteId: NoteId.annotate({ description: "The note's id, from notes.list." }) }

export const listNotes = defineTeamOperation({
  name: "notes.list",
  description: "List the notes on a contact or company, oldest first.",
  input: Schema.Struct(OnRecord),
  output: Schema.Array(Note),
  errors: [ContactNotFound, CompanyNotFound],
  http: { method: "GET", path: "/teams/:teamId/notes" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createNote = defineTeamOperation({
  name: "notes.create",
  description:
    "Add a note to a contact or company, such as a summary of a call. It appears in the record's activity, credited to you (and your agent).",
  input: Schema.Struct({ ...OnRecord, body: NoteBody.annotate({ title: "Note" }) }),
  output: Note,
  errors: [ContactNotFound, CompanyNotFound],
  http: { method: "POST", path: "/teams/:teamId/notes" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "records:write"],
})

export const updateNote = defineTeamOperation({
  name: "notes.update",
  description: "Change a note's text. Only its author can.",
  input: Schema.Struct({ ...OneNote, body: NoteBody.annotate({ title: "Note" }) }),
  output: Note,
  errors: [NoteNotFound, NotNoteAuthor],
  http: { method: "PATCH", path: "/teams/:teamId/notes/:noteId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "records:write"],
})

export const deleteNote = defineTeamOperation({
  name: "notes.delete",
  description: "Delete a note for good. Its author can, and so can a team admin or owner.",
  input: Schema.Struct(OneNote),
  output: Note,
  errors: [NoteNotFound, CannotDeleteOthersNote],
  http: { method: "DELETE", path: "/teams/:teamId/notes/:noteId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "records:write"],
})
