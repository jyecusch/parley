import { describe, expect, it } from "@effect/vitest"
import { companyFieldReader, contactFieldReader, type Filter, matchesFilter, parseCsv } from "@parley/domain"
import { Effect } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

describe("record owners (D123)", () => {
  it.effect("sets and clears a contact owner, refuses non-members, and allows service accounts", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const ana = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ana", ownerId: f.sam.userId })
      expect(ana).toMatchObject({ ownerId: f.sam.userId, ownerName: "Sam" })

      const bot = yield* run["serviceAccounts.create"](f.jane, { teamId: f.acme, name: "Sync bot" })
      const byBot = yield* run["contacts.update"](f.jane, { teamId: f.acme, contactId: ana.id, ownerId: bot.id })
      expect(byBot).toMatchObject({ ownerId: bot.id, ownerName: "Sync bot" })

      const cleared = yield* run["contacts.update"](f.jane, { teamId: f.acme, contactId: ana.id, ownerId: null })
      expect(cleared).toMatchObject({ ownerId: null, ownerName: null })

      // Bob is in another team, not this one.
      const outsider = yield* run["contacts.update"](f.jane, {
        teamId: f.acme,
        contactId: ana.id,
        ownerId: f.bob.userId,
      }).pipe(Effect.flip)
      expect(outsider._tag).toBe("MemberNotFound")

      const activity = yield* run["contacts.activity"](f.jane, { teamId: f.acme, contactId: ana.id })
      expect(activity.some((entry) => entry.changedFields.includes("ownerId"))).toBe(true)
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("company owners work the same way", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const acme = yield* run["companies.create"](f.jane, { teamId: f.acme, name: "Acme", ownerId: f.jane.userId })
      expect(acme).toMatchObject({ ownerId: f.jane.userId, ownerName: "Jane" })
      const refused = yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Globex",
        ownerId: f.bob.userId,
      }).pipe(Effect.flip)
      expect(refused._tag).toBe("MemberNotFound")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("a member's records have no owner once they leave or are removed", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const ana = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ana", ownerId: f.sam.userId })
      const acme = yield* run["companies.create"](f.jane, { teamId: f.acme, name: "Acme", ownerId: f.sam.userId })
      const janes = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Jo", ownerId: f.jane.userId })
      yield* run["members.remove"](f.jane, { teamId: f.acme, userId: f.sam.userId })

      expect(yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: ana.id })).toMatchObject({
        ownerId: null,
        ownerName: null,
      })
      expect(yield* run["companies.get"](f.jane, { teamId: f.acme, companyId: acme.id })).toMatchObject({
        ownerId: null,
      })
      expect(yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: janes.id })).toMatchObject({
        ownerId: f.jane.userId,
      })
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("filters and sorts by owner as the web app does, and exports and imports the owner", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ana", ownerId: f.sam.userId })
      yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ben", ownerId: f.jane.userId })
      yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Cy" })
      yield* run["companies.create"](f.jane, { teamId: f.acme, name: "Acme", ownerId: f.sam.userId })
      yield* run["companies.create"](f.jane, { teamId: f.acme, name: "Bolt" })

      const filters: ReadonlyArray<Filter> = [
        { match: "all", conditions: [{ field: "owner", operator: "is-any-of", value: [f.sam.userId] }] },
        { match: "all", conditions: [{ field: "owner", operator: "is-none-of", value: [f.sam.userId] }] },
        { match: "all", conditions: [{ field: "owner", operator: "is-empty" }] },
        { match: "all", conditions: [{ field: "owner", operator: "is-not-empty" }] },
      ]
      const contacts = (yield* run["contacts.list"](f.jane, { teamId: f.acme, limit: 200 })).items
      const companies = (yield* run["companies.list"](f.jane, { teamId: f.acme, limit: 200 })).items
      for (const filter of filters) {
        const server = (yield* run["contacts.list"](f.jane, { teamId: f.acme, filter })).items.map((c) => c.displayName)
        const local = contacts.filter((c) => matchesFilter(filter, contactFieldReader(c))).map((c) => c.displayName)
        expect({ filter: filter.conditions, names: server.sort() }).toEqual({
          filter: filter.conditions,
          names: local.sort(),
        })
        const serverCompanies = (yield* run["companies.list"](f.jane, { teamId: f.acme, filter })).items.map(
          (c) => c.name,
        )
        const localCompanies = companies.filter((c) => matchesFilter(filter, companyFieldReader(c))).map((c) => c.name)
        expect(serverCompanies.sort()).toEqual(localCompanies.sort())
      }

      // By the owner's name, with no owner last.
      const sorted = yield* run["contacts.list"](f.jane, {
        teamId: f.acme,
        sort: { field: "owner", direction: "asc" },
      })
      expect(sorted.items.map((contact) => contact.displayName)).toEqual(["Ben", "Ana", "Cy"])

      const exported = yield* run["contacts.export"](f.jane, { teamId: f.acme })
      const [header, ...rows] = parseCsv(exported.csv)
      const column = header?.indexOf("Contact owner") ?? -1
      expect(column).toBeGreaterThan(-1)
      expect(rows.map((row) => row[column]).sort()).toEqual(["", "Jane", "Sam"])

      const imported = yield* run["contacts.import"](f.jane, {
        teamId: f.acme,
        csv: "First name,Email,Contact owner\nDee,dee@x.io,Jane\nEd,ed@x.io,nobody@nowhere.io\n",
      })
      expect(imported.created).toBe(1)
      expect(imported.failed).toMatchObject([{ line: 3, problems: [{ field: "owner" }] }])
      const dee = (yield* run["contacts.list"](f.jane, { teamId: f.acme, search: "Dee" })).items[0]
      expect(dee).toMatchObject({ ownerId: f.jane.userId })
    }).pipe(Effect.provide(CoreLive)),
  )
})
