import {
  type addSegmentContacts,
  type createSegment,
  type deleteSegment,
  type getSegment,
  InputRejected,
  type listSegmentContacts,
  type listSegments,
  type OperationInput,
  type removeSegmentContacts,
  type updateSegment,
} from "@parley/domain"
import { userText } from "@parley/errors"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { forEachSelectedContact, proveContactsInTeam } from "../proofs/contact-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanReadRecords, proveCanWriteEmail } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { proveSegmentInTeam, proveSegmentIsFixed } from "../proofs/segment-in-team.ts"
import { Contacts } from "../services/contacts.ts"
import { Segments } from "../services/segments.ts"

export const list = (principal: Principal, input: OperationInput<typeof listSegments>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const segments = yield* Segments
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return yield* segments.list(member)
    }),
  )

export const get = (principal: Principal, input: OperationInput<typeof getSegment>) =>
  named(principal, input.teamId, input.segmentId, (principal, team, segment) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const target = yield* proveSegmentInTeam(member, segment)
      return target.found
    }),
  )

export const create = (principal: Principal, input: OperationInput<typeof createSegment>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const segments = yield* Segments
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      return yield* segments.create(access, input)
    }),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateSegment>) =>
  named(principal, input.teamId, input.segmentId, (principal, team, segment) =>
    Effect.gen(function* () {
      const segments = yield* Segments
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveSegmentInTeam(member, segment)
      return yield* segments.update(target, input, access)
    }),
  )

export const remove = (principal: Principal, input: OperationInput<typeof deleteSegment>) =>
  named(principal, input.teamId, input.segmentId, (principal, team, segment) =>
    Effect.gen(function* () {
      const segments = yield* Segments
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveSegmentInTeam(member, segment)
      return yield* segments.delete(target, access)
    }),
  )

export const contacts = (principal: Principal, input: OperationInput<typeof listSegmentContacts>) =>
  named(principal, input.teamId, input.segmentId, (principal, team, segment) =>
    Effect.gen(function* () {
      const segments = yield* Segments
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const target = yield* proveSegmentInTeam(member, segment)
      const scope = yield* segments.scope(target)
      return yield* contacts
        .list(team, { limit: input.limit, cursor: input.cursor }, canRead, scope)
        // A cursor is the only input a segment's listing can reject, and only one we gave out.
        .pipe(Effect.catchTag("InputRejected", () => Effect.succeed({ items: [], nextCursor: null, total: null })))
    }),
  )

export const addContacts = (principal: Principal, input: OperationInput<typeof addSegmentContacts>) =>
  named(principal, input.teamId, input.segmentId, (principal, team, segment) =>
    Effect.gen(function* () {
      const segments = yield* Segments
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveSegmentInTeam(member, segment)
      const fixed = yield* proveSegmentIsFixed(target)
      if ((input.contactIds === undefined) === (input.matching === undefined)) {
        return yield* new InputRejected({
          problems: [
            {
              field: "contactIds",
              problem: input.contactIds === undefined ? "missing" : "conflict",
              userMessage: userText`Give either contactIds or matching, not both.`,
            },
          ],
        })
      }
      if (input.contactIds) {
        const found = yield* proveContactsInTeam(team, input.contactIds, canRead)
        return yield* segments.addContacts(target, fixed, found, access)
      }
      // Every matching contact, a chunk at a time (D137); then the segment as it ends up.
      yield* forEachSelectedContact(team, { matching: input.matching ?? {} }, canRead, (chunk) =>
        Effect.as(segments.addContacts(target, fixed, chunk, access), chunk.contactIds.length),
      )
      return yield* segments.addContacts(target, fixed, yield* proveContactsInTeam(team, [], canRead), access)
    }),
  )

export const removeContacts = (principal: Principal, input: OperationInput<typeof removeSegmentContacts>) =>
  named(principal, input.teamId, input.segmentId, (principal, team, segment) =>
    Effect.gen(function* () {
      const segments = yield* Segments
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveSegmentInTeam(member, segment)
      const fixed = yield* proveSegmentIsFixed(target)
      return yield* segments.removeContacts(target, fixed, input.contactIds, access)
    }),
  )
