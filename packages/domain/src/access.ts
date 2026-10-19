import { Schema } from "effect"

export const Role = Schema.Literals(["owner", "admin", "member"])
export type Role = typeof Role.Type

/** A capability the core checks. Explicit: none implies another (D27). */
export const Permission = Schema.Literals([
  "records:read",
  "records:write",
  "records:delete",
  "fields:manage",
  "members:manage",
  "service-accounts:manage",
  "team:manage",
])
export type Permission = typeof Permission.Type

const RECORDS: ReadonlyArray<Permission> = ["records:read", "records:write", "records:delete"]

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  member: new Set(RECORDS),
  admin: new Set([...RECORDS, "fields:manage", "members:manage", "service-accounts:manage"]),
  owner: new Set([...RECORDS, "fields:manage", "members:manage", "service-accounts:manage", "team:manage"]),
}
