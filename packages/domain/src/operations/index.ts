import { createApiKey, listApiKeys, revokeApiKey } from "./api-keys.ts"
import {
  contactActivity,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  restoreContact,
  updateContact,
} from "./contacts.ts"
import { createTeam, listTeams } from "./teams.ts"

export * from "./api-keys.ts"
export * from "./contacts.ts"
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
  "apiKeys.list": listApiKeys,
  "apiKeys.create": createApiKey,
  "apiKeys.revoke": revokeApiKey,
} as const
export type Operations = typeof operations
export type OperationName = keyof Operations
