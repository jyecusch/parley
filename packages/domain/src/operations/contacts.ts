import { Schema } from "effect"
import { ActivityEntry, Contact, ContactFields, ContactPage } from "../contact.ts"
import { ContactEmailTaken, ContactNotFound } from "../errors/contacts.ts"
import { MemberNotFound } from "../errors/members.ts"
import { Filter, Sort } from "../filter.ts"
import { ContactId, TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"
import { DeletedSelection, Selection, SelectionResult } from "../selection.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneContact = { ...InTeam, contactId: ContactId.annotate({ description: "The contact's id." }) }

export const listContacts = defineTeamOperation({
  name: "contacts.list",
  description:
    "List contacts in a team, most recently updated first unless you sort. Use search to match names and email addresses, and filter for conditions on any field, including custom fields. Pass nextCursor back as cursor for the next page.",
  input: Schema.Struct({
    ...InTeam,
    search: Schema.optional(Schema.String.check(Schema.isMaxLength(200)).annotate({ title: "Search" })),
    limit: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })).annotate({ title: "Limit" }),
    ),
    cursor: Schema.optional(Schema.String.annotate({ title: "Cursor" })),
    offset: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })).annotate({
        title: "Offset",
        description: "Start this many records into the sorted list, instead of passing a cursor.",
      }),
    ),
    filter: Schema.optional(Filter),
    sort: Schema.optional(Sort),
    deleted: Schema.optional(
      Schema.Boolean.annotate({ title: "Deleted", description: "List deleted contacts (restorable for 30 days)." }),
    ),
  }),
  output: ContactPage,
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/contacts" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const getContact = defineTeamOperation({
  name: "contacts.get",
  description: "Get one contact by id, with all its emails and phones.",
  input: Schema.Struct(OneContact),
  output: Contact,
  errors: [ContactNotFound],
  http: { method: "GET", path: "/teams/:teamId/contacts/:contactId" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createContact = defineTeamOperation({
  name: "contacts.create",
  description:
    "Create a contact. Give at least a name or an email. Each email can belong to only one contact in the team; the first email is primary unless one is marked isPrimary.",
  input: Schema.Struct({ ...InTeam, ...ContactFields.fields }),
  output: Contact,
  errors: [ContactEmailTaken, MemberNotFound],
  http: { method: "POST", path: "/teams/:teamId/contacts" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:write"],
})

export const updateContact = defineTeamOperation({
  name: "contacts.update",
  description:
    "Change a contact. Only the fields you send change. Sending emails or phones replaces that whole list, so include the ones to keep.",
  input: Schema.Struct({ ...OneContact, ...ContactFields.fields }),
  output: Contact,
  errors: [ContactNotFound, ContactEmailTaken, MemberNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/contacts/:contactId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "records:write"],
})

export const deleteContact = defineTeamOperation({
  name: "contacts.delete",
  description:
    "Delete a contact. It's hidden immediately and can be restored with contacts.restore for 30 days, then it's purged. Its email addresses become free to use.",
  input: Schema.Struct(OneContact),
  output: Contact,
  errors: [ContactNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/contacts/:contactId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "records:delete"],
})

export const restoreContact = defineTeamOperation({
  name: "contacts.restore",
  description:
    "Restore a deleted contact within 30 days. Restoring a contact that isn't deleted returns it unchanged. Fails if another contact has since taken one of its emails.",
  input: Schema.Struct(OneContact),
  output: Contact,
  errors: [ContactNotFound, ContactEmailTaken],
  http: { method: "POST", path: "/teams/:teamId/contacts/:contactId/restore" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "records:delete"],
})

export const contactActivity = defineTeamOperation({
  name: "contacts.activity",
  description: "List the changes made to a contact, oldest first, including which API key made each one.",
  input: Schema.Struct(OneContact),
  output: Schema.Array(ActivityEntry),
  errors: [ContactNotFound],
  http: { method: "GET", path: "/teams/:teamId/contacts/:contactId/activity" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

const contactSelection = {
  ...InTeam,
  selection: Selection.annotate({
    description:
      'The contacts: {"ids":[...]} with up to 1,000 ids, or {"matching":{"search":"...","filter":{...}}} for every contact contacts.list would return for that search and filter.',
  }),
}

export const updateManyContacts = defineTeamOperation({
  name: "contacts.updateMany",
  description:
    "Set the same custom field values or contact owner on many contacts at once (D137): picked ids, or every contact matching a search and filter. Only the fields you send change.",
  input: Schema.Struct({
    ...contactSelection,
    custom: Schema.optional(ContactFields.fields.custom),
    ownerId: ContactFields.fields.ownerId,
  }),
  output: SelectionResult,
  errors: [MemberNotFound],
  http: { method: "POST", path: "/teams/:teamId/contacts/update-many" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "records:write"],
})

export const deleteManyContacts = defineTeamOperation({
  name: "contacts.deleteMany",
  description:
    "Delete many contacts at once (D137): picked ids, or every contact matching a search and filter. They can be restored together with contacts.restoreMany and the deletedAt this returns, for 30 days.",
  input: Schema.Struct(contactSelection),
  output: DeletedSelection,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/contacts/delete-many" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "records:delete"],
})

export const restoreManyContacts = defineTeamOperation({
  name: "contacts.restoreMany",
  description:
    "Restore the contacts one contacts.deleteMany deleted, by the deletedAt it returned. Contacts that can't be restored (purged, or whose emails were taken since) are left deleted and not counted.",
  input: Schema.Struct({
    ...InTeam,
    deletedAt: Schema.String.annotate({ description: "The deletedAt contacts.deleteMany returned." }),
  }),
  output: SelectionResult,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/contacts/restore-many" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "records:delete"],
})
