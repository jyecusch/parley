import type { ApiKeyId, Permission, TeamId, UserId } from "@parley/domain"
import type { DisplayName } from "@parley/errors"

/** A user signed in to the web app. */
export interface UserSession {
  readonly _tag: "UserSession"
  readonly userId: UserId
  readonly name: DisplayName
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

/** Who is making the request. The output of authentication, before any team is known. */
export type Principal = UserSession | UserApiKey | ServiceAccountApiKey

/** How a change is attributed in activity: "Jane Doe via Claude on my laptop" (D78). */
export const attribution = (principal: Principal) => ({
  actorUserId: principal.userId,
  actorName: principal.name,
  viaApiKeyId: principal._tag === "UserSession" ? null : principal.apiKeyId,
  viaName: principal._tag === "UserSession" ? null : principal.apiKeyName,
})
