import { Schema } from "effect"
import { Company, CompanyFields, CompanyName, CompanyPage } from "../company.ts"
import { ActivityEntry } from "../contact.ts"
import { CompanyDomainTaken, CompanyNotFound, FreeEmailDomain } from "../errors/companies.ts"
import { CompanyId, TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneCompany = { ...InTeam, companyId: CompanyId.annotate({ description: "The company's id." }) }

export const listCompanies = defineTeamOperation({
  name: "companies.list",
  description:
    "List companies in a team, most recently updated first. Use search to match names and domains. Pass nextCursor back as cursor for the next page.",
  input: Schema.Struct({
    ...InTeam,
    search: Schema.optional(Schema.String.check(Schema.isMaxLength(200)).annotate({ title: "Search" })),
    limit: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })).annotate({ title: "Limit" }),
    ),
    cursor: Schema.optional(Schema.String.annotate({ title: "Cursor" })),
    deleted: Schema.optional(
      Schema.Boolean.annotate({ title: "Deleted", description: "List deleted companies (restorable for 30 days)." }),
    ),
  }),
  output: CompanyPage,
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/companies" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const getCompany = defineTeamOperation({
  name: "companies.get",
  description: "Get one company by id, with its domains and address. List its contacts with affiliations.list.",
  input: Schema.Struct(OneCompany),
  output: Company,
  errors: [CompanyNotFound],
  http: { method: "GET", path: "/teams/:teamId/companies/:companyId" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createCompany = defineTeamOperation({
  name: "companies.create",
  description:
    "Create a company. A name is required. Each domain (like acme.com) can belong to one company in the team, and free email domains like gmail.com can't belong to any. Contacts whose email is on one of its domains are affiliated with it automatically.",
  input: Schema.Struct({ ...InTeam, ...CompanyFields.fields, name: CompanyName.annotate({ title: "Name" }) }),
  output: Company,
  errors: [CompanyDomainTaken, FreeEmailDomain],
  http: { method: "POST", path: "/teams/:teamId/companies" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:write"],
})

export const updateCompany = defineTeamOperation({
  name: "companies.update",
  description:
    "Change a company. Only the fields you send change. Sending domains replaces that whole list, so include the ones to keep. Contacts whose email is on a newly added domain are affiliated with it automatically.",
  input: Schema.Struct({ ...OneCompany, ...CompanyFields.fields }),
  output: Company,
  errors: [CompanyNotFound, CompanyDomainTaken, FreeEmailDomain],
  http: { method: "PATCH", path: "/teams/:teamId/companies/:companyId" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "records:write"],
})

export const deleteCompany = defineTeamOperation({
  name: "companies.delete",
  description:
    "Delete a company. It and its affiliations are hidden immediately and can be restored with companies.restore for 30 days, then they're purged. Its domains become free to use.",
  input: Schema.Struct(OneCompany),
  output: Company,
  errors: [CompanyNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/companies/:companyId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "records:delete"],
})

export const restoreCompany = defineTeamOperation({
  name: "companies.restore",
  description:
    "Restore a deleted company, with its affiliations, within 30 days. Restoring a company that isn't deleted returns it unchanged. Fails if another company has since taken one of its domains.",
  input: Schema.Struct(OneCompany),
  output: Company,
  errors: [CompanyNotFound, CompanyDomainTaken],
  http: { method: "POST", path: "/teams/:teamId/companies/:companyId/restore" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "records:delete"],
})

export const companyActivity = defineTeamOperation({
  name: "companies.activity",
  description:
    "List the changes made to a company, oldest first, including affiliations and which API key or connection made each one.",
  input: Schema.Struct(OneCompany),
  output: Schema.Array(ActivityEntry),
  errors: [CompanyNotFound],
  http: { method: "GET", path: "/teams/:teamId/companies/:companyId/activity" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})
