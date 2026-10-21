import { DisplayName, type DomainError, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { ImportId } from "../ids.ts"

/** No import with that id in this team. */
export class ImportNotFound
  extends Schema.TaggedError<ImportNotFound>()("ImportNotFound", { team: DisplayName.schema, importId: ImportId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `import ${this.importId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that import in ${this.team}.`
  }
}
