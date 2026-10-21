import type { OperationError, OperationInput, OperationName, OperationOutput, Operations } from "@parley/domain"
import type { Effect } from "effect"
import type { Mailer } from "../mail/mailer.ts"
import type { Principal } from "../principal.ts"
import type { Affiliations } from "../services/affiliations.ts"
import type { ApiKeys } from "../services/api-keys.ts"
import type { Broadcasts } from "../services/broadcasts.ts"
import type { Companies } from "../services/companies.ts"
import type { Connections } from "../services/connections.ts"
import type { Contacts } from "../services/contacts.ts"
import type { CustomFields } from "../services/custom-fields.ts"
import type { EmailImages } from "../services/email-images.ts"
import type { EmailStyles } from "../services/email-styles.ts"
import type { Imports } from "../services/imports.ts"
import type { Invitations } from "../services/invitations.ts"
import type { Members } from "../services/members.ts"
import type { Notes } from "../services/notes.ts"
import type { RateLimiter } from "../services/rate-limiter.ts"
import type { SavedViews } from "../services/saved-views.ts"
import type { Segments } from "../services/segments.ts"
import type { Sending } from "../services/sending.ts"
import type { ServiceAccounts } from "../services/service-accounts.ts"
import type { Subscriptions } from "../services/subscriptions.ts"
import type { Teams } from "../services/teams.ts"
import type { Templates } from "../services/templates.ts"
import type { Topics } from "../services/topics.ts"
import type { UnsubscribeLinks } from "../services/unsubscribe-links.ts"
import type { Users } from "../services/users.ts"
import * as affiliations from "./affiliations.ts"
import * as apiKeys from "./api-keys.ts"
import * as broadcasts from "./broadcasts.ts"
import * as companies from "./companies.ts"
import * as connections from "./connections.ts"
import * as contacts from "./contacts.ts"
import * as csv from "./csv.ts"
import * as customFields from "./custom-fields.ts"
import * as emailImages from "./email-images.ts"
import * as emailSetup from "./email-setup.ts"
import * as emailStyles from "./email-styles.ts"
import * as images from "./images.ts"
import * as imports from "./imports.ts"
import * as members from "./members.ts"
import * as notes from "./notes.ts"
import * as savedViews from "./saved-views.ts"
import * as segments from "./segments.ts"
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
  | Sending
  | Topics
  | Subscriptions
  | Segments
  | Templates
  | Broadcasts
  | Mailer
  | UnsubscribeLinks
  | RateLimiter
  | EmailImages
  | EmailStyles
  | Imports

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
  "invitations.mine": members.mine,
  "invitations.decline": members.decline,
  "contacts.list": contacts.list,
  "contacts.get": contacts.get,
  "contacts.create": contacts.create,
  "contacts.update": contacts.update,
  "contacts.delete": contacts.remove,
  "contacts.restore": contacts.restore,
  "contacts.updateMany": contacts.updateMany,
  "contacts.deleteMany": contacts.deleteMany,
  "contacts.restoreMany": contacts.restoreMany,
  "contacts.activity": contacts.activity,
  "contacts.export": csv.exportContactsCsv,
  "contacts.import": csv.importContactsCsv,
  "contacts.setAvatar": images.setAvatar,
  "contacts.removeAvatar": images.removeAvatar,
  "contacts.subscriptions": emailSetup.contactSubscriptions,
  "contacts.updateSubscriptions": emailSetup.updateSubscriptions,
  "companies.list": companies.list,
  "companies.get": companies.get,
  "companies.create": companies.create,
  "companies.update": companies.update,
  "companies.delete": companies.remove,
  "companies.restore": companies.restore,
  "companies.updateMany": companies.updateMany,
  "companies.deleteMany": companies.deleteMany,
  "companies.restoreMany": companies.restoreMany,
  "companies.activity": companies.activity,
  "companies.export": csv.exportCompaniesCsv,
  "companies.import": csv.importCompaniesCsv,
  "companies.setLogo": images.setLogo,
  "companies.removeLogo": images.removeLogo,
  "imports.start": imports.start,
  "imports.get": imports.get,
  "imports.list": imports.list,
  "imports.cancel": imports.cancel,
  "affiliations.list": affiliations.list,
  "affiliations.create": affiliations.create,
  "affiliations.createMany": affiliations.createMany,
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
  "emailSettings.get": emailSetup.getSettings,
  "emailSettings.update": emailSetup.updateSettings,
  "emailStyles.list": emailStyles.list,
  "emailStyles.get": emailStyles.get,
  "emailStyles.create": emailStyles.create,
  "emailStyles.update": emailStyles.update,
  "emailStyles.setDefault": emailStyles.setDefault,
  "emailStyles.delete": emailStyles.remove,
  "emailStyles.preview": emailStyles.preview,
  "emailImages.upload": emailImages.upload,
  "emailImages.import": emailImages.importFromUrl,
  "sendingDomains.list": emailSetup.listDomains,
  "sendingDomains.create": emailSetup.createDomain,
  "sendingDomains.verify": emailSetup.verifyDomain,
  "sendingDomains.delete": emailSetup.deleteDomain,
  "topics.list": emailSetup.listAllTopics,
  "topics.create": emailSetup.addTopic,
  "topics.update": emailSetup.changeTopic,
  "topics.delete": emailSetup.removeTopic,
  "segments.list": segments.list,
  "segments.get": segments.get,
  "segments.create": segments.create,
  "segments.update": segments.update,
  "segments.delete": segments.remove,
  "segments.contacts": segments.contacts,
  "segments.addContacts": segments.addContacts,
  "segments.removeContacts": segments.removeContacts,
  "templates.list": broadcasts.listAllTemplates,
  "templates.get": broadcasts.getOneTemplate,
  "templates.create": broadcasts.addTemplate,
  "templates.update": broadcasts.changeTemplate,
  "templates.delete": broadcasts.removeTemplate,
  "templates.preview": broadcasts.previewOneTemplate,
  "broadcasts.list": broadcasts.listAllBroadcasts,
  "broadcasts.get": broadcasts.getOneBroadcast,
  "broadcasts.create": broadcasts.addBroadcast,
  "broadcasts.update": broadcasts.changeBroadcast,
  "broadcasts.delete": broadcasts.removeBroadcast,
  "broadcasts.duplicate": broadcasts.copyBroadcast,
  "broadcasts.preview": broadcasts.previewOneBroadcast,
  "broadcasts.testSend": broadcasts.testSend,
  "broadcasts.send": broadcasts.send,
  "broadcasts.cancel": broadcasts.cancel,
  "broadcasts.recipients": broadcasts.recipients,
}
