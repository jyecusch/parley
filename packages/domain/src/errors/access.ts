import { DisplayName, type DomainError, type UserText, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { Permission, Role } from "../access.ts"
import { ApiKeyId, TeamId } from "../ids.ts"

const ability = (permission: Permission): UserText => {
  switch (permission) {
    case "records:read":
      return userText`see contacts and companies`
    case "records:write":
      return userText`change contacts and companies`
    case "records:delete":
      return userText`delete contacts and companies`
    case "fields:manage":
      return userText`manage custom fields`
    case "members:manage":
      return userText`manage members`
    case "service-accounts:manage":
      return userText`manage service accounts`
    case "team:manage":
      return userText`manage the team`
    case "email:write":
      return userText`write marketing email`
    case "email:send":
      return userText`send broadcasts`
    case "email:manage":
      return userText`manage the team's email settings`
  }
}

/**
 * The principal isn't a member of the team, or the team doesn't exist.
 * One answer for both, so probing team ids reveals nothing (D35).
 */
export class NotATeamMember
  extends Schema.TaggedError<NotATeamMember>()("NotATeamMember", { teamId: TeamId, teamExists: Schema.Boolean })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return this.teamExists ? `principal is not a member of team ${this.teamId}` : `team ${this.teamId} does not exist`
  }
  get userMessage() {
    return userText`You don't have access to that team. Switch to a team you're a member of, or ask one of its admins to invite you.`
  }
}

/** A user's API key was used against a team other than the one it was issued for (D19). */
export class ApiKeyNotValidForTeam
  extends Schema.TaggedError<ApiKeyNotValidForTeam>()("ApiKeyNotValidForTeam", { teamId: TeamId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `API key is bound to a different team than ${this.teamId}`
  }
  get userMessage() {
    return userText`This API key belongs to a different team, so it can't be used here. Create an API key in the team you want to work in.`
  }
}

/** A connection was used against a team other than the one it was authorized for (D92). */
export class ConnectionNotValidForTeam
  extends Schema.TaggedError<ConnectionNotValidForTeam>()("ConnectionNotValidForTeam", { teamId: TeamId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `connection is bound to a different team than ${this.teamId}`
  }
  get userMessage() {
    return userText`This agent is connected to a different team, so it can't work here. Connect the agent again and choose this team.`
  }
}

/** The member's role doesn't grant the permission. Fixer: a team admin. */
export class RoleLacksPermission
  extends Schema.TaggedError<RoleLacksPermission>()("RoleLacksPermission", {
    team: DisplayName.schema,
    role: Role,
    needed: Permission,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `role ${this.role} lacks ${this.needed}`
  }
  get userMessage() {
    return userText`Your role in ${this.team} can't ${ability(this.needed)}. A team admin can change your role in Settings → Members.`
  }
}

/** The role allows it, but the API key's scopes don't. Fixer: whoever created the API key. */
export class ApiKeyScopeExcludes
  extends Schema.TaggedError<ApiKeyScopeExcludes>()("ApiKeyScopeExcludes", {
    team: DisplayName.schema,
    needed: Permission,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `API key scopes exclude ${this.needed}`
  }
  get userMessage() {
    return userText`This API key can't ${ability(this.needed)} in ${this.team}. Whoever created the API key can create one that can.`
  }
}

/** The service account's role doesn't grant the permission. Fixer: a team admin. */
export class ServiceAccountRoleLacksPermission
  extends Schema.TaggedError<ServiceAccountRoleLacksPermission>()("ServiceAccountRoleLacksPermission", {
    team: DisplayName.schema,
    serviceAccount: DisplayName.schema,
    role: Role,
    needed: Permission,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `service account role ${this.role} lacks ${this.needed}`
  }
  get userMessage() {
    return userText`${this.serviceAccount}'s role in ${this.team} can't ${ability(this.needed)}. A team admin can change its role in Settings → Service accounts.`
  }
}

/** The roles allow it, but the connection's scopes don't. Fixer: whoever connected the agent. */
export class ConnectionScopeExcludes
  extends Schema.TaggedError<ConnectionScopeExcludes>()("ConnectionScopeExcludes", {
    team: DisplayName.schema,
    needed: Permission,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `connection scopes exclude ${this.needed}`
  }
  get userMessage() {
    return userText`This agent wasn't allowed to ${ability(this.needed)} in ${this.team} when it was connected. Whoever connected it can connect it again with more access.`
  }
}

export const MembershipErrors = [NotATeamMember, ApiKeyNotValidForTeam, ConnectionNotValidForTeam] as const
export const PermissionErrors = [
  RoleLacksPermission,
  ServiceAccountRoleLacksPermission,
  ApiKeyScopeExcludes,
  ConnectionScopeExcludes,
] as const

/**
 * Some actions need someone signed in, never an API key or an agent's connection: neither can
 * mint teams, API keys or more connections.
 */
export class SignInRequired
  extends Schema.TaggedError<SignInRequired>()("SignInRequired", {
    action: Schema.Literals([
      "create a team",
      "create an API key",
      "connect an agent",
      "accept an invitation",
      "see your invitations",
      "decline an invitation",
      "leave a team",
      "revoke an API key",
      "revoke a connection",
    ]),
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `attempted to ${this.action} without a signed-in session`
  }
  get userMessage() {
    return userText`Only someone signed in to Parley can ${this.action}, not an API key or an agent. Sign in to ${this.action}.`
  }
}

/** No API key with that id belongs to you in this team. Also for other people's keys: no oracle. */
export class ApiKeyNotFound
  extends Schema.TaggedError<ApiKeyNotFound>()("ApiKeyNotFound", { apiKeyId: ApiKeyId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `API key ${this.apiKeyId} not found among the principal's keys in this team`
  }
  get userMessage() {
    return userText`We can't find that API key among yours in this team. It may have been revoked already.`
  }
}
