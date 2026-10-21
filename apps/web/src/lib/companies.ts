import type { Company, CompanyFields, CompanyId, Selection, TeamId } from "@parley/domain"
import type { QueryClient } from "@tanstack/react-query"
import { call } from "./client.ts"
import { customPatch } from "./custom-fields.ts"
import { patchCached, type RecordApi, refreshRecords, writeCached } from "./records.ts"

/** Companies over the API, for the paged lists and record caches (D136). */
export const companyApi: RecordApi<Company> = {
  plural: "companies",
  list: (teamId, input) => call("companies.list", { teamId, ...input }),
  get: (teamId, id) => call("companies.get", { teamId, companyId: id as CompanyId }),
}

const EDITABLE: ReadonlyArray<keyof CompanyFields & keyof Company> = [
  "name",
  "domains",
  "website",
  "phone",
  "address",
  "ownerId",
  "description",
  "employees",
  "industry",
  "yearFounded",
  "annualRevenue",
  "socialProfiles",
]

/** The fields that differ between two copies of a company, as companies.update takes them. */
const fieldsOf = (next: Company, original: Company): CompanyFields => {
  const fields: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    if (JSON.stringify(next[key]) !== JSON.stringify(original[key])) fields[key] = next[key]
  }
  // Custom values are a patch: send what changed, and null for what was cleared.
  const custom = customPatch(original.custom, next.custom)
  if (Object.keys(custom).length > 0) fields.custom = custom
  return fields as CompanyFields
}

export type CompanyDraft = { -readonly [K in keyof Company]: Company[K] }

/**
 * Saves a change to a company: it shows everywhere at once and rolls back if the server refuses it
 * (D53). Resolves to the server's copy.
 */
export const saveCompany = async (
  queryClient: QueryClient,
  teamId: TeamId,
  company: Company,
  change: (draft: CompanyDraft) => void,
): Promise<Company> => {
  const draft = structuredClone(company) as CompanyDraft
  change(draft)
  const fields = fieldsOf(draft, company)
  if (Object.keys(fields).length === 0) return company
  const undo = patchCached<Company>(queryClient, "companies", teamId, new Set([company.id]), () => draft)
  try {
    const saved = await call("companies.update", { teamId, companyId: company.id, ...fields })
    writeCached(queryClient, "companies", teamId, saved)
    return saved
  } catch (failure) {
    undo()
    throw failure
  }
}

/** Puts a company the server returned (after a logo change, say) into every cached copy. */
export const writeCompany = (queryClient: QueryClient, teamId: TeamId, company: Company) =>
  writeCached(queryClient, "companies", teamId, company)

export const refreshCompanies = (queryClient: QueryClient, teamId: TeamId) =>
  refreshRecords(queryClient, "companies", teamId)

/**
 * Deletes a selection (D137). Picked rows leave the lists at once; the result's deletedAt restores
 * them with restoreCompanies.
 */
export const deleteCompanies = async (queryClient: QueryClient, teamId: TeamId, selection: Selection) => {
  const undo =
    "ids" in selection
      ? patchCached<Company>(queryClient, "companies", teamId, new Set(selection.ids), () => undefined)
      : () => {}
  try {
    return await call("companies.deleteMany", { teamId, selection })
  } catch (failure) {
    undo()
    throw failure
  } finally {
    void refreshCompanies(queryClient, teamId)
  }
}

export const restoreCompanies = async (queryClient: QueryClient, teamId: TeamId, deletedAt: string) => {
  try {
    return await call("companies.restoreMany", { teamId, deletedAt })
  } finally {
    void refreshCompanies(queryClient, teamId)
    void queryClient.invalidateQueries({ queryKey: ["companies-deleted", teamId] })
  }
}

export const primaryDomainOf = (company: Pick<Company, "domains">) =>
  company.domains.find((entry) => entry.isPrimary)?.domain ?? company.domains[0]?.domain
