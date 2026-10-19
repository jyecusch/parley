import { DisplayName, type DomainError, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { SavedViewId } from "../ids.ts"

/** No saved view with that id that you can see: shared ones in this team, and your own. */
export class SavedViewNotFound
  extends Schema.TaggedError<SavedViewNotFound>()("SavedViewNotFound", {
    team: DisplayName.schema,
    viewId: SavedViewId,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `saved view ${this.viewId} not found or not visible`
  }
  get userMessage() {
    return userText`We can't find that saved view in ${this.team}. It may have been deleted, or be someone else's personal view.`
  }
}
