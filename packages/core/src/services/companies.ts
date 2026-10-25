import { Database, schema } from "@parley/db"
import {
  type ActivityEntry,
  type Company,
  CompanyDomainTaken,
  type CompanyFields,
  type CompanyId,
  type CompanyPage,
  type CustomValues,
  type CustomValuesPatch,
  type DatabaseUnavailable,
  type FieldProblem,
  type Filter,
  FreeEmailDomain,
  filterFields,
  InputRejected,
  isFreeEmailDomain,
  isUuid,
  type Matching,
  normalizeDomain,
  type PostalAddress,
  type Selection,
  type Sort,
  type TeamId,
  type UserId,
} from "@parley/domain"
import { DisplayName, EchoedInput, userText } from "@parley/errors"
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm"
import { Config, Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { fetchFavicon } from "../files/favicon.ts"
import type { Principal } from "../principal.ts"
import type { CompaniesInTeam, CompanyInTeam, CompanyRestorable } from "../proofs/company-in-team.ts"
import type { CanDeleteRecords, CanReadRecords, CanWriteRecords } from "../proofs/permissions.ts"
import type { Named } from "../proofs/proof.ts"
import type { RecordOwnerChange } from "../proofs/record-owner.ts"
import { activityRow, toActivityEntry } from "./activity.ts"
import { addressColumns, addressOfRow, normalizeAddress } from "./addresses.ts"
import { Affiliations } from "./affiliations.ts"
import { RESTORE_WINDOW_DAYS, SELECTION_CHUNK } from "./contacts.ts"
import { decodeCursor, decodeOffset, encodeCursor, encodeOffset, MAX_OFFSET } from "./cursors.ts"
import { CustomFields } from "./custom-fields.ts"
import { FileStore, fileUrl } from "./file-store.ts"
import { checkFilter, filterSql, sortSql } from "./filter-sql.ts"
import { uniqueProfiles } from "./social-profiles.ts"
import { classifySqlError, isUniqueViolation } from "./sql-errors.ts"

export interface CompanyQuery {
  readonly search?: string | undefined
  readonly filter?: Filter | undefined
  readonly sort?: Sort | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  /** A position in the sorted list to start at, instead of a cursor (D136). */
  readonly offset?: number | undefined
  readonly deleted?: boolean | undefined
}

/**
 * The live companies in team T a selection covers (D137), as a condition. Made by `selection`;
 * read a chunk at a time with `selectChunk`.
 */
export interface CompanySelection<T> {
  readonly team: Named<T, TeamId>
  readonly where: SQL
}

/** Which companies a lookup may find: live ones, or deleted ones still inside the restore window. */
export type CompanyState = "live" | "restorable"

/** A company the CompanyInTeam prover found. Only provers turn this into a proof. */
export interface LocatedCompany {
  readonly id: CompanyId
  readonly deleted: boolean
}

const DOMAINS_KEY = "company_domains_team_id_domain_key"

/** Companies whose name or any domain contains the search, case-insensitively. Undefined for no search. */
const searchSql = (search: string | undefined): SQL | undefined => {
  const trimmed = search?.trim()
  if (!trimmed) return undefined
  const pattern = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return or(
    ilike(schema.companies.name, pattern),
    sql`exists (select 1 from ${schema.companyDomains} where ${schema.companyDomains.companyId} = ${schema.companies.id} and ${schema.companyDomains.domain} ilike ${pattern})`,
  )
}

/** Deleted companies that can still be restored. */
const restorableSql = and(
  isNotNull(schema.companies.deletedAt),
  sql`${schema.companies.deletedAt} > now() - make_interval(days => ${RESTORE_WINDOW_DAYS})`,
)

interface NormalizedFields {
  readonly name?: string
  readonly domains?: ReadonlyArray<{ readonly domain: string; readonly isPrimary: boolean }>
  readonly website?: string | null
  readonly phone?: string | null
  readonly address?: PostalAddress | null
  readonly description?: string | null
  readonly employees?: number | null
  readonly industry?: string | null
  readonly yearFounded?: number | null
  readonly annualRevenue?: number | null
  readonly socialProfiles?: ReadonlyArray<string>
}

/** Text that's empty once trimmed is no text. */
const textOrNull = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Rules that span fields. Each problem names its field and never echoes the value (D26). */
const normalize = (fields: CompanyFields): Effect.Effect<NormalizedFields, InputRejected | FreeEmailDomain> => {
  const problems: Array<FieldProblem> = []
  let domains: NormalizedFields["domains"]
  if (fields.domains !== undefined) {
    const seen = new Set<string>()
    const normalized = fields.domains.map((entry, index) => {
      const domain = normalizeDomain(entry.domain)
      if (seen.has(domain)) {
        problems.push({
          field: `domains.${index}.domain`,
          problem: "conflict",
          userMessage: userText`This domain is listed twice. List each domain once.`,
        })
      }
      seen.add(domain)
      return { domain, isPrimary: entry.isPrimary === true }
    })
    const free = normalized.find((entry) => isFreeEmailDomain(entry.domain))
    if (free) return Effect.fail(new FreeEmailDomain({ domain: EchoedInput.fromRequest(free.domain) }))
    const primaries = normalized.filter((entry) => entry.isPrimary).length
    if (primaries > 1) {
      problems.push({ field: "domains", problem: "conflict", userMessage: userText`Only one domain can be primary.` })
    }
    domains = primaries === 0 ? normalized.map((entry, index) => ({ ...entry, isPrimary: index === 0 })) : normalized
  }
  if (problems.length > 0) return Effect.fail(new InputRejected({ problems }))
  return Effect.succeed({
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(domains !== undefined ? { domains } : {}),
    ...(fields.website !== undefined ? { website: fields.website } : {}),
    ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
    ...(fields.address !== undefined ? { address: normalizeAddress(fields.address) } : {}),
    ...(fields.description !== undefined ? { description: textOrNull(fields.description) } : {}),
    ...(fields.employees !== undefined ? { employees: fields.employees } : {}),
    ...(fields.industry !== undefined ? { industry: textOrNull(fields.industry) } : {}),
    ...(fields.yearFounded !== undefined ? { yearFounded: fields.yearFounded } : {}),
    ...(fields.annualRevenue !== undefined ? { annualRevenue: fields.annualRevenue } : {}),
    ...(fields.socialProfiles !== undefined ? { socialProfiles: uniqueProfiles(fields.socialProfiles) } : {}),
  })
}

/** The profile fields given (D132, D133), as columns. Fields not given are left as they are. */
const profileColumns = (fields: NormalizedFields) => ({
  ...("description" in fields ? { description: fields.description ?? null } : {}),
  ...("employees" in fields ? { employees: fields.employees ?? null } : {}),
  ...("industry" in fields ? { industry: fields.industry ?? null } : {}),
  ...("yearFounded" in fields ? { yearFounded: fields.yearFounded ?? null } : {}),
  ...("annualRevenue" in fields ? { annualRevenue: fields.annualRevenue ?? null } : {}),
  ...(fields.socialProfiles !== undefined ? { socialProfiles: [...fields.socialProfiles] } : {}),
})

/** Contacts affiliated with the company that aren't deleted (D108, D109). */
const contactCountSql = sql<number>`(
  select count(*)::int from "affiliations" a
  join "contacts" c on c.id = a.contact_id
  where a.company_id = "companies"."id" and c.deleted_at is null
)`

export class Companies extends Context.Service<
  Companies,
  {
    readonly list: <P, T>(
      team: Named<T, TeamId>,
      query: CompanyQuery,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<CompanyPage, InputRejected | DatabaseUnavailable>
    /** The companies a selection covers (D137). Fails on a filter the list would refuse. */
    readonly selection: <P, T>(
      team: Named<T, TeamId>,
      selection: Selection,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<CompanySelection<T>, InputRejected | DatabaseUnavailable>
    /** Used only by the CompaniesInTeam prover: the next ids of a selection, in id order, after `after`. */
    readonly selectChunk: <T>(
      selection: CompanySelection<T>,
      after: CompanyId | undefined,
    ) => Effect.Effect<ReadonlyArray<CompanyId>, DatabaseUnavailable>
    /**
     * Sets custom field values (as a patch, like update) and the record owner on many companies.
     * Returns how many live companies it looked at.
     */
    readonly updateMany: <P, T>(
      companies: CompaniesInTeam<T>,
      change: { readonly custom?: CustomValuesPatch | undefined; readonly owner?: RecordOwnerChange<T> },
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<number, InputRejected | DatabaseUnavailable>
    /** Deletes many companies with one shared `deletedAt`, so restoreMany can bring back exactly those. */
    readonly deleteMany: <P, T>(
      companies: CompaniesInTeam<T>,
      deletedAt: Date,
      access: CanDeleteRecords<P, T>,
    ) => Effect.Effect<number, DatabaseUnavailable>
    /** Restores the companies deleted at `deletedAt` that can be; returns how many. */
    readonly restoreMany: <P, T>(
      team: Named<T, TeamId>,
      deletedAt: Date,
      access: CanDeleteRecords<P, T>,
    ) => Effect.Effect<number, DatabaseUnavailable>
    /**
     * For imports: the live company each of these domains belongs to, and the one each of these
     * names (compared lower-case) belongs to, the oldest when several share a name.
     */
    readonly matchKeys: <P, T>(
      team: Named<T, TeamId>,
      keys: { readonly domains: ReadonlyArray<string>; readonly names: ReadonlyArray<string> },
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<
      { readonly byDomain: ReadonlyMap<string, CompanyId>; readonly byName: ReadonlyMap<string, CompanyId> },
      DatabaseUnavailable
    >
    /** Used only by the CompanyInTeam and CompanyRestorable provers. */
    readonly locate: <P, T>(
      team: Named<T, TeamId>,
      companyId: CompanyId,
      state: CompanyState,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<LocatedCompany | undefined, DatabaseUnavailable>
    readonly get: <K, T>(target: CompanyInTeam<K, T>) => Effect.Effect<Company, DatabaseUnavailable>
    readonly create: <P, T>(
      team: Named<T, TeamId>,
      fields: CompanyFields & { readonly name: string },
      access: CanWriteRecords<P, T>,
      /** The record owner (D123), already proven a member; undefined leaves none. `fields.ownerId` is ignored. */
      owner?: RecordOwnerChange<T>,
      /** Only for imports: the record's original created date (D129). */
      imported?: { readonly createdAt?: Date | undefined },
    ) => Effect.Effect<Company, InputRejected | FreeEmailDomain | CompanyDomainTaken | DatabaseUnavailable>
    readonly update: <P, T, K>(
      target: CompanyInTeam<K, T>,
      fields: CompanyFields,
      access: CanWriteRecords<P, T>,
      /** Undefined leaves the record owner as it is, null clears it (D123). `fields.ownerId` is ignored. */
      owner?: RecordOwnerChange<T>,
    ) => Effect.Effect<Company, InputRejected | FreeEmailDomain | CompanyDomainTaken | DatabaseUnavailable>
    readonly delete: <P, T, K>(
      target: CompanyInTeam<K, T>,
      access: CanDeleteRecords<P, T>,
    ) => Effect.Effect<Company, DatabaseUnavailable>
    readonly restore: <P, T, K>(
      target: CompanyRestorable<K, T>,
      access: CanDeleteRecords<P, T>,
    ) => Effect.Effect<Company, CompanyDomainTaken | DatabaseUnavailable>
    readonly activity: <K, T>(
      target: CompanyInTeam<K, T>,
    ) => Effect.Effect<ReadonlyArray<ActivityEntry>, DatabaseUnavailable>
    /** Stores an uploaded logo (D75, D76); null removes it and looks for the favicon again. */
    readonly setLogo: <P, T, K>(
      target: CompanyInTeam<K, T>,
      image: Uint8Array | null,
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<Company, DatabaseUnavailable>
  }
>()("@parley/core/Companies") {
  static readonly layer = Layer.effect(
    Companies,
    Effect.gen(function* () {
      const db = yield* Database
      const affiliations = yield* Affiliations
      const customFields = yield* CustomFields
      const files = yield* FileStore
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))
      const fetchLogos = yield* Config.withDefault(Config.Boolean("FETCH_LOGOS"), true).pipe(Effect.orDie)

      /** Stores a company's logo and where it came from, replacing the old file. */
      const storeLogo = (teamId: TeamId, id: string, image: Uint8Array | null, source: "upload" | "favicon" | null) =>
        Effect.gen(function* () {
          const [row] = yield* run(
            db.query((d) =>
              d.select({ logoKey: schema.companies.logoKey }).from(schema.companies).where(eq(schema.companies.id, id)),
            ),
          )
          const key = image ? `${teamId}/logos/${id}-${crypto.randomUUID().slice(0, 8)}.webp` : null
          if (image && key) yield* files.put(teamId, key, { bytes: image, contentType: "image/webp" })
          yield* run(
            db.query((d) =>
              d.update(schema.companies).set({ logoKey: key, logoSource: source }).where(eq(schema.companies.id, id)),
            ),
          )
          if (row?.logoKey) yield* files.remove(row.logoKey)
        })

      /**
       * Looks for the primary domain's icon in the background (D75). Never replaces an uploaded logo,
       * and never holds up the request that triggered it.
       */
      const refreshFavicon = (teamId: TeamId, id: string, domain: string | undefined) =>
        fetchLogos && domain
          ? Effect.forkDetach(
              Effect.gen(function* () {
                const icon = yield* fetchFavicon(domain)
                const [row] = yield* run(
                  db.query((d) =>
                    d
                      .select({ logoSource: schema.companies.logoSource })
                      .from(schema.companies)
                      .where(eq(schema.companies.id, id)),
                  ),
                )
                if (!icon || row?.logoSource === "upload") return
                yield* storeLogo(teamId, id, icon, "favicon")
              }).pipe(Effect.catchCause((cause) => Effect.logDebug("logo fetch failed", cause))),
            ).pipe(Effect.asVoid)
          : Effect.void

      /** Loads full companies, with domains and contact counts, in the order of `ids`. */
      const load = (teamId: TeamId, ids: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (ids.length === 0) return []
          const [rows, domains] = yield* Effect.all([
            run(
              db.query((d) =>
                d
                  .select({ company: schema.companies, contactCount: contactCountSql, ownerName: schema.user.name })
                  .from(schema.companies)
                  .leftJoin(schema.user, eq(schema.user.id, schema.companies.ownerId))
                  .where(and(eq(schema.companies.teamId, teamId), inArray(schema.companies.id, [...ids]))),
              ),
            ),
            run(
              db.query((d) =>
                d
                  .select()
                  .from(schema.companyDomains)
                  .where(
                    and(eq(schema.companyDomains.teamId, teamId), inArray(schema.companyDomains.companyId, [...ids])),
                  )
                  .orderBy(asc(schema.companyDomains.position)),
              ),
            ),
          ])
          const byId = new Map(rows.map((row) => [row.company.id, row]))
          return ids.flatMap((id): Array<Company> => {
            const found = byId.get(id)
            if (!found) return []
            const { company: row, contactCount, ownerName } = found
            const address = addressOfRow(row)
            return [
              {
                id: row.id as CompanyId,
                teamId: row.teamId as TeamId,
                name: row.name,
                domains: domains
                  .filter((domain) => domain.companyId === id)
                  .map((domain) => ({
                    domain: domain.domain as Company["domains"][number]["domain"],
                    isPrimary: domain.isPrimary,
                  })),
                website: row.website as Company["website"],
                phone: row.phone as Company["phone"],
                address,
                description: row.description,
                employees: row.employees,
                industry: row.industry,
                yearFounded: row.yearFounded,
                annualRevenue: row.annualRevenue,
                socialProfiles: row.socialProfiles,
                contactCount,
                custom: row.custom as Company["custom"],
                logoUrl: fileUrl(row.logoKey),
                ownerId: row.ownerId as UserId | null,
                ownerName: row.ownerId ? ownerName : null,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
                deletedAt: row.deletedAt?.toISOString() ?? null,
              },
            ]
          })
        })

      const loadOne = (teamId: TeamId, id: string) =>
        Effect.flatMap(load(teamId, [id]), ([company]) =>
          company ? Effect.succeed(company) : Effect.die(`company ${id} vanished inside a proven operation`),
        )

      /** Finds a company (other than `except`) already using one of `domains`. */
      const domainTaken = (teamName: DisplayName, teamId: TeamId, domains: ReadonlyArray<string>, except?: string) =>
        Effect.flatMap(
          run(
            db.query((d) =>
              d
                .select({
                  domain: schema.companyDomains.domain,
                  companyId: schema.companyDomains.companyId,
                  name: schema.companies.name,
                })
                .from(schema.companyDomains)
                .innerJoin(schema.companies, eq(schema.companies.id, schema.companyDomains.companyId))
                .where(
                  and(
                    eq(schema.companyDomains.teamId, teamId),
                    eq(schema.companyDomains.active, true),
                    inArray(schema.companyDomains.domain, [...domains]),
                    except ? ne(schema.companyDomains.companyId, except) : undefined,
                  ),
                )
                .limit(1),
            ),
          ),
          ([owner]) =>
            owner
              ? Effect.fail(
                  new CompanyDomainTaken({
                    team: teamName,
                    domain: EchoedInput.fromRequest(owner.domain),
                    existing: owner.companyId as CompanyId,
                    existingName: DisplayName.fromRecord(owner.name),
                  }),
                )
              : Effect.void,
        )

      /** Runs a write; a unique-domain race that slipped past the pre-check is reported the same way. */
      const write = <A>(
        teamName: DisplayName,
        teamId: TeamId,
        domains: ReadonlyArray<string>,
        except: string | undefined,
        effect: Effect.Effect<A, SqlError.SqlError>,
      ) =>
        db
          .transaction(effect)
          .pipe(
            Effect.catchTag("SqlError", (error) =>
              isUniqueViolation(error, DOMAINS_KEY)
                ? Effect.flatMap(domainTaken(teamName, teamId, domains, except), () => Effect.die(error))
                : classifySqlError(error),
            ),
          )

      const replaceDomains = (teamId: TeamId, companyId: string, domains: NormalizedFields["domains"]) =>
        domains === undefined
          ? Effect.void
          : Effect.gen(function* () {
              yield* db.query((d) =>
                d.delete(schema.companyDomains).where(eq(schema.companyDomains.companyId, companyId)),
              )
              if (domains.length === 0) return
              yield* db.query((d) =>
                d.insert(schema.companyDomains).values(
                  domains.map((entry, position) => ({
                    id: crypto.randomUUID(),
                    teamId,
                    companyId,
                    domain: entry.domain,
                    isPrimary: entry.isPrimary,
                    position,
                  })),
                ),
              )
            })

      const recordActivity = (
        principal: Principal,
        teamId: TeamId,
        companyId: string,
        kind: ActivityEntry["kind"],
        changedFields: ReadonlyArray<string>,
        /** When it happened, if not now: an imported record's original created date (D129). */
        at?: Date,
      ) =>
        db.query((d) =>
          d.insert(schema.activity).values({
            ...activityRow(principal, { teamId, recordType: "company", recordId: companyId, kind, changedFields }),
            ...(at ? { at } : {}),
          }),
        )

      const list = <P, T>(team: Named<T, TeamId>, query: CompanyQuery, _access: CanReadRecords<P, T>) =>
        Effect.gen(function* () {
          const limit = query.limit ?? 50
          const custom =
            query.filter || query.sort?.field.startsWith("custom:")
              ? yield* customFields.ofTeam(team.value, "company")
              : []
          const fields = query.filter
            ? yield* checkFilter("company", query.filter, custom)
            : filterFields("company", custom)
          const matching = and(
            eq(schema.companies.teamId, team.value),
            query.filter ? filterSql("company", query.filter, fields) : undefined,
            query.deleted ? restorableSql : isNull(schema.companies.deletedAt),
            searchSql(query.search),
          )
          // An offset, or a custom sort's cursor, pages by position; otherwise pages go by (updated, id).
          const byPosition = query.offset !== undefined || Boolean(query.sort)
          const offset = query.offset !== undefined ? Math.min(query.offset, MAX_OFFSET) : decodeOffset(query.cursor)
          const cursor = !byPosition && query.cursor ? decodeCursor(query.cursor) : undefined
          const [rows, total] = yield* Effect.all(
            [
              run(
                db.query((d) =>
                  d
                    .select({ id: schema.companies.id, updatedAt: schema.companies.updatedAt })
                    .from(schema.companies)
                    .where(
                      and(
                        matching,
                        cursor
                          ? sql`(${schema.companies.updatedAt}, ${schema.companies.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
                          : undefined,
                      ),
                    )
                    .orderBy(
                      ...(query.sort
                        ? [sortSql("company", query.sort, fields)]
                        : [desc(schema.companies.updatedAt), desc(schema.companies.id)]),
                    )
                    .limit(limit + 1)
                    .offset(offset),
                ),
              ),
              // Only the first page counts (D136): later pages would count the same again.
              query.cursor ? Effect.succeed(null) : count(matching),
            ],
            { concurrency: 2 },
          )
          const page = rows.slice(0, limit)
          const last = page[page.length - 1]
          const items = yield* load(
            team.value,
            page.map((row) => row.id),
          )
          const more = rows.length > limit && last !== undefined
          return {
            items,
            nextCursor: more
              ? byPosition
                ? encodeOffset(offset + limit)
                : encodeCursor(last.updatedAt, last.id)
              : null,
            total,
          }
        })

      const count = (where: SQL | undefined) =>
        Effect.map(
          run(db.query((d) => d.select({ count: sql<number>`count(*)::int` }).from(schema.companies).where(where))),
          ([row]) => row?.count ?? 0,
        )

      /** Live companies matching a search and filter, as the list would find them (D137). */
      const matchingWhere = (teamId: TeamId, matching: Matching) =>
        Effect.gen(function* () {
          const filter = matching.filter
          const filtered = filter
            ? filterSql(
                "company",
                filter,
                yield* checkFilter("company", filter, yield* customFields.ofTeam(teamId, "company")),
              )
            : undefined
          return (
            and(
              eq(schema.companies.teamId, teamId),
              isNull(schema.companies.deletedAt),
              filtered,
              searchSql(matching.search),
            ) ?? sql`false`
          )
        })

      const selection = <P, T>(team: Named<T, TeamId>, selected: Selection, _access: CanReadRecords<P, T>) => {
        if (!("ids" in selected)) {
          return Effect.map(
            matchingWhere(team.value, selected.matching),
            (where): CompanySelection<T> => ({ team, where }),
          )
        }
        // Ids that aren't uuids can't be companies; leaving them out keeps them away from the query.
        const ids = selected.ids.filter((id) => isUuid(id))
        const where =
          ids.length === 0
            ? sql`false`
            : (and(
                eq(schema.companies.teamId, team.value),
                isNull(schema.companies.deletedAt),
                inArray(schema.companies.id, ids),
              ) ?? sql`false`)
        return Effect.succeed<CompanySelection<T>>({ team, where })
      }

      const selectChunk = <T>(selected: CompanySelection<T>, after: CompanyId | undefined) =>
        Effect.map(
          run(
            db.query((d) =>
              d
                .select({ id: schema.companies.id })
                .from(schema.companies)
                .where(and(selected.where, after ? sql`${schema.companies.id} > ${after}::uuid` : undefined))
                .orderBy(asc(schema.companies.id))
                .limit(SELECTION_CHUNK),
            ),
          ),
          (rows) => rows.map((row) => row.id as CompanyId),
        )

      const updateMany = <P, T>(
        chunk: CompaniesInTeam<T>,
        change: { readonly custom?: CustomValuesPatch | undefined; readonly owner?: RecordOwnerChange<T> },
        access: CanWriteRecords<P, T>,
      ) =>
        Effect.gen(function* () {
          const teamId = chunk.team.value
          if (chunk.companyIds.length === 0) return 0
          const patch = change.custom ?? {}
          const patched = Object.keys(patch)
          // Checks the values as companies.update would; `values` then holds the ones being set.
          const applied = yield* customFields.apply(teamId, "company", {}, patch)
          const cleared = patched.filter((fieldId) => !(fieldId in applied.values))
          const nameOf = new Map(
            patched.length > 0
              ? (yield* customFields.ofTeam(teamId, "company")).map((field) => [field.id as string, field.name])
              : [],
          )
          const ownerId = change.owner === undefined ? undefined : (change.owner?.userId ?? null)
          const rows = yield* run(
            db.query((d) =>
              d
                .select({ id: schema.companies.id, custom: schema.companies.custom, ownerId: schema.companies.ownerId })
                .from(schema.companies)
                .where(
                  and(
                    eq(schema.companies.teamId, teamId),
                    inArray(schema.companies.id, [...chunk.companyIds]),
                    isNull(schema.companies.deletedAt),
                  ),
                ),
            ),
          )
          const changes = rows.flatMap((row) => {
            const current = row.custom as CustomValues
            const changed = [
              ...patched
                .filter((fieldId) =>
                  fieldId in applied.values
                    ? JSON.stringify(current[fieldId]) !== JSON.stringify(applied.values[fieldId])
                    : fieldId in current,
                )
                .map((fieldId) => nameOf.get(fieldId) ?? fieldId),
              ...(ownerId !== undefined && ownerId !== row.ownerId ? ["ownerId"] : []),
            ]
            return changed.length > 0 ? [{ id: row.id, changed }] : []
          })
          if (changes.length === 0) return rows.length
          const principal = access.member.principal.value
          const kept =
            cleared.length > 0
              ? sql`(${schema.companies.custom} - array[${sql.join(
                  cleared.map((fieldId) => sql`${fieldId}`),
                  sql`, `,
                )}]::text[])`
              : sql`${schema.companies.custom}`
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .update(schema.companies)
                    .set({
                      ...(patched.length > 0
                        ? { custom: sql`${kept} || ${JSON.stringify(applied.values)}::jsonb` }
                        : {}),
                      ...(ownerId !== undefined ? { ownerId } : {}),
                      updatedAt: sql`now()`,
                    })
                    .where(
                      and(
                        eq(schema.companies.teamId, teamId),
                        inArray(
                          schema.companies.id,
                          changes.map((entry) => entry.id),
                        ),
                      ),
                    ),
                )
                yield* db.query((d) =>
                  d.insert(schema.activity).values(
                    changes.map((entry) =>
                      activityRow(principal, {
                        teamId,
                        recordType: "company",
                        recordId: entry.id,
                        kind: "updated",
                        changedFields: entry.changed,
                      }),
                    ),
                  ),
                )
              }),
            ),
          )
          return rows.length
        }).pipe(Effect.withSpan("Companies.updateMany"))

      const deleteMany = <P, T>(chunk: CompaniesInTeam<T>, deletedAt: Date, access: CanDeleteRecords<P, T>) =>
        Effect.gen(function* () {
          const teamId = chunk.team.value
          if (chunk.companyIds.length === 0) return 0
          const principal = access.member.principal.value
          return yield* run(
            db.transaction(
              Effect.gen(function* () {
                const deleted = yield* db.query((d) =>
                  d
                    .update(schema.companies)
                    .set({ deletedAt, updatedAt: sql`now()` })
                    .where(
                      and(
                        eq(schema.companies.teamId, teamId),
                        inArray(schema.companies.id, [...chunk.companyIds]),
                        isNull(schema.companies.deletedAt),
                      ),
                    )
                    .returning({ id: schema.companies.id }),
                )
                if (deleted.length === 0) return 0
                const ids = deleted.map((row) => row.id)
                yield* db.query((d) =>
                  d
                    .update(schema.companyDomains)
                    .set({ active: false })
                    .where(inArray(schema.companyDomains.companyId, ids)),
                )
                yield* db.query((d) =>
                  d.insert(schema.activity).values(
                    ids.map((id) =>
                      activityRow(principal, {
                        teamId,
                        recordType: "company",
                        recordId: id,
                        kind: "deleted",
                        changedFields: [],
                      }),
                    ),
                  ),
                )
                return deleted.length
              }),
            ),
          )
        }).pipe(Effect.withSpan("Companies.deleteMany"))

      const restoreMany = <P, T>(team: Named<T, TeamId>, deletedAt: Date, access: CanDeleteRecords<P, T>) =>
        Effect.gen(function* () {
          const teamId = team.value
          const principal = access.member.principal.value
          let restored = 0
          let after: string | undefined
          for (;;) {
            const chunk = yield* run(
              db.query((d) =>
                d
                  .select({ id: schema.companies.id })
                  .from(schema.companies)
                  .where(
                    and(
                      eq(schema.companies.teamId, teamId),
                      eq(schema.companies.deletedAt, deletedAt),
                      restorableSql,
                      after ? sql`${schema.companies.id} > ${after}::uuid` : undefined,
                    ),
                  )
                  .orderBy(asc(schema.companies.id))
                  .limit(SELECTION_CHUNK),
              ),
            )
            const last = chunk[chunk.length - 1]
            if (!last) return restored
            after = last.id
            const ids = chunk.map((row) => row.id)
            // A company whose domain another company has taken since stays deleted, as companies.restore refuses it.
            const blocked = yield* run(
              db.query((d) =>
                d
                  .selectDistinct({ companyId: schema.companyDomains.companyId })
                  .from(schema.companyDomains)
                  .where(
                    and(
                      inArray(schema.companyDomains.companyId, ids),
                      sql`exists (select 1 from ${schema.companyDomains} taken where taken.team_id = ${teamId} and taken.active and taken.domain = ${schema.companyDomains.domain})`,
                    ),
                  ),
              ),
            )
            const skip = new Set(blocked.map((row) => row.companyId))
            const restorable = ids.filter((id) => !skip.has(id))
            if (restorable.length > 0) {
              yield* run(
                db.transaction(
                  Effect.gen(function* () {
                    yield* db.query((d) =>
                      d
                        .update(schema.companies)
                        .set({ deletedAt: null, updatedAt: sql`now()` })
                        .where(and(eq(schema.companies.teamId, teamId), inArray(schema.companies.id, restorable))),
                    )
                    yield* db.query((d) =>
                      d
                        .update(schema.companyDomains)
                        .set({ active: true })
                        .where(inArray(schema.companyDomains.companyId, restorable)),
                    )
                    yield* db.query((d) =>
                      d.insert(schema.activity).values(
                        restorable.map((id) =>
                          activityRow(principal, {
                            teamId,
                            recordType: "company",
                            recordId: id,
                            kind: "restored",
                            changedFields: [],
                          }),
                        ),
                      ),
                    )
                  }),
                ),
              )
            }
            restored += restorable.length
            if (chunk.length < SELECTION_CHUNK) return restored
          }
        }).pipe(Effect.withSpan("Companies.restoreMany"))

      const locate = <P, T>(
        team: Named<T, TeamId>,
        companyId: CompanyId,
        state: CompanyState,
        _access: CanReadRecords<P, T>,
      ) =>
        Effect.map(
          run(
            db.query((d) =>
              d
                .select({ id: schema.companies.id, deletedAt: schema.companies.deletedAt })
                .from(schema.companies)
                .where(
                  and(
                    eq(schema.companies.teamId, team.value),
                    sql`${schema.companies.id}::text = ${companyId}`,
                    state === "live"
                      ? isNull(schema.companies.deletedAt)
                      : or(
                          isNull(schema.companies.deletedAt),
                          sql`${schema.companies.deletedAt} > now() - make_interval(days => ${RESTORE_WINDOW_DAYS})`,
                        ),
                  ),
                )
                .limit(1),
            ),
          ),
          ([row]): LocatedCompany | undefined =>
            row ? { id: row.id as CompanyId, deleted: row.deletedAt !== null } : undefined,
        )

      const get = <K, T>(target: CompanyInTeam<K, T>) => loadOne(target.team.value, target.company.value)

      const create = <P, T>(
        team: Named<T, TeamId>,
        fields: CompanyFields & { readonly name: string },
        access: CanWriteRecords<P, T>,
        owner?: RecordOwnerChange<T>,
        imported?: { readonly createdAt?: Date | undefined },
      ) =>
        Effect.gen(function* () {
          const normalized = yield* normalize(fields)
          const createdAt = imported?.createdAt
          const custom = fields.custom
            ? yield* customFields.apply(team.value, "company", {}, fields.custom)
            : { values: {}, changed: [] }
          const domains = normalized.domains?.map((entry) => entry.domain) ?? []
          if (domains.length > 0) yield* domainTaken(access.member.teamName, team.value, domains)
          const id = crypto.randomUUID()
          const principal = access.member.principal.value
          yield* write(
            access.member.teamName,
            team.value,
            domains,
            id,
            Effect.gen(function* () {
              yield* db.query((d) =>
                d.insert(schema.companies).values({
                  id,
                  teamId: team.value,
                  name: fields.name,
                  website: normalized.website ?? null,
                  phone: normalized.phone ?? null,
                  ...addressColumns(normalized.address ?? null),
                  ...profileColumns(normalized),
                  custom: custom.values,
                  ...(owner ? { ownerId: owner.userId } : {}),
                  ...(createdAt ? { createdAt } : {}),
                }),
              )
              yield* replaceDomains(team.value, id, normalized.domains)
              yield* recordActivity(
                principal,
                team.value,
                id,
                "created",
                [...Object.keys(normalized), ...custom.changed, ...(owner ? ["ownerId"] : [])],
                createdAt,
              )
              yield* affiliations.matchCompany(principal, team.value, { id, name: fields.name }, domains)
            }),
          )
          yield* refreshFavicon(team.value, id, domains[0])
          return yield* loadOne(team.value, id)
        }).pipe(Effect.withSpan("Companies.create"))

      const update = <P, T, K>(
        target: CompanyInTeam<K, T>,
        fields: CompanyFields,
        access: CanWriteRecords<P, T>,
        owner?: RecordOwnerChange<T>,
      ) =>
        Effect.gen(function* () {
          const normalized = yield* normalize(fields)
          const teamId = target.team.value
          const id = target.company.value
          const domains = normalized.domains?.map((entry) => entry.domain) ?? []
          if (domains.length > 0) yield* domainTaken(target.teamName, teamId, domains, id)
          const current = yield* loadOne(teamId, id)
          const custom = fields.custom
            ? yield* customFields.apply(teamId, "company", current.custom, fields.custom)
            : undefined
          const ownerId = owner === undefined ? undefined : (owner?.userId ?? null)
          const ownerChanged = ownerId !== undefined && ownerId !== current.ownerId
          const changed = [...Object.keys(normalized), ...(custom?.changed ?? []), ...(ownerChanged ? ["ownerId"] : [])]
          if (changed.length > 0) {
            const before = new Set(current.domains.map((entry) => entry.domain as string))
            const added = domains.filter((domain) => !before.has(domain))
            const principal = access.member.principal.value
            yield* write(
              target.teamName,
              teamId,
              domains,
              id,
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .update(schema.companies)
                    .set({
                      ...(normalized.name !== undefined ? { name: normalized.name } : {}),
                      ...("website" in normalized ? { website: normalized.website ?? null } : {}),
                      ...("phone" in normalized ? { phone: normalized.phone ?? null } : {}),
                      ...("address" in normalized ? addressColumns(normalized.address ?? null) : {}),
                      ...profileColumns(normalized),
                      ...(custom ? { custom: custom.values } : {}),
                      ...(ownerChanged ? { ownerId } : {}),
                      updatedAt: sql`now()`,
                    })
                    .where(and(eq(schema.companies.teamId, teamId), eq(schema.companies.id, id))),
                )
                yield* replaceDomains(teamId, id, normalized.domains)
                yield* recordActivity(principal, teamId, id, "updated", changed)
                // Only newly added domains match; removed affiliations stay removed (D107).
                yield* affiliations.matchCompany(
                  principal,
                  teamId,
                  { id, name: normalized.name ?? current.name },
                  added,
                )
              }),
            )
          }
          const updated = yield* loadOne(teamId, id)
          // A new primary domain may have a different icon; uploads are left alone.
          const primary = updated.domains.find((entry) => entry.isPrimary)?.domain
          if (normalized.domains && primary !== current.domains.find((entry) => entry.isPrimary)?.domain) {
            yield* refreshFavicon(teamId, id, primary)
          }
          return updated
        }).pipe(Effect.withSpan("Companies.update"))

      const remove = <P, T, K>(target: CompanyInTeam<K, T>, access: CanDeleteRecords<P, T>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const id = target.company.value
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .update(schema.companies)
                    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
                    .where(and(eq(schema.companies.teamId, teamId), eq(schema.companies.id, id))),
                )
                yield* db.query((d) =>
                  d.update(schema.companyDomains).set({ active: false }).where(eq(schema.companyDomains.companyId, id)),
                )
                yield* recordActivity(access.member.principal.value, teamId, id, "deleted", [])
              }),
            ),
          )
          return yield* loadOne(teamId, id)
        }).pipe(Effect.withSpan("Companies.delete"))

      const restore = <P, T, K>(target: CompanyRestorable<K, T>, access: CanDeleteRecords<P, T>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const id = target.company.value
          const current = yield* loadOne(teamId, id)
          if (current.deletedAt === null) return current
          const domains = current.domains.map((entry) => entry.domain as string)
          if (domains.length > 0) yield* domainTaken(target.teamName, teamId, domains, id)
          // Restoring isn't adding a domain, so no domain matching runs (D107); its affiliations come back (D109).
          yield* write(
            target.teamName,
            teamId,
            domains,
            id,
            Effect.gen(function* () {
              yield* db.query((d) =>
                d
                  .update(schema.companies)
                  .set({ deletedAt: null, updatedAt: sql`now()` })
                  .where(and(eq(schema.companies.teamId, teamId), eq(schema.companies.id, id))),
              )
              yield* db.query((d) =>
                d.update(schema.companyDomains).set({ active: true }).where(eq(schema.companyDomains.companyId, id)),
              )
              yield* recordActivity(access.member.principal.value, teamId, id, "restored", [])
            }),
          )
          return yield* loadOne(teamId, id)
        }).pipe(Effect.withSpan("Companies.restore"))

      const activity = <K, T>(target: CompanyInTeam<K, T>) =>
        Effect.map(
          run(
            db.query((d) =>
              d
                .select()
                .from(schema.activity)
                .where(
                  and(
                    eq(schema.activity.teamId, target.team.value),
                    eq(schema.activity.recordType, "company"),
                    eq(schema.activity.recordId, target.company.value),
                  ),
                )
                .orderBy(asc(schema.activity.at)),
            ),
          ),
          (rows) => rows.map(toActivityEntry),
        )

      const setLogo = <P, T, K>(target: CompanyInTeam<K, T>, image: Uint8Array | null, access: CanWriteRecords<P, T>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const id = target.company.value
          yield* storeLogo(teamId, id, image, image ? "upload" : null)
          yield* run(
            db.query((d) =>
              d.insert(schema.activity).values(
                activityRow(access.member.principal.value, {
                  teamId,
                  recordType: "company",
                  recordId: id,
                  kind: "updated",
                  changedFields: ["logo"],
                }),
              ),
            ),
          )
          const company = yield* loadOne(teamId, id)
          if (!image) yield* refreshFavicon(teamId, id, company.domains.find((entry) => entry.isPrimary)?.domain)
          return company
        }).pipe(Effect.withSpan("Companies.setLogo"))

      const matchKeys = <P, T>(
        team: Named<T, TeamId>,
        keys: { readonly domains: ReadonlyArray<string>; readonly names: ReadonlyArray<string> },
        _access: CanReadRecords<P, T>,
      ) =>
        Effect.gen(function* () {
          const domains =
            keys.domains.length === 0
              ? []
              : yield* run(
                  db.query((d) =>
                    d
                      .select({ domain: schema.companyDomains.domain, companyId: schema.companyDomains.companyId })
                      .from(schema.companyDomains)
                      .where(
                        and(
                          eq(schema.companyDomains.teamId, team.value),
                          inArray(schema.companyDomains.domain, [...keys.domains]),
                          eq(schema.companyDomains.active, true),
                        ),
                      ),
                  ),
                )
          const lowered = [...new Set(keys.names.map((name) => name.toLowerCase()))]
          const names =
            lowered.length === 0
              ? []
              : yield* run(
                  db.query((d) =>
                    d
                      .select({ name: sql<string>`lower(${schema.companies.name})`, id: schema.companies.id })
                      .from(schema.companies)
                      .where(
                        and(
                          eq(schema.companies.teamId, team.value),
                          inArray(sql`lower(${schema.companies.name})`, lowered),
                          isNull(schema.companies.deletedAt),
                        ),
                      )
                      .orderBy(desc(schema.companies.createdAt)),
                  ),
                )
          return {
            byDomain: new Map(domains.map((row) => [row.domain, row.companyId as CompanyId])),
            // Oldest last, so it wins.
            byName: new Map(names.map((row) => [row.name, row.id as CompanyId])),
          }
        })

      return {
        list,
        selection,
        selectChunk,
        updateMany,
        deleteMany,
        restoreMany,
        matchKeys,
        locate,
        get,
        create,
        update,
        delete: remove,
        restore,
        activity,
        setLogo,
      }
    }),
  )
}
