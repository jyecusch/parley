import { createAffiliation, deleteAffiliation, listAffiliations, updateAffiliation } from "./affiliations.ts"
import { createApiKey, listApiKeys, revokeApiKey } from "./api-keys.ts"
import {
  companyActivity,
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  restoreCompany,
  updateCompany,
} from "./companies.ts"
import { createConnection, listConnections, revokeConnection } from "./connections.ts"
import {
  contactActivity,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  restoreContact,
  updateContact,
} from "./contacts.ts"
import { exportCompanies, exportContacts, importCompanies, importContacts } from "./csv.ts"
import { createField, deleteField, listFields, updateField } from "./custom-fields.ts"
import {
  createSendingDomain,
  createTopic,
  deleteSendingDomain,
  deleteTopic,
  getContactSubscriptions,
  getEmailSettings,
  listSendingDomains,
  listTopics,
  updateContactSubscriptions,
  updateEmailSettings,
  updateTopic,
  verifySendingDomain,
} from "./email-setup.ts"
import { removeCompanyLogo, removeContactAvatar, setCompanyLogo, setContactAvatar } from "./images.ts"
import {
  acceptInvitation,
  createInvitation,
  getInvitation,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
  updateMember,
} from "./members.ts"
import { createNote, deleteNote, listNotes, updateNote } from "./notes.ts"
import { createSavedView, deleteSavedView, listSavedViews, updateSavedView } from "./saved-views.ts"
import {
  createServiceAccount,
  deleteServiceAccount,
  listServiceAccounts,
  updateServiceAccount,
} from "./service-accounts.ts"
import { createTeam, listTeams, updateTeam } from "./teams.ts"

export * from "./affiliations.ts"
export * from "./api-keys.ts"
export * from "./companies.ts"
export * from "./connections.ts"
export * from "./contacts.ts"
export * from "./csv.ts"
export * from "./custom-fields.ts"
export * from "./email-setup.ts"
export * from "./images.ts"
export * from "./members.ts"
export * from "./notes.ts"
export * from "./saved-views.ts"
export * from "./service-accounts.ts"
export * from "./teams.ts"

/** Every operation. Entrypoints iterate this, so adding an operation here exposes it everywhere. */
export const operations = {
  "teams.list": listTeams,
  "teams.create": createTeam,
  "teams.update": updateTeam,
  "members.list": listMembers,
  "members.update": updateMember,
  "members.remove": removeMember,
  "invitations.list": listInvitations,
  "invitations.create": createInvitation,
  "invitations.revoke": revokeInvitation,
  "invitations.get": getInvitation,
  "invitations.accept": acceptInvitation,
  "contacts.list": listContacts,
  "contacts.get": getContact,
  "contacts.create": createContact,
  "contacts.update": updateContact,
  "contacts.delete": deleteContact,
  "contacts.restore": restoreContact,
  "contacts.activity": contactActivity,
  "contacts.export": exportContacts,
  "contacts.setAvatar": setContactAvatar,
  "contacts.removeAvatar": removeContactAvatar,
  "contacts.import": importContacts,
  "contacts.subscriptions": getContactSubscriptions,
  "contacts.updateSubscriptions": updateContactSubscriptions,
  "companies.list": listCompanies,
  "companies.get": getCompany,
  "companies.create": createCompany,
  "companies.update": updateCompany,
  "companies.delete": deleteCompany,
  "companies.restore": restoreCompany,
  "companies.activity": companyActivity,
  "companies.export": exportCompanies,
  "companies.setLogo": setCompanyLogo,
  "companies.removeLogo": removeCompanyLogo,
  "companies.import": importCompanies,
  "affiliations.list": listAffiliations,
  "affiliations.create": createAffiliation,
  "affiliations.update": updateAffiliation,
  "affiliations.delete": deleteAffiliation,
  "fields.list": listFields,
  "fields.create": createField,
  "fields.update": updateField,
  "fields.delete": deleteField,
  "savedViews.list": listSavedViews,
  "savedViews.create": createSavedView,
  "savedViews.update": updateSavedView,
  "savedViews.delete": deleteSavedView,
  "notes.list": listNotes,
  "notes.create": createNote,
  "notes.update": updateNote,
  "notes.delete": deleteNote,
  "apiKeys.list": listApiKeys,
  "apiKeys.create": createApiKey,
  "apiKeys.revoke": revokeApiKey,
  "connections.list": listConnections,
  "connections.create": createConnection,
  "connections.revoke": revokeConnection,
  "serviceAccounts.list": listServiceAccounts,
  "serviceAccounts.create": createServiceAccount,
  "serviceAccounts.update": updateServiceAccount,
  "serviceAccounts.delete": deleteServiceAccount,
  "emailSettings.get": getEmailSettings,
  "emailSettings.update": updateEmailSettings,
  "sendingDomains.list": listSendingDomains,
  "sendingDomains.create": createSendingDomain,
  "sendingDomains.verify": verifySendingDomain,
  "sendingDomains.delete": deleteSendingDomain,
  "topics.list": listTopics,
  "topics.create": createTopic,
  "topics.update": updateTopic,
  "topics.delete": deleteTopic,
} as const
export type Operations = typeof operations
export type OperationName = keyof Operations
