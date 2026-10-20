import { Schema } from "effect"
import { Company } from "../company.ts"
import { Contact } from "../contact.ts"
import { CompanyNotFound } from "../errors/companies.ts"
import { ContactNotFound } from "../errors/contacts.ts"
import { ImageTooLarge, ImageUnreadable } from "../errors/images.ts"
import { CompanyId, ContactId, TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneContact = { ...InTeam, contactId: ContactId.annotate({ description: "The contact's id." }) }
const OneCompany = { ...InTeam, companyId: CompanyId.annotate({ description: "The company's id." }) }
const Image = Schema.String.check(Schema.isMaxLength(14_000_000)).annotate({
  title: "Image",
  description:
    "The image as base64, or a data: URL. JPEG, PNG, WebP or GIF, up to 10 MB. It's cropped square and resized.",
})

export const setContactAvatar = defineTeamOperation({
  name: "contacts.setAvatar",
  description: "Upload a contact's avatar. It replaces any Gravatar.",
  input: Schema.Struct({ ...OneContact, image: Image }),
  output: Contact,
  errors: [ContactNotFound, ImageUnreadable, ImageTooLarge],
  http: { method: "POST", path: "/teams/:teamId/contacts/:contactId/avatar" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "records:write"],
})

export const removeContactAvatar = defineTeamOperation({
  name: "contacts.removeAvatar",
  description: "Remove a contact's uploaded avatar.",
  input: Schema.Struct(OneContact),
  output: Contact,
  errors: [ContactNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/contacts/:contactId/avatar" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "records:write"],
})

export const setCompanyLogo = defineTeamOperation({
  name: "companies.setLogo",
  description: "Upload a company's logo. It replaces the one fetched from its domain.",
  input: Schema.Struct({ ...OneCompany, image: Image }),
  output: Company,
  errors: [CompanyNotFound, ImageUnreadable, ImageTooLarge],
  http: { method: "POST", path: "/teams/:teamId/companies/:companyId/logo" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "records:write"],
})

export const removeCompanyLogo = defineTeamOperation({
  name: "companies.removeLogo",
  description: "Remove a company's uploaded logo. Parley fetches its favicon again from its primary domain.",
  input: Schema.Struct(OneCompany),
  output: Company,
  errors: [CompanyNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/companies/:companyId/logo" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "records:write"],
})
