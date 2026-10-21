import { Schema } from "effect"
import { Affiliation, Title } from "../company.ts"
import { AffiliationNotFound, CompanyNotFound } from "../errors/companies.ts"
import { ContactNotFound } from "../errors/contacts.ts"
import { AffiliationId, CompanyId, ContactId, TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"
import { Selection, SelectionResult } from "../selection.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneAffiliation = {
  ...InTeam,
  affiliationId: AffiliationId.annotate({
    description: "The affiliation's id, from affiliations.list or a contact's affiliations.",
  }),
}

export const listAffiliations = defineTeamOperation({
  name: "affiliations.list",
  description:
    "List the contacts affiliated with a company, oldest first, with their titles. A contact's own companies come with the contact.",
  input: Schema.Struct({ ...InTeam, companyId: CompanyId.annotate({ description: "The company's id." }) }),
  output: Schema.Array(Affiliation),
  errors: [CompanyNotFound],
  http: { method: "GET", path: "/teams/:teamId/companies/:companyId/affiliations" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createAffiliation = defineTeamOperation({
  name: "affiliations.create",
  description:
    "Affiliate a contact with a company, optionally with a title like 'CTO'. If they're already affiliated, returns the existing affiliation, updating its title if you give one.",
  input: Schema.Struct({
    ...InTeam,
    contactId: ContactId.annotate({ description: "The contact's id." }),
    companyId: CompanyId.annotate({ description: "The company's id." }),
    title: Schema.optional(Schema.NullOr(Title.annotate({ title: "Title" }))),
  }),
  output: Affiliation,
  errors: [ContactNotFound, CompanyNotFound],
  http: { method: "POST", path: "/teams/:teamId/affiliations" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "records:write"],
})

export const updateAffiliation = defineTeamOperation({
  name: "affiliations.update",
  description: "Change an affiliation's title. Send null to clear it.",
  input: Schema.Struct({ ...OneAffiliation, title: Schema.NullOr(Title.annotate({ title: "Title" })) }),
  output: Affiliation,
  errors: [AffiliationNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/affiliations/:affiliationId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "records:write"],
})

export const deleteAffiliation = defineTeamOperation({
  name: "affiliations.delete",
  description:
    "Remove an affiliation between a contact and a company. Neither record is deleted. Parley won't add it back on its own (D107).",
  input: Schema.Struct(OneAffiliation),
  output: Affiliation,
  errors: [AffiliationNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/affiliations/:affiliationId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "records:write"],
})

export const createManyAffiliations = defineTeamOperation({
  name: "affiliations.createMany",
  description:
    "Affiliate many contacts with one company at once (D137): picked contact ids, or every contact matching a search and filter. Contacts already affiliated keep their affiliation, with the title updated if you give one.",
  input: Schema.Struct({
    ...InTeam,
    contacts: Selection.annotate({
      description:
        'The contacts: {"ids":[...]} with up to 1,000 contact ids, or {"matching":{"search":"...","filter":{...}}} for every contact contacts.list would return.',
    }),
    companyId: CompanyId.annotate({ description: "The company's id." }),
    title: Schema.optional(Schema.NullOr(Title.annotate({ title: "Title" }))),
  }),
  output: SelectionResult,
  errors: [CompanyNotFound],
  http: { method: "POST", path: "/teams/:teamId/affiliations/create-many" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "records:write"],
})
