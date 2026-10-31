import { describe, expect, it } from "@effect/vitest"
import { Database, schema } from "@parley/db"
import { Domain, EmailAddress, type Filter, parseCsv, type TeamId } from "@parley/domain"
import { Effect, Schema } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

const SharedPrincipalFixture = Effect.gen(function* () {
  const f = yield* Fixture
  const db = yield* Database
  yield* db
    .query((d) =>
      d.insert(schema.member).values({
        id: crypto.randomUUID(),
        organizationId: f.globex,
        userId: f.jane.userId,
        role: "owner",
        createdAt: new Date(),
      }),
    )
    .pipe(Effect.orDie)
  const domain = Schema.decodeUnknownSync(Domain)(`isolation-${crypto.randomUUID()}.example.com`)
  const makeRecords = (teamId: TeamId, label: string) =>
    Effect.gen(function* () {
      const company = yield* run["companies.create"](f.jane, { teamId, name: `Shared ${label}`, domains: [{ domain }] })
      const emptyCompany = yield* run["companies.create"](f.jane, { teamId, name: `Shared Z Empty ${label}` })
      const ana = yield* run["contacts.create"](f.jane, {
        teamId,
        firstName: "Shared Ana",
        lastName: label,
        emails: [{ address: Schema.decodeUnknownSync(EmailAddress)(`ana@${domain}`) }],
      })
      const ben = yield* run["contacts.create"](f.jane, {
        teamId,
        firstName: "Shared Ben",
        lastName: label,
        emails: [{ address: Schema.decodeUnknownSync(EmailAddress)(`ben@${domain}`) }],
      })
      return {
        teamId,
        label,
        company: yield* run["companies.get"](f.jane, { teamId, companyId: company.id }),
        emptyCompany,
        ana,
        ben,
      }
    })
  const acmeRecords = yield* makeRecords(f.acme, "Acme")
  const globexRecords = yield* makeRecords(f.globex, "Globex")
  return { ...f, domain, acmeRecords, globexRecords }
})

const sharedFilter: Filter = {
  match: "any",
  conditions: [
    { field: "name", operator: "contains", value: "Shared" },
    { field: "name", operator: "contains", value: "Nobody" },
  ],
}

describe("team isolation with a principal who belongs to both teams", () => {
  it.effect("scopes list results, counts, cursor pages and offset pages to the requested team", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      for (const records of [f.acmeRecords, f.globexRecords]) {
        const { teamId } = records
        const first = yield* run["contacts.list"](f.jane, { teamId, filter: sharedFilter, limit: 1 })
        expect(first.total).toBe(2)
        expect(first.nextCursor).not.toBeNull()
        const second = yield* run["contacts.list"](f.jane, {
          teamId,
          filter: sharedFilter,
          limit: 1,
          cursor: first.nextCursor ?? "",
        })
        expect([...first.items, ...second.items].map((contact) => contact.id).sort()).toEqual(
          [records.ana.id, records.ben.id].sort(),
        )
        const offset = yield* run["contacts.list"](f.jane, {
          teamId,
          filter: sharedFilter,
          sort: { field: "name", direction: "asc" },
          offset: 1,
          limit: 1,
        })
        expect(offset.total).toBe(2)
        expect(offset.items.map((contact) => contact.id)).toEqual([records.ben.id])
        const companies = yield* run["companies.list"](f.jane, { teamId, filter: sharedFilter })
        expect(companies.total).toBe(2)
        expect(companies.items.map((company) => company.id).sort()).toEqual(
          [records.company.id, records.emptyCompany.id].sort(),
        )
        const companyFirst = yield* run["companies.list"](f.jane, { teamId, filter: sharedFilter, limit: 1 })
        expect(companyFirst.total).toBe(2)
        expect(companyFirst.nextCursor).not.toBeNull()
        const companySecond = yield* run["companies.list"](f.jane, {
          teamId,
          filter: sharedFilter,
          limit: 1,
          cursor: companyFirst.nextCursor ?? "",
        })
        expect([...companyFirst.items, ...companySecond.items].map((company) => company.id).sort()).toEqual(
          [records.company.id, records.emptyCompany.id].sort(),
        )
        const companyOffset = yield* run["companies.list"](f.jane, {
          teamId,
          sort: { field: "name", direction: "asc" },
          offset: 1,
          limit: 1,
        })
        expect(companyOffset.total).toBe(2)
        expect(companyOffset.items.map((company) => company.id)).toEqual([records.emptyCompany.id])
      }
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("keeps domain matching, affiliation joins and relationship filters inside the team", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      for (const [records, other] of [
        [f.acmeRecords, f.globexRecords],
        [f.globexRecords, f.acmeRecords],
      ] as const) {
        const { teamId } = records
        const contact = yield* run["contacts.get"](f.jane, { teamId, contactId: records.ana.id })
        expect(contact.affiliations.map((entry) => entry.companyId)).toEqual([records.company.id])
        const affiliated = yield* run["affiliations.list"](f.jane, { teamId, companyId: records.company.id })
        expect(affiliated.map((entry) => entry.contactId).sort()).toEqual([records.ana.id, records.ben.id].sort())
        expect((yield* run["companies.get"](f.jane, { teamId, companyId: records.company.id })).contactCount).toBe(2)
        const foreignFilter = yield* run["contacts.list"](f.jane, {
          teamId,
          filter: {
            match: "all",
            conditions: [{ field: "company", operator: "is-any-of", value: [other.company.id] }],
          },
        })
        expect(foreignFilter.total).toBe(0)
        expect(foreignFilter.items).toEqual([])
      }
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("refuses foreign IDs on record reads, edits and deletes even for a member of both teams", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      const theirs = f.globexRecords
      const errors = yield* Effect.all([
        run["contacts.get"](f.jane, { teamId: f.acme, contactId: theirs.ana.id }).pipe(Effect.flip),
        run["contacts.update"](f.jane, { teamId: f.acme, contactId: theirs.ana.id, firstName: "Leaked" }).pipe(
          Effect.flip,
        ),
        run["contacts.delete"](f.jane, { teamId: f.acme, contactId: theirs.ana.id }).pipe(Effect.flip),
        run["companies.get"](f.jane, { teamId: f.acme, companyId: theirs.company.id }).pipe(Effect.flip),
        run["companies.update"](f.jane, { teamId: f.acme, companyId: theirs.company.id, name: "Leaked" }).pipe(
          Effect.flip,
        ),
        run["companies.delete"](f.jane, { teamId: f.acme, companyId: theirs.company.id }).pipe(Effect.flip),
      ])
      expect(errors.map((error) => error._tag)).toEqual([
        "ContactNotFound",
        "ContactNotFound",
        "ContactNotFound",
        "CompanyNotFound",
        "CompanyNotFound",
        "CompanyNotFound",
      ])
      expect(yield* run["contacts.get"](f.jane, { teamId: f.globex, contactId: theirs.ana.id })).toEqual(theirs.ana)
      expect(yield* run["companies.get"](f.jane, { teamId: f.globex, companyId: theirs.company.id })).toEqual(
        theirs.company,
      )
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("scopes full, filtered and picked-ID CSV exports to the requested team", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      for (const [records, other] of [
        [f.acmeRecords, f.globexRecords],
        [f.globexRecords, f.acmeRecords],
      ] as const) {
        const { teamId } = records
        for (const filter of [undefined, sharedFilter]) {
          const contacts = yield* run["contacts.export"](f.jane, {
            teamId,
            ...(filter === undefined ? {} : { filter }),
          })
          expect(contacts.count).toBe(2)
          expect(
            parseCsv(contacts.csv)
              .slice(1)
              .map((row) => [row[1], row[5]]),
          ).toEqual([
            [records.label, records.company.name],
            [records.label, records.company.name],
          ])
        }
        const picked = yield* run["contacts.export"](f.jane, { teamId, ids: [records.ana.id, other.ana.id] })
        expect(picked.count).toBe(1)
        expect(
          parseCsv(picked.csv)
            .slice(1)
            .map((row) => row[1]),
        ).toEqual([records.label])
        const companies = yield* run["companies.export"](f.jane, { teamId })
        expect(companies.count).toBe(2)
        expect(
          parseCsv(companies.csv)
            .slice(1)
            .map((row) => row[0])
            .sort(),
        ).toEqual([records.company.name, records.emptyCompany.name].sort())
        const pickedCompanies = yield* run["companies.export"](f.jane, {
          teamId,
          filter: sharedFilter,
          ids: [records.company.id, other.company.id],
        })
        expect(pickedCompanies.count).toBe(1)
        expect(
          parseCsv(pickedCompanies.csv)
            .slice(1)
            .map((row) => row[0]),
        ).toEqual([records.company.name])
      }
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("scopes dynamic segment counts, contacts and exports when the filter matches both teams", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      const segment = yield* run["segments.create"](f.jane, {
        teamId: f.acme,
        name: "Shared contacts",
        kind: "dynamic",
        filter: sharedFilter,
      })
      expect(segment).toMatchObject({ contactCount: 2, sendableCount: 2 })
      const contacts = yield* run["segments.contacts"](f.jane, { teamId: f.acme, segmentId: segment.id })
      expect(contacts.items.map((contact) => contact.id).sort()).toEqual(
        [f.acmeRecords.ana.id, f.acmeRecords.ben.id].sort(),
      )
      const exported = yield* run["contacts.export"](f.jane, { teamId: f.acme, segmentId: segment.id })
      expect(exported.count).toBe(2)
      expect(
        parseCsv(exported.csv)
          .slice(1)
          .map((row) => row[1]),
      ).toEqual(["Acme", "Acme"])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("updates only the requested team's matches or picked IDs", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      const mine = f.acmeRecords
      const theirs = f.globexRecords
      expect(
        yield* run["contacts.updateMany"](f.jane, {
          teamId: f.acme,
          selection: { matching: { search: "Shared" } },
          ownerId: f.jane.userId,
        }),
      ).toMatchObject({ count: 2 })
      expect(
        yield* run["companies.updateMany"](f.jane, {
          teamId: f.acme,
          selection: { matching: { search: "Shared" } },
          ownerId: f.jane.userId,
        }),
      ).toMatchObject({ count: 2 })
      expect(
        yield* run["contacts.updateMany"](f.jane, {
          teamId: f.acme,
          selection: { ids: [mine.ana.id, theirs.ana.id] },
          ownerId: f.jane.userId,
        }),
      ).toMatchObject({ count: 1 })
      expect(
        yield* run["companies.updateMany"](f.jane, {
          teamId: f.acme,
          selection: { ids: [mine.company.id, theirs.company.id] },
          ownerId: f.jane.userId,
        }),
      ).toMatchObject({ count: 1 })
      expect((yield* run["contacts.list"](f.jane, { teamId: f.acme })).items.map((contact) => contact.ownerId)).toEqual(
        [f.jane.userId, f.jane.userId],
      )
      expect(
        (yield* run["companies.list"](f.jane, { teamId: f.acme })).items.map((company) => company.ownerId),
      ).toEqual([f.jane.userId, f.jane.userId])
      expect(yield* run["contacts.get"](f.jane, { teamId: f.globex, contactId: theirs.ana.id })).toEqual(theirs.ana)
      expect(yield* run["contacts.get"](f.jane, { teamId: f.globex, contactId: theirs.ben.id })).toEqual(theirs.ben)
      expect(yield* run["companies.get"](f.jane, { teamId: f.globex, companyId: theirs.company.id })).toEqual(
        theirs.company,
      )
      expect(yield* run["companies.get"](f.jane, { teamId: f.globex, companyId: theirs.emptyCompany.id })).toEqual(
        theirs.emptyCompany,
      )
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("deletes matching or picked records only inside the requested team", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      expect(
        yield* run["contacts.deleteMany"](f.jane, { teamId: f.acme, selection: { matching: { search: "Ana" } } }),
      ).toMatchObject({ count: 1 })
      expect(
        yield* run["companies.deleteMany"](f.jane, {
          teamId: f.acme,
          selection: { ids: [f.acmeRecords.emptyCompany.id, f.globexRecords.emptyCompany.id] },
        }),
      ).toMatchObject({ count: 1 })
      expect((yield* run["contacts.list"](f.jane, { teamId: f.acme })).items.map((contact) => contact.id)).toEqual([
        f.acmeRecords.ben.id,
      ])
      expect((yield* run["companies.list"](f.jane, { teamId: f.acme })).items.map((company) => company.id)).toEqual([
        f.acmeRecords.company.id,
      ])
      expect(
        yield* run["companies.deleteMany"](f.jane, { teamId: f.acme, selection: { matching: { search: "Shared" } } }),
      ).toMatchObject({ count: 1 })
      expect((yield* run["companies.list"](f.jane, { teamId: f.acme })).items).toEqual([])
      expect((yield* run["contacts.list"](f.jane, { teamId: f.globex })).total).toBe(2)
      expect((yield* run["companies.list"](f.jane, { teamId: f.globex })).total).toBe(2)
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("does not restore another team's records through its bulk-deletion marker", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      const contacts = yield* run["contacts.deleteMany"](f.jane, {
        teamId: f.globex,
        selection: { ids: [f.globexRecords.ana.id] },
      })
      const companies = yield* run["companies.deleteMany"](f.jane, {
        teamId: f.globex,
        selection: { ids: [f.globexRecords.emptyCompany.id] },
      })
      expect(
        yield* run["contacts.restoreMany"](f.jane, { teamId: f.acme, deletedAt: contacts.deletedAt }),
      ).toMatchObject({ count: 0 })
      expect(
        yield* run["companies.restoreMany"](f.jane, { teamId: f.acme, deletedAt: companies.deletedAt }),
      ).toMatchObject({ count: 0 })
      expect(
        (yield* run["contacts.list"](f.jane, { teamId: f.globex, deleted: true })).items.map((contact) => contact.id),
      ).toEqual([f.globexRecords.ana.id])
      expect(
        (yield* run["companies.list"](f.jane, { teamId: f.globex, deleted: true })).items.map((company) => company.id),
      ).toEqual([f.globexRecords.emptyCompany.id])
      expect((yield* run["contacts.list"](f.jane, { teamId: f.acme })).total).toBe(2)
      expect((yield* run["companies.list"](f.jane, { teamId: f.acme })).total).toBe(2)
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("matches imports by email or domain only within the requested team", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      for (const [records, other] of [
        [f.acmeRecords, f.globexRecords],
        [f.globexRecords, f.acmeRecords],
      ] as const) {
        const otherContact = yield* run["contacts.get"](f.jane, { teamId: other.teamId, contactId: other.ana.id })
        const contacts = yield* run["contacts.import"](f.jane, {
          teamId: records.teamId,
          csv: `First name,Last name,Email\nImported,${records.label},ana@${f.domain}`,
        })
        expect(contacts).toMatchObject({ created: 0, updated: 1, failed: [] })
        expect(
          (yield* run["contacts.get"](f.jane, { teamId: records.teamId, contactId: records.ana.id })).firstName,
        ).toBe("Imported")
        expect(yield* run["contacts.get"](f.jane, { teamId: other.teamId, contactId: other.ana.id })).toEqual(
          otherContact,
        )
        const otherCompany = yield* run["companies.get"](f.jane, { teamId: other.teamId, companyId: other.company.id })
        const companies = yield* run["companies.import"](f.jane, {
          teamId: records.teamId,
          csv: `Company,Domain\nImported ${records.label},${f.domain}`,
        })
        expect(companies).toMatchObject({ created: 0, updated: 1, failed: [] })
        expect(
          (yield* run["companies.get"](f.jane, { teamId: records.teamId, companyId: records.company.id })).name,
        ).toBe(`Imported ${records.label}`)
        expect(yield* run["companies.get"](f.jane, { teamId: other.teamId, companyId: other.company.id })).toEqual(
          otherCompany,
        )
      }
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("matches company imports without domains by name only inside the team", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      for (const records of [f.acmeRecords, f.globexRecords]) {
        yield* run["companies.update"](f.jane, {
          teamId: records.teamId,
          companyId: records.company.id,
          name: "Shared name",
        })
      }
      for (const [records, other] of [
        [f.acmeRecords, f.globexRecords],
        [f.globexRecords, f.acmeRecords],
      ] as const) {
        const before = yield* run["companies.get"](f.jane, { teamId: other.teamId, companyId: other.company.id })
        const imported = yield* run["companies.import"](f.jane, {
          teamId: records.teamId,
          csv: `Company,City\nShared name,${records.label}`,
        })
        expect(imported).toMatchObject({ created: 0, updated: 1, failed: [] })
        expect(
          (yield* run["companies.get"](f.jane, { teamId: records.teamId, companyId: records.company.id })).address
            ?.city,
        ).toBe(records.label)
        expect(yield* run["companies.get"](f.jane, { teamId: other.teamId, companyId: other.company.id })).toEqual(
          before,
        )
      }
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("the declared composite affiliation foreign keys reject cross-team links in Postgres", () =>
    Effect.gen(function* () {
      const f = yield* SharedPrincipalFixture
      const db = yield* Database
      const companyMismatch = yield* db
        .query((d) =>
          d.insert(schema.affiliations).values({
            id: crypto.randomUUID(),
            teamId: f.acme,
            contactId: f.acmeRecords.ana.id,
            companyId: f.globexRecords.company.id,
          }),
        )
        .pipe(Effect.flip)
      expect(companyMismatch.reason).toMatchObject({
        _tag: "ConstraintError",
        cause: { code: "23503", constraint: "affiliations_company_fk" },
      })
      const contactMismatch = yield* db
        .query((d) =>
          d.insert(schema.affiliations).values({
            id: crypto.randomUUID(),
            teamId: f.acme,
            contactId: f.globexRecords.ana.id,
            companyId: f.acmeRecords.company.id,
          }),
        )
        .pipe(Effect.flip)
      expect(contactMismatch.reason).toMatchObject({
        _tag: "ConstraintError",
        cause: { code: "23503", constraint: "affiliations_contact_fk" },
      })
    }).pipe(Effect.provide(CoreLive)),
  )
})
