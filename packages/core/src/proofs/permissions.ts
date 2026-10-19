import { ApiKeyScopeExcludes, type Permission, RoleLacksPermission } from "@parley/domain"
import { Effect } from "effect"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Proof } from "./proof.ts"

/**
 * The only code that answers "is this permission granted?". The role is checked first,
 * because the two failures have different fixers (an admin vs. whoever created the API key).
 */
const requirePermission = <P, T>(member: MemberOf<P, T>, needed: Permission): Effect.Effect<void, PermissionError> => {
  if (!member.rolePermissions.has(needed)) {
    return Effect.fail(new RoleLacksPermission({ team: member.teamName, role: member.role, needed }))
  }
  if (member.scopes !== "unrestricted" && !member.scopes.has(needed)) {
    return Effect.fail(new ApiKeyScopeExcludes({ team: member.teamName, needed }))
  }
  return Effect.void
}

type PermissionError = RoleLacksPermission | ApiKeyScopeExcludes

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
