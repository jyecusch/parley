import { DisplayName, type DomainError, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { NoteId } from "../ids.ts"

/** No note with that id on a live record in this team. */
export class NoteNotFound
  extends Schema.TaggedError<NoteNotFound>()("NoteNotFound", { team: DisplayName.schema, noteId: NoteId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `note ${this.noteId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that note in ${this.team}. It may have been deleted.`
  }
}

/** Only a note's author can edit it (D86). */
export class NotNoteAuthor
  extends Schema.TaggedError<NotNoteAuthor>()("NotNoteAuthor", { author: DisplayName.schema })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "principal is not the note's author"
  }
  get userMessage() {
    return userText`Only ${this.author}, who wrote this note, can edit it. Add a note of your own instead.`
  }
}

/** Deleting someone else's note needs an admin or owner (D86). */
export class CannotDeleteOthersNote
  extends Schema.TaggedError<CannotDeleteOthersNote>()("CannotDeleteOthersNote", { author: DisplayName.schema })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "principal may not delete a note by someone else"
  }
  get userMessage() {
    return userText`Only ${this.author}, who wrote this note, or a team admin can delete it.`
  }
}
