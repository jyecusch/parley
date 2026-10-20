import type {
  companyActivity,
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  OperationInput,
  restoreCompany,
  updateCompany,
} from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveCompanyInTeam, proveCompanyRestorable } from "../proofs/company-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanDeleteRecords, proveCanReadRecords, proveCanWriteRecords } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { recordOwnerChange } from "../proofs/record-owner.ts"
import { Companies } from "../services/companies.ts"

export const list = (principal: Principal, input: OperationInput<typeof listCompanies>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      return yield* companies.list(team, input, canRead)
    }),
  )

export const get = (principal: Principal, input: OperationInput<typeof getCompany>) =>
  named(principal, input.teamId, input.companyId, (principal, team, company) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const target = yield* proveCompanyInTeam(team, company, canRead)
      return yield* companies.get(target)
    }),
  )

export const create = (principal: Principal, input: OperationInput<typeof createCompany>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const member = yield* proveMemberOf(principal, team)
      const canWrite = yield* proveCanWriteRecords(member)
      const owner = yield* recordOwnerChange(member, input.ownerId)
      return yield* companies.create(team, input, canWrite, owner)
    }),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateCompany>) =>
  named(principal, input.teamId, input.companyId, (principal, team, company) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const target = yield* proveCompanyInTeam(team, company, canRead)
      const owner = yield* recordOwnerChange(member, input.ownerId)
      return yield* companies.update(target, input, canWrite, owner)
    }),
  )

export const remove = (principal: Principal, input: OperationInput<typeof deleteCompany>) =>
  named(principal, input.teamId, input.companyId, (principal, team, company) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canDelete = yield* proveCanDeleteRecords(member)
      const target = yield* proveCompanyInTeam(team, company, canRead)
      return yield* companies.delete(target, canDelete)
    }),
  )

export const restore = (principal: Principal, input: OperationInput<typeof restoreCompany>) =>
  named(principal, input.teamId, input.companyId, (principal, team, company) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canDelete = yield* proveCanDeleteRecords(member)
      const target = yield* proveCompanyRestorable(team, company, canRead)
      return yield* companies.restore(target, canDelete)
    }),
  )

export const activity = (principal: Principal, input: OperationInput<typeof companyActivity>) =>
  named(principal, input.teamId, input.companyId, (principal, team, company) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const target = yield* proveCompanyInTeam(team, company, canRead)
      return yield* companies.activity(target)
    }),
  )
