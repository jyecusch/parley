import type { OperationError, OperationInput, OperationName, OperationOutput, Operations } from "@parley/domain"
import type { Effect } from "effect"
import type { Principal } from "../principal.ts"
import type { Affiliations } from "../services/affiliations.ts"
import type { ApiKeys } from "../services/api-keys.ts"
import type { Companies } from "../services/companies.ts"
import type { Connections } from "../services/connections.ts"
import type { Contacts } from "../services/contacts.ts"
import type { CustomFields } from "../services/custom-fields.ts"
import type { Invitations } from "../services/invitations.ts"
import type { Members } from "../services/members.ts"
import type { Notes } from "../services/notes.ts"
import type { SavedViews } from "../services/saved-views.ts"
import type { ServiceAccounts } from "../services/service-accounts.ts"
import type { Teams } from "../services/teams.ts"
import type { Users } from "../services/users.ts"
import * as affiliations from "./affiliations.ts"
import * as apiKeys from "./api-keys.ts"
import * as companies from "./companies.ts"
import * as connections from "./connections.ts"
import * as contacts from "./contacts.ts"
import * as csv from "./csv.ts"
import * as customFields from "./custom-fields.ts"
import * as images from "./images.ts"
import * as members from "./members.ts"
import * as notes from "./notes.ts"
import * as savedViews from "./saved-views.ts"
import * as serviceAccounts from "./service-accounts.ts"
import * as teams from "./teams.ts"

/** The services operations run on. Entrypoints provide CoreLive. */
export type OperationServices =
  | Contacts
  | Companies
  | CustomFields
  | Affiliations
  | Members
  | Invitations
  | Users
  | Notes
  | SavedViews
  | Teams
  | ApiKeys
  | Connections
  | ServiceAccounts

export type Implementation<Name extends OperationName> = (
  principal: Principal,
  input: OperationInput<Operations[Name]>,
) => Effect.Effect<OperationOutput<Operations[Name]>, OperationError<Operations[Name]>, OperationServices>

/**
 * Every operation's implementation. The mapped type makes a missing operation, an extra error,
 * or a wrong output a compile error.
 */
export const implementations: { readonly [Name in OperationName]: Implementation<Name> } = {
  "teams.list": teams.list,
  "teams.create": teams.create,
  "teams.update": teams.update,
  "members.list": members.list,
  "members.update": members.update,
  "members.remove": members.remove,
  "invitations.list": members.listPending,
  "invitations.create": members.invite,
  "invitations.revoke": members.revoke,
  "invitations.get": members.get,
  "invitations.accept": members.accept,
  "contacts.list": contacts.list,
  "contacts.get": contacts.get,
  "contacts.create": contacts.create,
  "contacts.update": contacts.update,
  "contacts.delete": contacts.remove,
  "contacts.restore": contacts.restore,
  "contacts.activity": contacts.activity,
  "contacts.export": csv.exportContactsCsv,
  "contacts.import": csv.importContactsCsv,
  "contacts.setAvatar": images.setAvatar,
  "contacts.removeAvatar": images.removeAvatar,
  "companies.list": companies.list,
  "companies.get": companies.get,
  "companies.create": companies.create,
  "companies.update": companies.update,
  "companies.delete": companies.remove,
  "companies.restore": companies.restore,
  "companies.activity": companies.activity,
  "companies.export": csv.exportCompaniesCsv,
  "companies.import": csv.importCompaniesCsv,
  "companies.setLogo": images.setLogo,
  "companies.removeLogo": images.removeLogo,
  "affiliations.list": affiliations.list,
  "affiliations.create": affiliations.create,
  "affiliations.update": affiliations.update,
  "affiliations.delete": affiliations.remove,
  "fields.list": customFields.list,
  "fields.create": customFields.create,
  "fields.update": customFields.update,
  "fields.delete": customFields.remove,
  "savedViews.list": savedViews.list,
  "savedViews.create": savedViews.create,
  "savedViews.update": savedViews.update,
  "savedViews.delete": savedViews.remove,
  "notes.list": notes.list,
  "notes.create": notes.create,
  "notes.update": notes.update,
  "notes.delete": notes.remove,
  "apiKeys.list": apiKeys.list,
  "apiKeys.create": apiKeys.create,
  "apiKeys.revoke": apiKeys.revoke,
  "connections.list": connections.list,
  "connections.create": connections.create,
  "connections.revoke": connections.revoke,
  "serviceAccounts.list": serviceAccounts.list,
  "serviceAccounts.create": serviceAccounts.create,
  "serviceAccounts.update": serviceAccounts.update,
  "serviceAccounts.delete": serviceAccounts.remove,
}
