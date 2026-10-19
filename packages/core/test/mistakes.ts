// Type-checked, never run. Every line under @ts-expect-error is a mistake the compiler must reject.
import type { ContactFields, ContactId, TeamId } from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../src/principal.ts"
import { proveContactInTeam } from "../src/proofs/contact-in-team.ts"
import { proveMemberOf } from "../src/proofs/member-of.ts"
import { proveCanReadRecords, proveCanWriteRecords } from "../src/proofs/permissions.ts"
import { named } from "../src/proofs/proof.ts"
import { Contacts } from "../src/services/contacts.ts"

declare const principal: Principal
declare const teamA: TeamId
declare const teamB: TeamId
declare const contactId: ContactId
declare const fields: ContactFields

export const mistakes = named(principal, teamA, teamB, (principal, a, b) =>
  Effect.gen(function* () {
    const contacts = yield* Contacts
    const memberOfA = yield* proveMemberOf(principal, a)
    const readA = yield* proveCanReadRecords(memberOfA)
    const writeA = yield* proveCanWriteRecords(memberOfA)

    // @ts-expect-error a read proof about team A cannot list team B
    yield* contacts.list(b, {}, readA)
    // @ts-expect-error a raw id is not a named, proven team
    yield* contacts.list(teamA, {}, readA)
    // @ts-expect-error no proof at all
    yield* contacts.list(a, {})
    // @ts-expect-error a write proof about team A cannot create in team B
    yield* contacts.create(b, fields, writeA)
    // @ts-expect-error reading isn't writing
    yield* contacts.create(a, fields, readA)

    return yield* named(contactId, (contact) =>
      Effect.gen(function* () {
        const target = yield* proveContactInTeam(a, contact, readA)
        // @ts-expect-error a contact proven in team A, written with a proof about team B
        yield* contacts.update(target, fields, yield* proveCanWriteRecords(yield* proveMemberOf(principal, b)))
        // @ts-expect-error a raw ContactId is not a ContactInTeam proof
        yield* contacts.update(contactId, fields, writeA)
        return yield* contacts.update(target, fields, writeA)
      }),
    )
  }),
)

// @ts-expect-error names and proofs cannot escape the callback that created them
export const escaped = named(teamA, (team) => Effect.succeed(team))
