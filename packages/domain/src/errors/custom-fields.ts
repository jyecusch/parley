import { DisplayName, type DomainError, EchoedInput, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { CustomFieldId } from "../ids.ts"
import { RecordType } from "../record-type.ts"

/** Another field on this record type already has this name, or it's a built-in field's name (D68). */
export class CustomFieldNameTaken
  extends Schema.TaggedError<CustomFieldNameTaken>()("CustomFieldNameTaken", {
    name: EchoedInput.schema,
    recordType: RecordType,
    builtIn: Schema.Boolean,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `custom field name taken on ${this.recordType}`
  }
  get userMessage() {
    const records = this.recordType === "contact" ? userText`contacts` : userText`companies`
    return this.builtIn
      ? userText`${this.name} is already a built-in field on ${records}. Choose a different name.`
      : userText`There's already a field called ${this.name} on ${records}. Choose a different name, or edit that field.`
  }
}

/** No custom field with that id in this team. */
export class CustomFieldNotFound
  extends Schema.TaggedError<CustomFieldNotFound>()("CustomFieldNotFound", {
    team: DisplayName.schema,
    fieldId: CustomFieldId,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `custom field ${this.fieldId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that field in ${this.team}. It may have been deleted. List fields to see the current ones.`
  }
}
