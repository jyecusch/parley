import type { ApiKeyId, ConnectionId, Permission, TeamId, UserId } from "@parley/domain"
import type { DisplayName } from "@parley/errors"

/** A user signed in to the web app. */
export interface UserSession {
  readonly _tag: "UserSession"
  readonly userId: UserId
  readonly name: DisplayName
  /** The sign-in session. A connection being consented to is tied to it. */
  readonly sessionId: string
}

/** An API key a user created: acts as that user, within its scopes, in one team (D19). */
export interface UserApiKey {
  readonly _tag: "UserApiKey"
  readonly userId: UserId
  readonly name: DisplayName
  readonly apiKeyId: ApiKeyId
  readonly apiKeyName: string
  /** Undefined when the API key was created without a team, which makes it valid for none. */
  readonly teamId: TeamId | undefined
  readonly scopes: ReadonlySet<Permission>
}

/** An API key belonging to a service account, a member of one team in its own right (D18). */
export interface ServiceAccountApiKey {
  readonly _tag: "ServiceAccountApiKey"
  readonly userId: UserId
  readonly name: DisplayName
  readonly apiKeyId: ApiKeyId
  readonly apiKeyName: string
  readonly scopes: ReadonlySet<Permission>
}

/** An agent connected over OAuth, acting as the person who connected it, in one team (D92). */
export interface UserConnection {
  readonly _tag: "UserConnection"
  readonly userId: UserId
  readonly name: DisplayName
  readonly connectionId: ConnectionId
  readonly connectionName: string
  readonly teamId: TeamId
  readonly scopes: ReadonlySet<Permission>
}

/**
 * An agent connected over OAuth, acting as a service account. Limited to the lower of the service
 * account's role and the role of the person who connected it, within its scopes (D94).
 */
export interface ServiceAccountConnection {
  readonly _tag: "ServiceAccountConnection"
  /** The service account. */
  readonly userId: UserId
  readonly name: DisplayName
  readonly connectedByUserId: UserId
  readonly connectionId: ConnectionId
  readonly connectionName: string
  readonly teamId: TeamId
  readonly scopes: ReadonlySet<Permission>
}

/** Who is making the request. The output of authentication, before any team is known. */
export type Principal = UserSession | UserApiKey | ServiceAccountApiKey | UserConnection | ServiceAccountConnection

/** How a change is attributed in activity: "Jane Doe via Claude on my laptop" (D78, D96). */
export const attribution = (principal: Principal) => {
  const actor = { actorUserId: principal.userId, actorName: principal.name }
  switch (principal._tag) {
    case "UserSession":
      return { ...actor, viaApiKeyId: null, viaConnectionId: null, viaName: null }
    case "UserApiKey":
    case "ServiceAccountApiKey":
      return { ...actor, viaApiKeyId: principal.apiKeyId, viaConnectionId: null, viaName: principal.apiKeyName }
    case "UserConnection":
    case "ServiceAccountConnection":
      return {
        ...actor,
        viaApiKeyId: null,
        viaConnectionId: principal.connectionId,
        viaName: principal.connectionName,
      }
  }
}
