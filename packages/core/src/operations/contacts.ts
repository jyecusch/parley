import type {
  contactActivity,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  OperationInput,
  restoreContact,
  updateContact,
} from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveContactInTeam, proveContactRestorable } from "../proofs/contact-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanDeleteRecords, proveCanReadRecords, proveCanWriteRecords } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { Contacts } from "../services/contacts.ts"

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
      return yield* contacts.create(team, input, canWrite)
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
      return yield* contacts.update(target, input, canWrite)
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
