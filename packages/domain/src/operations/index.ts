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
import { createServiceAccount, listServiceAccounts } from "./service-accounts.ts"
import { createTeam, listTeams } from "./teams.ts"

export * from "./affiliations.ts"
export * from "./api-keys.ts"
export * from "./companies.ts"
export * from "./connections.ts"
export * from "./contacts.ts"
export * from "./service-accounts.ts"
export * from "./teams.ts"

/** Every operation. Entrypoints iterate this, so adding an operation here exposes it everywhere. */
export const operations = {
  "teams.list": listTeams,
  "teams.create": createTeam,
  "contacts.list": listContacts,
  "contacts.get": getContact,
  "contacts.create": createContact,
  "contacts.update": updateContact,
  "contacts.delete": deleteContact,
  "contacts.restore": restoreContact,
  "contacts.activity": contactActivity,
  "companies.list": listCompanies,
  "companies.get": getCompany,
  "companies.create": createCompany,
  "companies.update": updateCompany,
  "companies.delete": deleteCompany,
  "companies.restore": restoreCompany,
  "companies.activity": companyActivity,
  "affiliations.list": listAffiliations,
  "affiliations.create": createAffiliation,
  "affiliations.update": updateAffiliation,
  "affiliations.delete": deleteAffiliation,
  "apiKeys.list": listApiKeys,
  "apiKeys.create": createApiKey,
  "apiKeys.revoke": revokeApiKey,
  "connections.list": listConnections,
  "connections.create": createConnection,
  "connections.revoke": revokeConnection,
  "serviceAccounts.list": listServiceAccounts,
  "serviceAccounts.create": createServiceAccount,
} as const
export type Operations = typeof operations
export type OperationName = keyof Operations
