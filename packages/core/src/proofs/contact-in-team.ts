import {
  type ContactId,
  ContactNotFound,
  type DatabaseUnavailable,
  type InputRejected,
  type Selection,
  type TeamId,
} from "@parley/domain"
import type { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { type ContactState, Contacts, SELECTION_CHUNK } from "../services/contacts.ts"
import type { CanReadRecords } from "./permissions.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const ContactInTeamProver = defineProof("ContactInTeam")
const ContactRestorableProver = defineProof("ContactRestorable")

interface Located<C, T> {
  readonly contact: Named<C, ContactId>
  readonly team: Named<T, TeamId>
  readonly teamName: DisplayName
}

/** Contact C exists in team T and isn't deleted. */
export interface ContactInTeam<C, T> extends Proof<"ContactInTeam", [C, T]>, Located<C, T> {}

/** Contact C is in team T and is either live or deleted within the restore window. */
export interface ContactRestorable<C, T> extends Proof<"ContactRestorable", [C, T]>, Located<C, T> {}

const locate = <P, T, C>(
  team: Named<T, TeamId>,
  contact: Named<C, ContactId>,
  state: ContactState,
  read: CanReadRecords<P, T>,
) =>
  Effect.gen(function* () {
    const contacts = yield* Contacts
    const found = yield* contacts.locate(team, contact.value, state, read)
    if (!found) return yield* new ContactNotFound({ team: read.member.teamName, contactId: contact.value })
    return { contact, team, teamName: read.member.teamName } satisfies Located<C, T>
  })

/** Needs read access to the team before it will even look (D37: no existence oracle). */
export const proveContactInTeam = <P, T, C>(
  team: Named<T, TeamId>,
  contact: Named<C, ContactId>,
  read: CanReadRecords<P, T>,
): Effect.Effect<ContactInTeam<C, T>, ContactNotFound | DatabaseUnavailable, Contacts> =>
  Effect.map(locate(team, contact, "live", read), (located) => ContactInTeamProver.prove([contact, team], located))

export const proveContactRestorable = <P, T, C>(
  team: Named<T, TeamId>,
  contact: Named<C, ContactId>,
  read: CanReadRecords<P, T>,
): Effect.Effect<ContactRestorable<C, T>, ContactNotFound | DatabaseUnavailable, Contacts> =>
  Effect.map(locate(team, contact, "restorable", read), (located) =>
    ContactRestorableProver.prove([contact, team], located),
  )

const ContactsInTeamProver = defineProof("ContactsInTeam")

/** Every contact in a list exists in team T and isn't deleted, for changes to many at once. */
export interface ContactsInTeam<T> extends Proof<"ContactsInTeam", [T]> {
  readonly team: Named<T, TeamId>
  readonly contactIds: ReadonlyArray<ContactId>
}

export const proveContactsInTeam = <P, T>(
  team: Named<T, TeamId>,
  contactIds: ReadonlyArray<ContactId>,
  read: CanReadRecords<P, T>,
): Effect.Effect<ContactsInTeam<T>, ContactNotFound | DatabaseUnavailable, Contacts> =>
  Effect.gen(function* () {
    const contacts = yield* Contacts
    const found = yield* contacts.locateMany(team, contactIds, read)
    const missing = contactIds.find((id) => !found.has(id))
    if (missing) return yield* new ContactNotFound({ team: read.member.teamName, contactId: missing })
    return ContactsInTeamProver.prove([team], { team, contactIds: [...new Set(contactIds)] })
  })

/**
 * Runs `each` over the live contacts a selection covers (D137), at most 1,000 at a time, each chunk
 * proven in team T as it's read. Returns the sum of what `each` returns.
 */
export const forEachSelectedContact = <P, T, E, R>(
  team: Named<T, TeamId>,
  selection: Selection,
  read: CanReadRecords<P, T>,
  each: (chunk: ContactsInTeam<T>) => Effect.Effect<number, E, R>,
): Effect.Effect<number, E | InputRejected | DatabaseUnavailable, R | Contacts> =>
  Effect.gen(function* () {
    const contacts = yield* Contacts
    const selected = yield* contacts.selection(team, selection, read)
    let total = 0
    let after: ContactId | undefined
    for (;;) {
      const contactIds = yield* contacts.selectChunk(selected, after)
      after = contactIds[contactIds.length - 1]
      if (after === undefined) return total
      total += yield* each(ContactsInTeamProver.prove([team], { team, contactIds }))
      if (contactIds.length < SELECTION_CHUNK) return total
    }
  })
