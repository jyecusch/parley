import {
  type companyActivity,
  type createCompany,
  type deleteCompany,
  type deleteManyCompanies,
  type getCompany,
  InputRejected,
  type listCompanies,
  type OperationInput,
  type restoreCompany,
  type restoreManyCompanies,
  type updateCompany,
  type updateManyCompanies,
} from "@parley/domain"
import { userText } from "@parley/errors"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { forEachSelectedCompany, proveCompanyInTeam, proveCompanyRestorable } from "../proofs/company-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanDeleteRecords, proveCanReadRecords, proveCanWriteRecords } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { recordOwnerChange } from "../proofs/record-owner.ts"
import { Companies } from "../services/companies.ts"
import { CustomFields } from "../services/custom-fields.ts"

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

/** A deletedAt from companies.deleteMany, or InputRejected. */
const deletedAtOf = (text: string) => {
  const deletedAt = new Date(text)
  return Number.isNaN(deletedAt.getTime())
    ? Effect.fail(
        new InputRejected({
          problems: [
            {
              field: "deletedAt",
              problem: "invalid-format",
              userMessage: userText`Give the deletedAt that companies.deleteMany returned.`,
            },
          ],
        }),
      )
    : Effect.succeed(deletedAt)
}

export const updateMany = (principal: Principal, input: OperationInput<typeof updateManyCompanies>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const customFields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const owner = yield* recordOwnerChange(member, input.ownerId)
      // Bad values are refused before anything changes, even when nothing matches.
      if (input.custom) yield* customFields.apply(team.value, "company", {}, input.custom)
      const count = yield* forEachSelectedCompany(team, input.selection, canRead, (chunk) =>
        companies.updateMany(chunk, { custom: input.custom, owner }, canWrite),
      )
      return { count }
    }),
  )

export const deleteMany = (principal: Principal, input: OperationInput<typeof deleteManyCompanies>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canDelete = yield* proveCanDeleteRecords(member)
      // One timestamp for every record, so restoreMany brings back exactly these (D137).
      const deletedAt = new Date()
      const count = yield* forEachSelectedCompany(team, input.selection, canRead, (chunk) =>
        companies.deleteMany(chunk, deletedAt, canDelete),
      )
      return { count, deletedAt: deletedAt.toISOString() }
    }),
  )

export const restoreMany = (principal: Principal, input: OperationInput<typeof restoreManyCompanies>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const canDelete = yield* proveCanDeleteRecords(member)
      const deletedAt = yield* deletedAtOf(input.deletedAt)
      return { count: yield* companies.restoreMany(team, deletedAt, canDelete) }
    }),
  )
