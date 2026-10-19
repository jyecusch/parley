import { type DomainError, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { ConnectionId } from "../ids.ts"

/** No connection with that id was made by you in this team. Also for other people's: no oracle. */
export class ConnectionNotFound
  extends Schema.TaggedError<ConnectionNotFound>()("ConnectionNotFound", { connectionId: ConnectionId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `connection ${this.connectionId} not found among the principal's connections in this team`
  }
  get userMessage() {
    return userText`We can't find that connection among yours in this team. It may have been revoked already.`
  }
}

/** The sign-in request from the agent is malformed, expired, or names an agent Parley doesn't know. */
export class ConnectionRequestInvalid
  extends Schema.TaggedError<ConnectionRequestInvalid>()("ConnectionRequestInvalid", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "OAuth authorization request is missing, malformed, or names an unknown client"
  }
  get userMessage() {
    return userText`This connection request has expired or isn't valid. Start connecting again from your agent.`
  }
}
