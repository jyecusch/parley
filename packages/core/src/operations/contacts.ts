import {
  type contactActivity,
  type createContact,
  type deleteContact,
  type deleteManyContacts,
  type getContact,
  InputRejected,
  type listContacts,
  type OperationInput,
  type restoreContact,
  type restoreManyContacts,
  type updateContact,
  type updateManyContacts,
} from "@parley/domain"
import { userText } from "@parley/errors"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { forEachSelectedContact, proveContactInTeam, proveContactRestorable } from "../proofs/contact-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import {
  proveCanDeleteRecords,
  proveCanManageEmail,
  proveCanReadRecords,
  proveCanWriteRecords,
} from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { recordOwnerChange } from "../proofs/record-owner.ts"
import { Contacts } from "../services/contacts.ts"
import { CustomFields } from "../services/custom-fields.ts"

export const list = (principal: Principal, input: OperationInput<typeof listContacts>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      return yield* contacts.list(team, input, canRead)
    }),
  )

export const get = (principal: Principal, input: OperationInput<typeof getContact>) =>
  named(principal, input.teamId, input.contactId, (principal, team, contact) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const target = yield* proveContactInTeam(team, contact, canRead)
      return yield* contacts.get(target)
    }),
  )

export const create = (principal: Principal, input: OperationInput<typeof createContact>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      const canWrite = yield* proveCanWriteRecords(member)
      const owner = yield* recordOwnerChange(member, input.ownerId)
      return yield* contacts.create(team, input, canWrite, owner)
    }),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateContact>) =>
  named(principal, input.teamId, input.contactId, (principal, team, contact) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const target = yield* proveContactInTeam(team, contact, canRead)
      // Subscribing someone again after they opted out takes email:manage, not just records:write.
      const resubscribing =
        input.subscriptionStatus === "subscribed" && (yield* contacts.get(target)).subscriptionStatus !== "subscribed"
      const resubscribe = resubscribing ? yield* proveCanManageEmail(member) : undefined
      const owner = yield* recordOwnerChange(member, input.ownerId)
      return yield* contacts.update(target, input, canWrite, resubscribe, owner)
    }),
  )

export const remove = (principal: Principal, input: OperationInput<typeof deleteContact>) =>
  named(principal, input.teamId, input.contactId, (principal, team, contact) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canDelete = yield* proveCanDeleteRecords(member)
      const target = yield* proveContactInTeam(team, contact, canRead)
      return yield* contacts.delete(target, canDelete)
    }),
  )

export const restore = (principal: Principal, input: OperationInput<typeof restoreContact>) =>
  named(principal, input.teamId, input.contactId, (principal, team, contact) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canDelete = yield* proveCanDeleteRecords(member)
      const target = yield* proveContactRestorable(team, contact, canRead)
      return yield* contacts.restore(target, canDelete)
    }),
  )

export const activity = (principal: Principal, input: OperationInput<typeof contactActivity>) =>
  named(principal, input.teamId, input.contactId, (principal, team, contact) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const target = yield* proveContactInTeam(team, contact, canRead)
      return yield* contacts.activity(target)
    }),
  )

/** A deletedAt from contacts.deleteMany, or InputRejected. */
const deletedAtOf = (text: string) => {
  const deletedAt = new Date(text)
  return Number.isNaN(deletedAt.getTime())
    ? Effect.fail(
        new InputRejected({
          problems: [
            {
              field: "deletedAt",
              problem: "invalid-format",
              userMessage: userText`Give the deletedAt that contacts.deleteMany returned.`,
            },
          ],
        }),
      )
    : Effect.succeed(deletedAt)
}

export const updateMany = (principal: Principal, input: OperationInput<typeof updateManyContacts>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const customFields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const owner = yield* recordOwnerChange(member, input.ownerId)
      // Bad values are refused before anything changes, even when nothing matches.
      if (input.custom) yield* customFields.apply(team.value, "contact", {}, input.custom)
      const count = yield* forEachSelectedContact(team, input.selection, canRead, (chunk) =>
        contacts.updateMany(chunk, { custom: input.custom, owner }, canWrite),
      )
      return { count }
    }),
  )

export const deleteMany = (principal: Principal, input: OperationInput<typeof deleteManyContacts>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canDelete = yield* proveCanDeleteRecords(member)
      // One timestamp for every record, so restoreMany brings back exactly these (D137).
      const deletedAt = new Date()
      const count = yield* forEachSelectedContact(team, input.selection, canRead, (chunk) =>
        contacts.deleteMany(chunk, deletedAt, canDelete),
      )
      return { count, deletedAt: deletedAt.toISOString() }
    }),
  )

export const restoreMany = (principal: Principal, input: OperationInput<typeof restoreManyContacts>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const canDelete = yield* proveCanDeleteRecords(member)
      const deletedAt = yield* deletedAtOf(input.deletedAt)
      return { count: yield* contacts.restoreMany(team, deletedAt, canDelete) }
    }),
  )
