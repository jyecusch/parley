import { type DomainError, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { UserId } from "../ids.ts"

/** No service account with that id is a member of this team. */
export class ServiceAccountNotFound
  extends Schema.TaggedError<ServiceAccountNotFound>()("ServiceAccountNotFound", { serviceAccountId: UserId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `service account ${this.serviceAccountId} not found in this team`
  }
  get userMessage() {
    return userText`We can't find that service account in this team. It may have been removed.`
  }
}

/** A service account can be a member or an admin, never an owner: owners are people (D18). */
export class ServiceAccountCannotBeOwner
  extends Schema.TaggedError<ServiceAccountCannotBeOwner>()("ServiceAccountCannotBeOwner", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "service account cannot be an owner"
  }
  get userMessage() {
    return userText`A service account can be a member or an admin, but not an owner. Owners are always people.`
  }
}
