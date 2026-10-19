import { Database, schema } from "@parley/db"
import {
  type ActivityEntry,
  type Company,
  CompanyDomainTaken,
  type CompanyFields,
  type CompanyId,
  type CompanyPage,
  type DatabaseUnavailable,
  type FieldProblem,
  FreeEmailDomain,
  InputRejected,
  isFreeEmailDomain,
  normalizeDomain,
  type PostalAddress,
  type TeamId,
} from "@parley/domain"
import { DisplayName, EchoedInput, userText } from "@parley/errors"
import { and, asc, desc, eq, exists, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { Principal } from "../principal.ts"
import type { CompanyInTeam, CompanyRestorable } from "../proofs/company-in-team.ts"
import type { CanDeleteRecords, CanReadRecords, CanWriteRecords } from "../proofs/permissions.ts"
import type { Named } from "../proofs/proof.ts"
import { activityRow, toActivityEntry } from "./activity.ts"
import { Affiliations } from "./affiliations.ts"
import { RESTORE_WINDOW_DAYS } from "./contacts.ts"
import { CustomFields } from "./custom-fields.ts"
import { classifySqlError, isUniqueViolation } from "./sql-errors.ts"

export interface CompanyQuery {
  readonly search?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  readonly deleted?: boolean | undefined
}

/** Which companies a lookup may find: live ones, or deleted ones still inside the restore window. */
export type CompanyState = "live" | "restorable"

/** A company the CompanyInTeam prover found. Only provers turn this into a proof. */
export interface LocatedCompany {
  readonly id: CompanyId
  readonly deleted: boolean
}

const DOMAINS_KEY = "company_domains_team_id_domain_key"

const encodeCursor = (updatedAt: Date, id: string) => btoa(`${updatedAt.toISOString()}|${id}`)
const decodeCursor = (cursor: string): { readonly updatedAt: Date; readonly id: string } | undefined => {
  try {
    const [iso, id] = atob(cursor).split("|")
    const updatedAt = new Date(iso ?? "")
    return id && !Number.isNaN(updatedAt.getTime()) ? { updatedAt, id } : undefined
  } catch {
    return undefined
  }
}

interface NormalizedFields {
  readonly name?: string
  readonly domains?: ReadonlyArray<{ readonly domain: string; readonly isPrimary: boolean }>
  readonly website?: string | null
  readonly phone?: string | null
  readonly address?: PostalAddress | null
}

const ADDRESS_KEYS = ["line1", "line2", "city", "region", "postcode", "country"] as const

/** An address with nothing in it is no address. */
const normalizeAddress = (address: PostalAddress | null): PostalAddress | null =>
  address && ADDRESS_KEYS.some((key) => address[key]) ? address : null

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
  })
}

const addressColumns = (address: PostalAddress | null) => ({
  addressLine1: address?.line1 ?? null,
  addressLine2: address?.line2 ?? null,
  city: address?.city ?? null,
  region: address?.region ?? null,
  postcode: address?.postcode ?? null,
  country: address?.country ?? null,
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
    ) => Effect.Effect<CompanyPage, DatabaseUnavailable>
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
    ) => Effect.Effect<Company, InputRejected | FreeEmailDomain | CompanyDomainTaken | DatabaseUnavailable>
    readonly update: <P, T, K>(
      target: CompanyInTeam<K, T>,
      fields: CompanyFields,
      access: CanWriteRecords<P, T>,
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
  }
>()("@parley/core/Companies") {
  static readonly layer = Layer.effect(
    Companies,
    Effect.gen(function* () {
      const db = yield* Database
      const affiliations = yield* Affiliations
      const customFields = yield* CustomFields
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      /** Loads full companies, with domains and contact counts, in the order of `ids`. */
      const load = (teamId: TeamId, ids: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (ids.length === 0) return []
          const [rows, domains] = yield* Effect.all([
            run(
              db.query((d) =>
                d
                  .select({ company: schema.companies, contactCount: contactCountSql })
                  .from(schema.companies)
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
            const { company: row, contactCount } = found
            const address = normalizeAddress({
              line1: row.addressLine1,
              line2: row.addressLine2,
              city: row.city,
              region: row.region,
              postcode: row.postcode,
              country: row.country,
            })
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
                contactCount,
                custom: row.custom as Company["custom"],
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
      ) =>
        db.query((d) =>
          d
            .insert(schema.activity)
            .values(
              activityRow(principal, { teamId, recordType: "company", recordId: companyId, kind, changedFields }),
            ),
        )

      const list = <P, T>(team: Named<T, TeamId>, query: CompanyQuery, _access: CanReadRecords<P, T>) =>
        Effect.gen(function* () {
          const limit = query.limit ?? 50
          const cursor = query.cursor ? decodeCursor(query.cursor) : undefined
          const search = query.search?.trim()
          const pattern = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined
          const rows = yield* run(
            db.query((d) =>
              d
                .select({ id: schema.companies.id, updatedAt: schema.companies.updatedAt })
                .from(schema.companies)
                .where(
                  and(
                    eq(schema.companies.teamId, team.value),
                    query.deleted
                      ? and(
                          isNotNull(schema.companies.deletedAt),
                          sql`${schema.companies.deletedAt} > now() - make_interval(days => ${RESTORE_WINDOW_DAYS})`,
                        )
                      : isNull(schema.companies.deletedAt),
                    cursor
                      ? sql`(${schema.companies.updatedAt}, ${schema.companies.id}) < (${cursor.updatedAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
                      : undefined,
                    pattern
                      ? or(
                          ilike(schema.companies.name, pattern),
                          exists(
                            d
                              .select({ one: sql`1` })
                              .from(schema.companyDomains)
                              .where(
                                and(
                                  eq(schema.companyDomains.companyId, schema.companies.id),
                                  ilike(schema.companyDomains.domain, pattern),
                                ),
                              ),
                          ),
                        )
                      : undefined,
                  ),
                )
                .orderBy(desc(schema.companies.updatedAt), desc(schema.companies.id))
                .limit(limit + 1),
            ),
          )
          const page = rows.slice(0, limit)
          const last = page[page.length - 1]
          const items = yield* load(
            team.value,
            page.map((row) => row.id),
          )
          return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null }
        })

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
      ) =>
        Effect.gen(function* () {
          const normalized = yield* normalize(fields)
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
                  custom: custom.values,
                }),
              )
              yield* replaceDomains(team.value, id, normalized.domains)
              yield* recordActivity(principal, team.value, id, "created", [
                ...Object.keys(normalized),
                ...custom.changed,
              ])
              yield* affiliations.matchCompany(principal, team.value, { id, name: fields.name }, domains)
            }),
          )
          return yield* loadOne(team.value, id)
        }).pipe(Effect.withSpan("Companies.create"))

      const update = <P, T, K>(target: CompanyInTeam<K, T>, fields: CompanyFields, access: CanWriteRecords<P, T>) =>
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
          const changed = [...Object.keys(normalized), ...(custom?.changed ?? [])]
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
                      ...(custom ? { custom: custom.values } : {}),
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
          return yield* loadOne(teamId, id)
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

      return { list, locate, get, create, update, delete: remove, restore, activity }
    }),
  )
}
