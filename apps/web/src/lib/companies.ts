import type { Company, CompanyFields, CompanyId, TeamId } from "@parley/domain"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { createCollection } from "@tanstack/react-db"
import type { QueryClient } from "@tanstack/react-query"
import { call } from "./client.ts"
import { customPatch } from "./custom-fields.ts"

/** Loads every live company in a team, page by page, like contacts. */
const loadAll = async (teamId: TeamId) => {
  const items: Array<Company> = []
  let cursor: string | undefined
  for (let page = 0; page < 50; page++) {
    const result = await call("companies.list", { teamId, limit: 200, ...(cursor ? { cursor } : {}) })
    items.push(...result.items)
    if (!result.nextCursor) break
    cursor = result.nextCursor
  }
  return items
}

const EDITABLE: ReadonlyArray<keyof CompanyFields> = [
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

const fieldsOf = (changes: Partial<Company>, original: Company): CompanyFields => {
  const fields: Record<string, unknown> = {}
  for (const key of EDITABLE) if (key in changes) fields[key] = changes[key as keyof Company]
  // Custom values are a patch: send what changed, and null for what was cleared.
  if (changes.custom) fields.custom = customPatch(original.custom, changes.custom)
  return fields as CompanyFields
}

const makeCollection = (teamId: TeamId, queryClient: QueryClient) =>
  createCollection(
    queryCollectionOptions({
      id: `companies:${teamId}`,
      queryKey: ["companies", teamId],
      queryFn: () => loadAll(teamId),
      queryClient,
      getKey: (company: Company) => company.id,
      // Edits and deletes apply locally at once, then persist; a server error rolls them back (D53).
      onUpdate: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await call("companies.update", {
            teamId,
            companyId: mutation.key as CompanyId,
            ...fieldsOf(mutation.changes, mutation.original as Company),
          })
        }
      },
      onDelete: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await call("companies.delete", { teamId, companyId: mutation.key as CompanyId })
        }
      },
    }),
  )

export type CompaniesCollection = ReturnType<typeof makeCollection>

/** One collection per team, kept for the session. */
const collections = new Map<TeamId, CompaniesCollection>()

export const companiesCollection = (teamId: TeamId, queryClient: QueryClient): CompaniesCollection => {
  let collection = collections.get(teamId)
  if (!collection) {
    collection = makeCollection(teamId, queryClient)
    collections.set(teamId, collection)
  }
  return collection
}

export const primaryDomainOf = (company: Pick<Company, "domains">) =>
  company.domains.find((entry) => entry.isPrimary)?.domain ?? company.domains[0]?.domain
