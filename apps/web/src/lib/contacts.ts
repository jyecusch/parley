import type { Contact, ContactFields, ContactId, Selection, TeamId } from "@parley/domain"
import type { QueryClient } from "@tanstack/react-query"
import { call } from "./client.ts"
import { customPatch } from "./custom-fields.ts"
import { patchCached, type RecordApi, refreshRecords, writeCached } from "./records.ts"

/** Contacts over the API, for the paged lists and record caches (D136). */
export const contactApi: RecordApi<Contact> = {
  plural: "contacts",
  list: (teamId, input) => call("contacts.list", { teamId, ...input }),
  get: (teamId, id) => call("contacts.get", { teamId, contactId: id as ContactId }),
}

const EDITABLE: ReadonlyArray<keyof ContactFields & keyof Contact> = [
  "firstName",
  "lastName",
  "emails",
  "phones",
  "address",
  "subscriptionStatus",
  "ownerId",
  "socialProfiles",
]

/** The fields that differ between two copies of a contact, as contacts.update takes them. */
const fieldsOf = (next: Contact, original: Contact): ContactFields => {
  const fields: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    if (JSON.stringify(next[key]) !== JSON.stringify(original[key])) fields[key] = next[key]
  }
  // Custom values are a patch: send what changed, and null for what was cleared.
  const custom = customPatch(original.custom, next.custom)
  if (Object.keys(custom).length > 0) fields.custom = custom
  return fields as ContactFields
}

export type ContactDraft = { -readonly [K in keyof Contact]: Contact[K] }

/**
 * Saves a change to a contact: it shows everywhere at once and rolls back if the server refuses it
 * (D53). Resolves to the server's copy.
 */
export const saveContact = async (
  queryClient: QueryClient,
  teamId: TeamId,
  contact: Contact,
  change: (draft: ContactDraft) => void,
): Promise<Contact> => {
  const draft = structuredClone(contact) as ContactDraft
  change(draft)
  const primary = draft.emails.find((email) => email.isPrimary)?.address ?? draft.emails[0]?.address
  draft.displayName = displayNameOf(draft.firstName, draft.lastName, primary)
  const fields = fieldsOf(draft, contact)
  if (Object.keys(fields).length === 0) return contact
  const undo = patchCached<Contact>(queryClient, "contacts", teamId, new Set([contact.id]), () => draft)
  try {
    const saved = await call("contacts.update", { teamId, contactId: contact.id, ...fields })
    writeCached(queryClient, "contacts", teamId, saved)
    return saved
  } catch (failure) {
    undo()
    throw failure
  }
}

/** Puts a contact the server returned (after an avatar change, say) into every cached copy. */
export const writeContact = (queryClient: QueryClient, teamId: TeamId, contact: Contact) =>
  writeCached(queryClient, "contacts", teamId, contact)

export const refreshContacts = (queryClient: QueryClient, teamId: TeamId) =>
  refreshRecords(queryClient, "contacts", teamId)

/**
 * Deletes a selection (D137). Picked rows leave the lists at once; the result's deletedAt restores
 * them with restoreContacts.
 */
export const deleteContacts = async (queryClient: QueryClient, teamId: TeamId, selection: Selection) => {
  const undo =
    "ids" in selection
      ? patchCached<Contact>(queryClient, "contacts", teamId, new Set(selection.ids), () => undefined)
      : () => {}
  try {
    return await call("contacts.deleteMany", { teamId, selection })
  } catch (failure) {
    undo()
    throw failure
  } finally {
    void refreshContacts(queryClient, teamId)
  }
}

export const restoreContacts = async (queryClient: QueryClient, teamId: TeamId, deletedAt: string) => {
  try {
    return await call("contacts.restoreMany", { teamId, deletedAt })
  } finally {
    void refreshContacts(queryClient, teamId)
    void queryClient.invalidateQueries({ queryKey: ["contacts-deleted", teamId] })
  }
}

export const initialsOf = (contact: Pick<Contact, "firstName" | "lastName" | "displayName">) => {
  const fromName = `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`
  return (fromName || contact.displayName[0] || "?").toUpperCase()
}

export const displayNameOf = (firstName: string | null, lastName: string | null, primaryEmail: string | undefined) =>
  [firstName, lastName].filter(Boolean).join(" ") || primaryEmail || "Unnamed contact"
