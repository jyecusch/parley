import { DisplayName, type DomainError, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { FormId, SubmissionId } from "../ids.ts"

/** No form with that id in this team. */
export class FormNotFound
  extends Schema.TaggedError<FormNotFound>()("FormNotFound", { team: DisplayName.schema, formId: FormId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `form ${this.formId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that form in ${this.team}. It may have been deleted.`
  }
}

/** No submission with that id on this form. */
export class SubmissionNotFound
  extends Schema.TaggedError<SubmissionNotFound>()("SubmissionNotFound", {
    team: DisplayName.schema,
    submissionId: SubmissionId,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `submission ${this.submissionId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that submission in ${this.team}. Spam is kept for 30 days.`
  }
}
