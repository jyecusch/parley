import { Database, schema } from "@parley/db"
import {
  type Affiliation,
  type AffiliationId,
  type CompanyId,
  type ContactAffiliation,
  type ContactId,
  type DatabaseUnavailable,
  domainOfEmail,
  isFreeEmailDomain,
  type TeamId,
} from "@parley/domain"
import { and, asc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { Principal } from "../principal.ts"
import type { AffiliationInTeam } from "../proofs/affiliation-in-team.ts"
import type { CompanyInTeam } from "../proofs/company-in-team.ts"
import type { ContactInTeam, ContactsInTeam } from "../proofs/contact-in-team.ts"
import type { CanReadRecords, CanWriteRecords } from "../proofs/permissions.ts"
import type { Named } from "../proofs/proof.ts"
import { activityRow } from "./activity.ts"
import { classifySqlError } from "./sql-errors.ts"

/** A record named as it is now, for activity on the other side of an affiliation. */
export interface RecordRef {
  readonly id: string
  readonly name: string
}

/** A contact's display name in SQL: first and last name, else the primary email (D33). */
export const contactNameSql: SQL<string> = sql<string>`coalesce(
  nullif(trim(concat_ws(' ', "contacts"."first_name", "contacts"."last_name")), ''),
  (select e.address from "contact_emails" e where e.contact_id = "contacts"."id"
    order by e.is_primary desc, e.position limit 1),
  'Unnamed contact'
)`

const bothLive = and(isNull(schema.contacts.deletedAt), isNull(schema.companies.deletedAt))

/**
 * Affiliations between contacts and companies (D29), and domain matching (D105). An affiliation is
 * hidden while its contact or company is deleted (D109), so every read joins both and checks.
 */
export class Affiliations extends Context.Service<
  Affiliations,
  {
    /** The live companies of each contact, for loading contacts. */
    readonly forContacts: (
      teamId: TeamId,
      contactIds: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyMap<string, ReadonlyArray<ContactAffiliation>>, DatabaseUnavailable>
    readonly listForCompany: <K, T>(
      company: CompanyInTeam<K, T>,
    ) => Effect.Effect<ReadonlyArray<Affiliation>, DatabaseUnavailable>
    /** Used only by the AffiliationInTeam prover. */
    readonly locate: <P, T>(
      team: Named<T, TeamId>,
      affiliationId: AffiliationId,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<Affiliation | undefined, DatabaseUnavailable>
    readonly create: <P, T, C, K>(
      contact: ContactInTeam<C, T>,
      company: CompanyInTeam<K, T>,
      title: string | null | undefined,
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<Affiliation, DatabaseUnavailable>
    /**
     * Affiliates many contacts with one company (D137), as create does for each: already affiliated
     * ones keep their affiliation, with `title` replacing theirs if given. Returns how many contacts.
     */
    readonly createMany: <P, T, K>(
      contacts: ContactsInTeam<T>,
      company: CompanyInTeam<K, T>,
      title: string | null | undefined,
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<number, DatabaseUnavailable>
    readonly update: <P, T, A>(
      target: AffiliationInTeam<A, T>,
      title: string | null,
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<Affiliation, DatabaseUnavailable>
    readonly delete: <P, T, A>(
      target: AffiliationInTeam<A, T>,
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<Affiliation, DatabaseUnavailable>
    /**
     * Domain matching for a contact's newly added email addresses. Runs inside the caller's write,
     * which already holds the proof that the principal may write records in this team.
     */
    readonly matchContact: (
      principal: Principal,
      teamId: TeamId,
      contact: RecordRef,
      addedAddresses: ReadonlyArray<string>,
    ) => Effect.Effect<void, SqlError.SqlError>
    /** Domain matching for a company's newly added domains. Runs inside the caller's write, likewise. */
    readonly matchCompany: (
      principal: Principal,
      teamId: TeamId,
      company: RecordRef,
      addedDomains: ReadonlyArray<string>,
    ) => Effect.Effect<void, SqlError.SqlError>
  }
>()("@parley/core/Affiliations") {
  static readonly layer = Layer.effect(
    Affiliations,
    Effect.gen(function* () {
      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      /** Live affiliations matching `where`, oldest first. */
      const select = (where: SQL | undefined) =>
        db.query((d) =>
          d
            .select({
              id: schema.affiliations.id,
              contactId: schema.affiliations.contactId,
              contactName: contactNameSql,
              companyId: schema.affiliations.companyId,
              companyName: schema.companies.name,
              title: schema.affiliations.title,
              createdAt: schema.affiliations.createdAt,
            })
            .from(schema.affiliations)
            .innerJoin(schema.contacts, eq(schema.contacts.id, schema.affiliations.contactId))
            .innerJoin(schema.companies, eq(schema.companies.id, schema.affiliations.companyId))
            .where(and(bothLive, where))
            .orderBy(asc(schema.affiliations.createdAt), asc(schema.affiliations.id)),
        )

      const summarize = (row: {
        readonly id: string
        readonly contactId: string
        readonly contactName: string
        readonly companyId: string
        readonly companyName: string
        readonly title: string | null
        readonly createdAt: Date
      }): Affiliation => ({
        id: row.id as AffiliationId,
        contactId: row.contactId as ContactId,
        contactName: row.contactName,
        companyId: row.companyId as CompanyId,
        companyName: row.companyName,
        title: row.title,
        createdAt: row.createdAt.toISOString(),
      })

      const byId = (teamId: TeamId, id: string) =>
        Effect.flatMap(
          run(select(and(eq(schema.affiliations.teamId, teamId), sql`${schema.affiliations.id}::text = ${id}`))),
          ([row]) => (row ? Effect.succeed(summarize(row)) : Effect.die(`affiliation ${id} vanished`)),
        )

      /** Activity on both records: the contact names the company, and the company names the contact. */
      const recordBoth = (
        principal: Principal,
        teamId: TeamId,
        contact: RecordRef,
        company: RecordRef,
        entry: {
          readonly kind: "affiliated" | "unaffiliated" | "updated"
          readonly changedFields?: ReadonlyArray<string>
          readonly reason?: "domain-matching"
          readonly matchedDomain?: string
        },
      ) =>
        db.query((d) =>
          d.insert(schema.activity).values([
            activityRow(principal, {
              teamId,
              recordType: "contact",
              recordId: contact.id,
              ...entry,
              related: { recordType: "company", ...company },
            }),
            activityRow(principal, {
              teamId,
              recordType: "company",
              recordId: company.id,
              ...entry,
              related: { recordType: "contact", ...contact },
            }),
          ]),
        )

      const forContacts = (teamId: TeamId, contactIds: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const result = new Map<string, Array<ContactAffiliation>>()
          if (contactIds.length === 0) return result
          const rows = yield* run(
            select(
              and(eq(schema.affiliations.teamId, teamId), inArray(schema.affiliations.contactId, [...contactIds])),
            ),
          )
          for (const row of rows) {
            const list = result.get(row.contactId) ?? []
            list.push({
              id: row.id as AffiliationId,
              companyId: row.companyId as CompanyId,
              companyName: row.companyName,
              title: row.title,
            })
            result.set(row.contactId, list)
          }
          return result
        })

      const listForCompany = <K, T>(company: CompanyInTeam<K, T>) =>
        Effect.map(
          run(
            select(
              and(
                eq(schema.affiliations.teamId, company.team.value),
                eq(schema.affiliations.companyId, company.company.value),
              ),
            ),
          ),
          (rows) => rows.map(summarize),
        ).pipe(Effect.withSpan("Affiliations.listForCompany"))

      const locate = <P, T>(team: Named<T, TeamId>, affiliationId: AffiliationId, _access: CanReadRecords<P, T>) =>
        Effect.map(
          run(
            select(
              and(eq(schema.affiliations.teamId, team.value), sql`${schema.affiliations.id}::text = ${affiliationId}`),
            ),
          ),
          ([row]) => (row ? summarize(row) : undefined),
        )

      const create = <P, T, C, K>(
        contact: ContactInTeam<C, T>,
        company: CompanyInTeam<K, T>,
        title: string | null | undefined,
        access: CanWriteRecords<P, T>,
      ) =>
        Effect.gen(function* () {
          const teamId = contact.team.value
          const principal = access.member.principal.value
          const id = yield* run(
            db.transaction(
              Effect.gen(function* () {
                const inserted = yield* db.query((d) =>
                  d
                    .insert(schema.affiliations)
                    .values({
                      id: crypto.randomUUID(),
                      teamId,
                      contactId: contact.contact.value,
                      companyId: company.company.value,
                      title: title ?? null,
                    })
                    .onConflictDoNothing({ target: [schema.affiliations.contactId, schema.affiliations.companyId] })
                    .returning({ id: schema.affiliations.id }),
                )
                const [existing] = yield* select(
                  and(
                    eq(schema.affiliations.contactId, contact.contact.value),
                    eq(schema.affiliations.companyId, company.company.value),
                  ),
                )
                if (!existing) return yield* Effect.die("affiliation missing right after upsert")
                const contactRef = { id: existing.contactId, name: existing.contactName }
                const companyRef = { id: existing.companyId, name: existing.companyName }
                if (inserted.length > 0) {
                  yield* recordBoth(principal, teamId, contactRef, companyRef, {
                    kind: "affiliated",
                    ...(title ? { changedFields: ["title"] } : {}),
                  })
                } else if (title !== undefined && title !== existing.title) {
                  // Already affiliated: idempotent, but a given title replaces the old one (D43).
                  yield* db.query((d) =>
                    d.update(schema.affiliations).set({ title }).where(eq(schema.affiliations.id, existing.id)),
                  )
                  yield* recordBoth(principal, teamId, contactRef, companyRef, {
                    kind: "updated",
                    changedFields: ["title"],
                  })
                }
                return existing.id
              }),
            ),
          )
          return yield* byId(teamId, id)
        }).pipe(Effect.withSpan("Affiliations.create"))

      const createMany = <P, T, K>(
        contacts: ContactsInTeam<T>,
        company: CompanyInTeam<K, T>,
        title: string | null | undefined,
        access: CanWriteRecords<P, T>,
      ) =>
        Effect.gen(function* () {
          const teamId = contacts.team.value
          const companyId = company.company.value
          const contactIds = [...contacts.contactIds]
          if (contactIds.length === 0) return 0
          const principal = access.member.principal.value
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                const inserted = yield* db.query((d) =>
                  d
                    .insert(schema.affiliations)
                    .values(
                      contactIds.map((contactId) => ({
                        id: crypto.randomUUID(),
                        teamId,
                        contactId,
                        companyId,
                        title: title ?? null,
                      })),
                    )
                    .onConflictDoNothing({ target: [schema.affiliations.contactId, schema.affiliations.companyId] })
                    .returning({ contactId: schema.affiliations.contactId }),
                )
                const added = new Set(inserted.map((row) => row.contactId))
                // Already affiliated: a given title replaces the old one (D43).
                const retitled =
                  title === undefined
                    ? []
                    : yield* db.query((d) =>
                        d
                          .update(schema.affiliations)
                          .set({ title })
                          .where(
                            and(
                              eq(schema.affiliations.companyId, companyId),
                              inArray(
                                schema.affiliations.contactId,
                                contactIds.filter((id) => !added.has(id)),
                              ),
                              sql`${schema.affiliations.title} is distinct from ${title}`,
                            ),
                          )
                          .returning({ contactId: schema.affiliations.contactId }),
                      )
                const changed = [...added, ...retitled.map((row) => row.contactId)]
                if (changed.length === 0) return
                const [names, [companyRow]] = yield* Effect.all([
                  db.query((d) =>
                    d
                      .select({ id: schema.contacts.id, name: contactNameSql })
                      .from(schema.contacts)
                      .where(inArray(schema.contacts.id, changed)),
                  ),
                  db.query((d) =>
                    d
                      .select({ name: schema.companies.name })
                      .from(schema.companies)
                      .where(eq(schema.companies.id, companyId)),
                  ),
                ])
                const companyRef = { id: companyId, name: companyRow?.name ?? "" }
                yield* db.query((d) =>
                  d.insert(schema.activity).values(
                    names.flatMap((contact) => {
                      const entry = added.has(contact.id)
                        ? { kind: "affiliated" as const, ...(title ? { changedFields: ["title"] } : {}) }
                        : { kind: "updated" as const, changedFields: ["title"] }
                      return [
                        activityRow(principal, {
                          teamId,
                          recordType: "contact",
                          recordId: contact.id,
                          ...entry,
                          related: { recordType: "company", ...companyRef },
                        }),
                        activityRow(principal, {
                          teamId,
                          recordType: "company",
                          recordId: companyId,
                          ...entry,
                          related: { recordType: "contact", id: contact.id, name: contact.name },
                        }),
                      ]
                    }),
                  ),
                )
              }),
            ),
          )
          return contactIds.length
        }).pipe(Effect.withSpan("Affiliations.createMany"))

      const update = <P, T, A>(target: AffiliationInTeam<A, T>, title: string | null, access: CanWriteRecords<P, T>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const found = target.found
          if (found.title !== title) {
            yield* run(
              db.transaction(
                Effect.gen(function* () {
                  yield* db.query((d) =>
                    d.update(schema.affiliations).set({ title }).where(eq(schema.affiliations.id, found.id)),
                  )
                  yield* recordBoth(
                    access.member.principal.value,
                    teamId,
                    { id: found.contactId, name: found.contactName },
                    { id: found.companyId, name: found.companyName },
                    { kind: "updated", changedFields: ["title"] },
                  )
                }),
              ),
            )
          }
          return yield* byId(teamId, found.id)
        }).pipe(Effect.withSpan("Affiliations.update"))

      const remove = <P, T, A>(target: AffiliationInTeam<A, T>, access: CanWriteRecords<P, T>) =>
        Effect.gen(function* () {
          const found = target.found
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) => d.delete(schema.affiliations).where(eq(schema.affiliations.id, found.id)))
                yield* recordBoth(
                  access.member.principal.value,
                  target.team.value,
                  { id: found.contactId, name: found.contactName },
                  { id: found.companyId, name: found.companyName },
                  { kind: "unaffiliated" },
                )
              }),
            ),
          )
          return found
        }).pipe(Effect.withSpan("Affiliations.delete"))

      /** Affiliates each pair that isn't already, and records it as domain matching. */
      const affiliateMatches = (
        principal: Principal,
        teamId: TeamId,
        pairs: ReadonlyArray<{ readonly contact: RecordRef; readonly company: RecordRef; readonly domain: string }>,
      ) =>
        Effect.forEach(
          pairs,
          ({ contact, company, domain }) =>
            Effect.gen(function* () {
              const inserted = yield* db.query((d) =>
                d
                  .insert(schema.affiliations)
                  .values({ id: crypto.randomUUID(), teamId, contactId: contact.id, companyId: company.id })
                  .onConflictDoNothing({ target: [schema.affiliations.contactId, schema.affiliations.companyId] })
                  .returning({ id: schema.affiliations.id }),
              )
              if (inserted.length === 0) return
              yield* recordBoth(principal, teamId, contact, company, {
                kind: "affiliated",
                reason: "domain-matching",
                matchedDomain: domain,
              })
            }),
          { discard: true },
        )

      /** Free email domains never belong to a company, so they're skipped before asking (D106). */
      const matchable = (domains: Iterable<string>) =>
        [...new Set(domains)].filter((domain) => !isFreeEmailDomain(domain))

      const matchContact = (
        principal: Principal,
        teamId: TeamId,
        contact: RecordRef,
        addedAddresses: ReadonlyArray<string>,
      ) =>
        Effect.gen(function* () {
          const domains = matchable(addedAddresses.map(domainOfEmail))
          if (domains.length === 0) return
          const companies = yield* db.query((d) =>
            d
              .select({ id: schema.companies.id, name: schema.companies.name, domain: schema.companyDomains.domain })
              .from(schema.companyDomains)
              .innerJoin(schema.companies, eq(schema.companies.id, schema.companyDomains.companyId))
              .where(
                and(
                  eq(schema.companyDomains.teamId, teamId),
                  eq(schema.companyDomains.active, true),
                  inArray(schema.companyDomains.domain, domains),
                  isNull(schema.companies.deletedAt),
                ),
              ),
          )
          yield* affiliateMatches(
            principal,
            teamId,
            // A company matched through two domains is affiliated once, naming the first.
            [...new Map(companies.map((row) => [row.id, row])).values()].map((row) => ({
              contact,
              company: { id: row.id, name: row.name },
              domain: row.domain,
            })),
          )
        })

      const matchCompany = (
        principal: Principal,
        teamId: TeamId,
        company: RecordRef,
        addedDomains: ReadonlyArray<string>,
      ) =>
        Effect.gen(function* () {
          const domains = matchable(addedDomains)
          if (domains.length === 0) return
          const contacts = yield* db.query((d) =>
            d
              .select({
                id: schema.contacts.id,
                name: contactNameSql,
                domain: sql<string>`split_part(${schema.contactEmails.address}, '@', 2)`,
              })
              .from(schema.contactEmails)
              .innerJoin(schema.contacts, eq(schema.contacts.id, schema.contactEmails.contactId))
              .where(
                and(
                  eq(schema.contactEmails.teamId, teamId),
                  eq(schema.contactEmails.active, true),
                  inArray(sql`split_part(${schema.contactEmails.address}, '@', 2)`, domains),
                  isNull(schema.contacts.deletedAt),
                ),
              ),
          )
          yield* affiliateMatches(
            principal,
            teamId,
            [...new Map(contacts.map((row) => [row.id, row])).values()].map((row) => ({
              contact: { id: row.id, name: row.name },
              company,
              domain: row.domain,
            })),
          )
        })

      return {
        forContacts,
        listForCompany,
        locate,
        create,
        createMany,
        update,
        delete: remove,
        matchContact,
        matchCompany,
      }
    }),
  )
}
