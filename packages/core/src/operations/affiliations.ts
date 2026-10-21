import type {
  createAffiliation,
  createManyAffiliations,
  deleteAffiliation,
  listAffiliations,
  OperationInput,
  updateAffiliation,
} from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveAffiliationInTeam } from "../proofs/affiliation-in-team.ts"
import { proveCompanyInTeam } from "../proofs/company-in-team.ts"
import { forEachSelectedContact, proveContactInTeam } from "../proofs/contact-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanReadRecords, proveCanWriteRecords } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { Affiliations } from "../services/affiliations.ts"

export const list = (principal: Principal, input: OperationInput<typeof listAffiliations>) =>
  named(principal, input.teamId, input.companyId, (principal, team, company) =>
    Effect.gen(function* () {
      const affiliations = yield* Affiliations
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const target = yield* proveCompanyInTeam(team, company, canRead)
      return yield* affiliations.listForCompany(target)
    }),
  )

/** Both records must be live and in the team, which the two proofs show about the same team name. */
export const create = (principal: Principal, input: OperationInput<typeof createAffiliation>) =>
  named(principal, input.teamId, input.contactId, (principal, team, contact) =>
    named(input.companyId, (company) =>
      Effect.gen(function* () {
        const affiliations = yield* Affiliations
        const member = yield* proveMemberOf(principal, team)
        const canRead = yield* proveCanReadRecords(member)
        const canWrite = yield* proveCanWriteRecords(member)
        const contactInTeam = yield* proveContactInTeam(team, contact, canRead)
        const companyInTeam = yield* proveCompanyInTeam(team, company, canRead)
        return yield* affiliations.create(contactInTeam, companyInTeam, input.title, canWrite)
      }),
    ),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateAffiliation>) =>
  named(principal, input.teamId, input.affiliationId, (principal, team, affiliation) =>
    Effect.gen(function* () {
      const affiliations = yield* Affiliations
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const target = yield* proveAffiliationInTeam(team, affiliation, canRead)
      return yield* affiliations.update(target, input.title, canWrite)
    }),
  )

export const remove = (principal: Principal, input: OperationInput<typeof deleteAffiliation>) =>
  named(principal, input.teamId, input.affiliationId, (principal, team, affiliation) =>
    Effect.gen(function* () {
      const affiliations = yield* Affiliations
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const target = yield* proveAffiliationInTeam(team, affiliation, canRead)
      return yield* affiliations.delete(target, canWrite)
    }),
  )

/** Affiliates every selected contact with the company, a chunk at a time (D137). */
export const createMany = (principal: Principal, input: OperationInput<typeof createManyAffiliations>) =>
  named(principal, input.teamId, input.companyId, (principal, team, company) =>
    Effect.gen(function* () {
      const affiliations = yield* Affiliations
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const companyInTeam = yield* proveCompanyInTeam(team, company, canRead)
      const count = yield* forEachSelectedContact(team, input.contacts, canRead, (chunk) =>
        affiliations.createMany(chunk, companyInTeam, input.title, canWrite),
      )
      return { count }
    }),
  )
