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
  "email:write",
  "email:send",
  "email:manage",
])
export type Permission = typeof Permission.Type

const RECORDS: ReadonlyArray<Permission> = ["records:read", "records:write", "records:delete"]

/** Drafting is for everyone; sending and the sender's setup are for admins and owners (R36). */
const EMAIL: ReadonlyArray<Permission> = ["email:write", "email:send", "email:manage"]

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  member: new Set([...RECORDS, "email:write"]),
  admin: new Set([...RECORDS, ...EMAIL, "fields:manage", "members:manage", "service-accounts:manage"]),
  owner: new Set([...RECORDS, ...EMAIL, "fields:manage", "members:manage", "service-accounts:manage", "team:manage"]),
}
