import { type DomainError, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"

/** A web request arrived without a session cookie. */
export class SessionMissing extends Schema.TaggedError<SessionMissing>()("SessionMissing", {}) implements DomainError {
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "no session cookie and no API key on the request"
  }
  get userMessage() {
    return userText`You're not signed in. Sign in to continue.`
  }
}

/** The session cookie is present but the session has ended. */
export class SessionExpired extends Schema.TaggedError<SessionExpired>()("SessionExpired", {}) implements DomainError {
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "session cookie refers to an expired or unknown session"
  }
  get userMessage() {
    return userText`You were signed out, so this wasn't saved. Your changes are still here. Sign in again to save them.`
  }
}

/** The API key matches nothing. Never says whether it was malformed or unknown. */
export class ApiKeyUnrecognized
  extends Schema.TaggedError<ApiKeyUnrecognized>()("ApiKeyUnrecognized", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "API key did not verify"
  }
  get userMessage() {
    return userText`Parley doesn't recognize this API key. Check that it was copied in full, or create a new one in Settings → API keys.`
  }
}

/** The API key passed its expiry date. */
export class ApiKeyExpired extends Schema.TaggedError<ApiKeyExpired>()("ApiKeyExpired", {}) implements DomainError {
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "API key expired"
  }
  get userMessage() {
    return userText`This API key has expired. Whoever created it can create a new one in Settings → API keys.`
  }
}

/** Someone revoked the API key. */
export class ApiKeyRevoked extends Schema.TaggedError<ApiKeyRevoked>()("ApiKeyRevoked", {}) implements DomainError {
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "API key revoked"
  }
  get userMessage() {
    return userText`This API key was revoked, so Parley can't accept requests from it. Whoever created it can create a new one in Settings → API keys.`
  }
}

/** An agent's OAuth access token didn't verify, or names no connection. Never says which. */
export class AccessTokenUnrecognized
  extends Schema.TaggedError<AccessTokenUnrecognized>()("AccessTokenUnrecognized", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "access token did not verify"
  }
  get userMessage() {
    return userText`Parley doesn't recognize this agent's sign-in. Connect the agent to Parley again.`
  }
}

/** The access token passed its expiry. The agent should refresh it; most do so on their own. */
export class AccessTokenExpired
  extends Schema.TaggedError<AccessTokenExpired>()("AccessTokenExpired", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "access token expired"
  }
  get userMessage() {
    return userText`This agent's sign-in to Parley has expired. Reconnect the agent if it doesn't sign in again by itself.`
  }
}

/** Someone revoked the connection the access token belongs to. */
export class ConnectionRevoked
  extends Schema.TaggedError<ConnectionRevoked>()("ConnectionRevoked", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "connection revoked"
  }
  get userMessage() {
    return userText`This agent's connection to Parley was revoked. Connect the agent again to keep using it.`
  }
}

export const AuthenticationErrors = [
  SessionMissing,
  SessionExpired,
  ApiKeyUnrecognized,
  ApiKeyExpired,
  ApiKeyRevoked,
  AccessTokenUnrecognized,
  AccessTokenExpired,
  ConnectionRevoked,
] as const
export const AuthenticationError = Schema.Union(AuthenticationErrors)
export type AuthenticationError = typeof AuthenticationError.Type
