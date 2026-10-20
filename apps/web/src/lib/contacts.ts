import type { Contact, ContactFields, ContactId, TeamId } from "@parley/domain"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { createCollection } from "@tanstack/react-db"
import type { QueryClient } from "@tanstack/react-query"
import { call } from "./client.ts"
import { customPatch } from "./custom-fields.ts"

/** Loads every live contact in a team, page by page. Fine for v1 team sizes; paging in the view comes later. */
const loadAll = async (teamId: TeamId) => {
  const items: Array<Contact> = []
  let cursor: string | undefined
  for (let page = 0; page < 50; page++) {
    const result = await call("contacts.list", { teamId, limit: 200, ...(cursor ? { cursor } : {}) })
    items.push(...result.items)
    if (!result.nextCursor) break
    cursor = result.nextCursor
  }
  return items
}

const EDITABLE: ReadonlyArray<keyof ContactFields> = [
  "firstName",
  "lastName",
  "emails",
  "phones",
  "subscriptionStatus",
  "ownerId",
]

const fieldsOf = (changes: Partial<Contact>, original: Contact): ContactFields => {
  const fields: Record<string, unknown> = {}
  for (const key of EDITABLE) if (key in changes) fields[key] = changes[key as keyof Contact]
  // Custom values are a patch: send what changed, and null for what was cleared.
  if (changes.custom) fields.custom = customPatch(original.custom, changes.custom)
  return fields as ContactFields
}

const makeCollection = (teamId: TeamId, queryClient: QueryClient) =>
  createCollection(
    queryCollectionOptions({
      id: `contacts:${teamId}`,
      queryKey: ["contacts", teamId],
      queryFn: () => loadAll(teamId),
      queryClient,
      getKey: (contact: Contact) => contact.id,
      // Edits and deletes apply locally at once, then persist; a server error rolls them back (D53).
      onUpdate: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await call("contacts.update", {
            teamId,
            contactId: mutation.key as ContactId,
            ...fieldsOf(mutation.changes, mutation.original as Contact),
          })
        }
      },
      onDelete: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await call("contacts.delete", { teamId, contactId: mutation.key as ContactId })
        }
      },
    }),
  )

export type ContactsCollection = ReturnType<typeof makeCollection>

/** One collection per team, kept for the session. Client-side, keyed by TeamId. */
const collections = new Map<TeamId, ContactsCollection>()

export const contactsCollection = (teamId: TeamId, queryClient: QueryClient): ContactsCollection => {
  let collection = collections.get(teamId)
  if (!collection) {
    collection = makeCollection(teamId, queryClient)
    collections.set(teamId, collection)
  }
  return collection
}

export const initialsOf = (contact: Pick<Contact, "firstName" | "lastName" | "displayName">) => {
  const fromName = `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`
  return (fromName || contact.displayName[0] || "?").toUpperCase()
}

export const displayNameOf = (firstName: string | null, lastName: string | null, primaryEmail: string | undefined) =>
  [firstName, lastName].filter(Boolean).join(" ") || primaryEmail || "Unnamed contact"
