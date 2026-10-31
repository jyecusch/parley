// Type-checked, never run. Every line under @ts-expect-error is a mistake the compiler must reject.
import type { ContactFields, ContactId, TeamId, UserId } from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../src/principal.ts"
import { proveContactInTeam } from "../src/proofs/contact-in-team.ts"
import { proveMemberChangeable, proveMemberRemovable } from "../src/proofs/member-changes.ts"
import { proveMemberOf } from "../src/proofs/member-of.ts"
import {
  proveCanManageMembers,
  proveCanManageServiceAccounts,
  proveCanReadRecords,
  proveCanWriteRecords,
} from "../src/proofs/permissions.ts"
import { type Named, named } from "../src/proofs/proof.ts"
import { Contacts } from "../src/services/contacts.ts"
import { Invitations } from "../src/services/invitations.ts"
import { MemberChanges } from "../src/services/member-changes.ts"
import { Members } from "../src/services/members.ts"
import { ServiceAccounts } from "../src/services/service-accounts.ts"

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

    // @ts-expect-error a copied named value cannot replace its proven team id
    yield* contacts.list({ ...a, value: teamB }, {}, readA)
    // @ts-expect-error copying a proof cannot replace its permission
    yield* contacts.create(a, fields, { ...readA, kind: "CanWriteRecords" as const })
    // @ts-expect-error copying a membership proof cannot replace its permissions
    yield* proveCanWriteRecords({ ...memberOfA, rolePermissions: new Set(["records:write"]) })

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

// @ts-expect-error a named value cannot escape directly with its type-level name
export const escaped = named<TeamId, Named<unknown, TeamId>, never, never>(teamA, (team) => Effect.succeed(team))

declare const userId: UserId

export const memberChangeMistakes = named(principal, teamA, userId, (principal, team, user) =>
  Effect.gen(function* () {
    const changes = yield* MemberChanges
    const members = yield* Members
    const invitations = yield* Invitations
    const serviceAccounts = yield* ServiceAccounts
    const member = yield* proveMemberOf(principal, team)
    const access = yield* proveCanManageMembers(member)
    const target = yield* proveMemberChangeable(access, user, "member")
    // @ts-expect-error authorization proofs alone cannot change members without a member transaction
    yield* members.changeRole(target)
    return yield* changes.inTeam(teamA, (transaction) =>
      Effect.gen(function* () {
        // @ts-expect-error a proof from before the team lock has a different team name
        yield* members.changeRole(transaction, target)
        const freshMember = yield* proveMemberOf(principal, transaction.team)
        const freshAccess = yield* proveCanManageMembers(freshMember)
        const freshTarget = yield* proveMemberChangeable(freshAccess, user, "member")
        // @ts-expect-error a copy cannot manufacture the private member-transaction identity
        yield* members.changeRole({ ...transaction, team: transaction.team }, freshTarget)
        // @ts-expect-error managing members does not prove the invited role is permitted
        yield* invitations.create(transaction, freshAccess, "invited@example.com")
        const serviceAccess = yield* proveCanManageServiceAccounts(freshMember)
        // @ts-expect-error a service account cannot be created with the owner role
        yield* serviceAccounts.create(transaction, { name: "Import bot", role: "owner" }, serviceAccess)
        const removable = yield* proveMemberRemovable(freshMember, freshAccess, user)
        // @ts-expect-error permission to remove a member does not authorize changing their role
        yield* members.changeRole(transaction, removable)
        // @ts-expect-error the new role comes from the proof and cannot be replaced at the write
        yield* members.changeRole(transaction, freshTarget, "owner")
        return yield* members.changeRole(transaction, freshTarget)
      }),
    )
  }),
)
