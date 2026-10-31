import {
  type CompanyId,
  CompanyNotFound,
  type DatabaseUnavailable,
  type InputRejected,
  type Selection,
  type TeamId,
} from "@parley/domain"
import type { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { Companies, type CompanyState } from "../services/companies.ts"
import { SELECTION_CHUNK } from "../services/contacts.ts"
import type { CanReadRecords } from "./permissions.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const CompanyInTeamProver = defineProof("CompanyInTeam")
const CompanyRestorableProver = defineProof("CompanyRestorable")

interface Located<C, T> {
  readonly company: Named<C, CompanyId>
  readonly team: Named<T, TeamId>
  readonly teamName: DisplayName
}

/** Company C exists in team T and isn't deleted. */
export interface CompanyInTeam<C, T> extends Proof<"CompanyInTeam", [C, T]>, Located<C, T> {}

/** Company C is in team T and is either live or deleted within the restore window. */
export interface CompanyRestorable<C, T> extends Proof<"CompanyRestorable", [C, T]>, Located<C, T> {}

const locate = <P, T, C>(
  team: Named<T, TeamId>,
  company: Named<C, CompanyId>,
  state: CompanyState,
  read: CanReadRecords<P, T>,
) =>
  Effect.gen(function* () {
    const companies = yield* Companies
    const found = yield* companies.locate(team, company.value, state, read)
    if (!found) return yield* new CompanyNotFound({ team: read.member.teamName, companyId: company.value })
    return { company, team, teamName: read.member.teamName } satisfies Located<C, T>
  })

/** Needs read access to the team before it will even look (D37: no existence oracle). */
export const proveCompanyInTeam = <P, T, C>(
  team: Named<T, TeamId>,
  company: Named<C, CompanyId>,
  read: CanReadRecords<P, T>,
): Effect.Effect<CompanyInTeam<C, T>, CompanyNotFound | DatabaseUnavailable, Companies> =>
  Effect.map(locate(team, company, "live", read), (located) => CompanyInTeamProver.prove([company, team], located))

export const proveCompanyRestorable = <P, T, C>(
  team: Named<T, TeamId>,
  company: Named<C, CompanyId>,
  read: CanReadRecords<P, T>,
): Effect.Effect<CompanyRestorable<C, T>, CompanyNotFound | DatabaseUnavailable, Companies> =>
  Effect.map(locate(team, company, "restorable", read), (located) =>
    CompanyRestorableProver.prove([company, team], located),
  )

const CompaniesInTeamProver = defineProof("CompaniesInTeam")

/** Every company in a list exists in team T and isn't deleted, for changes to many at once. */
export interface CompaniesInTeam<T> extends Proof<"CompaniesInTeam", [T]> {
  readonly team: Named<T, TeamId>
  readonly companyIds: ReadonlyArray<CompanyId>
}

/**
 * Runs `each` over the live companies a selection covers (D137), at most 1,000 at a time, each
 * chunk proven in team T as it's read. Returns the sum of what `each` returns.
 */
export const forEachSelectedCompany = <P, T, E, R>(
  team: Named<T, TeamId>,
  selection: Selection,
  read: CanReadRecords<P, T>,
  each: (chunk: CompaniesInTeam<T>) => Effect.Effect<number, E, R>,
): Effect.Effect<number, E | InputRejected | DatabaseUnavailable, R | Companies> =>
  Effect.gen(function* () {
    const companies = yield* Companies
    const selected = yield* companies.selection(team, selection, read)
    let total = 0
    let after: CompanyId | undefined
    for (;;) {
      const companyIds = yield* companies.selectChunk(selected, after)
      after = companyIds[companyIds.length - 1]
      if (after === undefined) return total
      total += yield* each(CompaniesInTeamProver.prove([team], { team, companyIds }))
      if (companyIds.length < SELECTION_CHUNK) return total
    }
  })
