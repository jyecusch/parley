import { Schema } from "effect"
import { RecordType } from "./contact.ts"
import { NoteId, UserId } from "./ids.ts"

const Timestamp = Schema.String.annotate({ description: "ISO 8601 timestamp" })

/** Plain text, kept as written, line breaks included. Agents may use Markdown; it's shown as text. */
export const NoteBody = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(10_000))

/** A note on a contact or company, shown in its activity (D74). */
export const Note = Schema.Struct({
  id: NoteId,
  recordType: RecordType,
  recordId: Schema.String,
  body: Schema.String,
  /** Null when the author has since been removed; the name is kept as it was. */
  authorUserId: Schema.NullOr(UserId),
  authorName: Schema.String,
  /** The API key's or connection's name when an agent wrote it. */
  via: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Note = typeof Note.Type
