import { DisplayName, type DomainError, type UserText, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { Permission, Role } from "../access.ts"
import { TeamId } from "../ids.ts"

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

export const MembershipErrors = [NotATeamMember, ApiKeyNotValidForTeam] as const
export const PermissionErrors = [RoleLacksPermission, ApiKeyScopeExcludes] as const

/** Teams are created by someone signed in, never through an API key. */
export class TeamCreationNeedsSignIn
  extends Schema.TaggedError<TeamCreationNeedsSignIn>()("TeamCreationNeedsSignIn", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "team creation attempted with an API key"
  }
  get userMessage() {
    return userText`Teams can only be created by someone signed in to Parley, not through an API key. Sign in to create a team.`
  }
}
