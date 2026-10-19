import {
  ApiKeyScopeExcludes,
  ConnectionScopeExcludes,
  type Permission,
  RoleLacksPermission,
  ServiceAccountRoleLacksPermission,
} from "@parley/domain"
import { Effect } from "effect"
import { actsAsServiceAccount, type MemberOf } from "./member-of.ts"

export type { MemberOf }

import { defineProof, type Proof } from "./proof.ts"

export type PermissionError =
  | RoleLacksPermission
  | ServiceAccountRoleLacksPermission
  | ApiKeyScopeExcludes
  | ConnectionScopeExcludes

/**
 * The only code that answers "is this permission granted?". Roles are checked before scopes,
 * because each failure has a different fixer: an admin, or whoever created the API key or
 * connected the agent.
 */
export const requirePermission = <P, T>(
  member: MemberOf<P, T>,
  needed: Permission,
): Effect.Effect<void, PermissionError> => {
  const principal = member.principal.value
  if (!member.rolePermissions.has(needed)) {
    return Effect.fail(
      actsAsServiceAccount(principal)
        ? new ServiceAccountRoleLacksPermission({
            team: member.teamName,
            serviceAccount: principal.name,
            role: member.role,
            needed,
          })
        : new RoleLacksPermission({ team: member.teamName, role: member.role, needed }),
    )
  }
  if (member.connectedBy && !member.connectedBy.rolePermissions.has(needed)) {
    return Effect.fail(new RoleLacksPermission({ team: member.teamName, role: member.connectedBy.role, needed }))
  }
  switch (member.ceiling._tag) {
    case "None":
      return Effect.void
    case "ApiKey":
      return member.ceiling.scopes.has(needed)
        ? Effect.void
        : Effect.fail(new ApiKeyScopeExcludes({ team: member.teamName, needed }))
    case "Connection":
      return member.ceiling.scopes.has(needed)
        ? Effect.void
        : Effect.fail(new ConnectionScopeExcludes({ team: member.teamName, needed }))
  }
}

const CanManageServiceAccountsProver = defineProof("CanManageServiceAccounts")
const CanManageFieldsProver = defineProof("CanManageFields")
const CanManageMembersProver = defineProof("CanManageMembers")
const CanManageTeamProver = defineProof("CanManageTeam")
const CanReadRecordsProver = defineProof("CanReadRecords")
const CanWriteRecordsProver = defineProof("CanWriteRecords")
const CanDeleteRecordsProver = defineProof("CanDeleteRecords")

/** P may see contacts and companies in team T. */
export interface CanReadRecords<P, T> extends Proof<"CanReadRecords", [P, T]> {
  readonly member: MemberOf<P, T>
}
/** P may create and change contacts and companies in team T. */
export interface CanWriteRecords<P, T> extends Proof<"CanWriteRecords", [P, T]> {
  readonly member: MemberOf<P, T>
}
/** P may delete and restore contacts and companies in team T. */
export interface CanDeleteRecords<P, T> extends Proof<"CanDeleteRecords", [P, T]> {
  readonly member: MemberOf<P, T>
}

export const proveCanReadRecords = <P, T>(
  member: MemberOf<P, T>,
): Effect.Effect<CanReadRecords<P, T>, PermissionError> =>
  Effect.as(requirePermission(member, "records:read"), {
    ...CanReadRecordsProver.prove(member.principal, member.team),
    member,
  })

export const proveCanWriteRecords = <P, T>(
  member: MemberOf<P, T>,
): Effect.Effect<CanWriteRecords<P, T>, PermissionError> =>
  Effect.as(requirePermission(member, "records:write"), {
    ...CanWriteRecordsProver.prove(member.principal, member.team),
    member,
  })

export const proveCanDeleteRecords = <P, T>(
  member: MemberOf<P, T>,
): Effect.Effect<CanDeleteRecords<P, T>, PermissionError> =>
  Effect.as(requirePermission(member, "records:delete"), {
    ...CanDeleteRecordsProver.prove(member.principal, member.team),
    member,
  })

/** P may create and change service accounts in team T. */
export interface CanManageServiceAccounts<P, T> extends Proof<"CanManageServiceAccounts", [P, T]> {
  readonly member: MemberOf<P, T>
}

export const proveCanManageServiceAccounts = <P, T>(
  member: MemberOf<P, T>,
): Effect.Effect<CanManageServiceAccounts<P, T>, PermissionError> =>
  Effect.as(requirePermission(member, "service-accounts:manage"), {
    ...CanManageServiceAccountsProver.prove(member.principal, member.team),
    member,
  })

/** P may define custom fields in team T (D32). */
export interface CanManageFields<P, T> extends Proof<"CanManageFields", [P, T]> {
  readonly member: MemberOf<P, T>
}

export const proveCanManageFields = <P, T>(
  member: MemberOf<P, T>,
): Effect.Effect<CanManageFields<P, T>, PermissionError> =>
  Effect.as(requirePermission(member, "fields:manage"), {
    ...CanManageFieldsProver.prove(member.principal, member.team),
    member,
  })

/** P may invite, change and remove members of team T. */
export interface CanManageMembers<P, T> extends Proof<"CanManageMembers", [P, T]> {
  readonly member: MemberOf<P, T>
}

export const proveCanManageMembers = <P, T>(
  member: MemberOf<P, T>,
): Effect.Effect<CanManageMembers<P, T>, PermissionError> =>
  Effect.as(requirePermission(member, "members:manage"), {
    ...CanManageMembersProver.prove(member.principal, member.team),
    member,
  })

/** P may rename team T and change its settings. */
export interface CanManageTeam<P, T> extends Proof<"CanManageTeam", [P, T]> {
  readonly member: MemberOf<P, T>
}

export const proveCanManageTeam = <P, T>(member: MemberOf<P, T>): Effect.Effect<CanManageTeam<P, T>, PermissionError> =>
  Effect.as(requirePermission(member, "team:manage"), {
    ...CanManageTeamProver.prove(member.principal, member.team),
    member,
  })
