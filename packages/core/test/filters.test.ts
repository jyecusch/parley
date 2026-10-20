import { describe, expect, it } from "@effect/vitest"
import { companyFieldReader, contactFieldReader, type Filter, matchesFilter } from "@parley/domain"
import { Effect } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

const email = (address: string) => ({ address: address as never })

describe("filters", () => {
  it.effect("the server's SQL and the web's evaluator agree", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const plan = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Plan",
        type: "single-select",
        options: [
          { id: "free", label: "Free" },
          { id: "pro", label: "Pro" },
        ],
      })
      const tags = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Tags",
        type: "multi-select",
        options: [
          { id: "vip", label: "VIP" },
          { id: "beta", label: "Beta" },
        ],
      })
      const score = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Score",
        type: "number",
      })
      const renewal = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Renewal",
        type: "date",
      })
      const active = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Active",
        type: "checkbox",
      })

      const acme = yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Acme",
        domains: [{ domain: "acme.io" as never }],
      })
      yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Ana",
        lastName: "Lopez",
        emails: [email("ana@acme.io")],
        ownerId: f.sam.userId,
        custom: {
          [plan.id]: "pro",
          [tags.id]: ["vip", "beta"],
          [score.id]: 90,
          [renewal.id]: "2026-01-15",
          [active.id]: true,
        },
      })
      yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Ben",
        emails: [email("ben@gmail.com")],
        phones: [{ number: "+61400000001" as never }],
        custom: { [plan.id]: "free", [tags.id]: ["beta"], [score.id]: 40 },
      })
      yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Cy", custom: { [renewal.id]: "2027-06-01" } })

      const filters: ReadonlyArray<Filter> = [
        { match: "all", conditions: [{ field: "email", operator: "contains", value: "ACME" }] },
        { match: "all", conditions: [{ field: "email", operator: "does-not-contain", value: "acme" }] },
        { match: "all", conditions: [{ field: "email", operator: "is-empty" }] },
        { match: "all", conditions: [{ field: "name", operator: "starts-with", value: "an" }] },
        { match: "all", conditions: [{ field: "name", operator: "is", value: "ben" }] },
        { match: "all", conditions: [{ field: "phone", operator: "is-not-empty" }] },
        { match: "all", conditions: [{ field: "company", operator: "is-any-of", value: [acme.id] }] },
        { match: "all", conditions: [{ field: "company", operator: "is-empty" }] },
        { match: "all", conditions: [{ field: "owner", operator: "is-any-of", value: [f.sam.userId] }] },
        { match: "all", conditions: [{ field: "owner", operator: "is-none-of", value: [f.sam.userId] }] },
        { match: "all", conditions: [{ field: "owner", operator: "is-empty" }] },
        { match: "all", conditions: [{ field: `custom:${plan.id}`, operator: "is-any-of", value: ["pro"] }] },
        { match: "all", conditions: [{ field: `custom:${plan.id}`, operator: "is-none-of", value: ["pro"] }] },
        { match: "all", conditions: [{ field: `custom:${tags.id}`, operator: "has-all-of", value: ["vip", "beta"] }] },
        { match: "all", conditions: [{ field: `custom:${tags.id}`, operator: "has-none-of", value: ["vip"] }] },
        { match: "all", conditions: [{ field: `custom:${tags.id}`, operator: "is-empty" }] },
        { match: "all", conditions: [{ field: `custom:${score.id}`, operator: "greater-than", value: 50 }] },
        { match: "all", conditions: [{ field: `custom:${score.id}`, operator: "is-empty" }] },
        { match: "all", conditions: [{ field: `custom:${renewal.id}`, operator: "before", value: "2026-06-01" }] },
        { match: "all", conditions: [{ field: `custom:${active.id}`, operator: "is-not-checked" }] },
        { match: "all", conditions: [{ field: "createdAt", operator: "in-last-days", value: 1 }] },
        {
          match: "any",
          conditions: [
            { field: `custom:${score.id}`, operator: "less-than", value: 50 },
            { field: `custom:${renewal.id}`, operator: "after", value: "2027-01-01" },
          ],
        },
      ]

      const all = (yield* run["contacts.list"](f.jane, { teamId: f.acme, limit: 200 })).items
      for (const filter of filters) {
        const server = (yield* run["contacts.list"](f.jane, { teamId: f.acme, filter, limit: 200 })).items
          .map((contact) => contact.displayName)
          .sort()
        const local = all
          .filter((contact) => matchesFilter(filter, contactFieldReader(contact)))
          .map((contact) => contact.displayName)
          .sort()
        expect({ filter: filter.conditions, names: server }).toEqual({ filter: filter.conditions, names: local })
      }

      // Companies too, including the computed contact count.
      const companies = (yield* run["companies.list"](f.jane, { teamId: f.acme, limit: 200 })).items
      const countFilter: Filter = {
        match: "all",
        conditions: [{ field: "contactCount", operator: "greater-than", value: 0 }],
      }
      const serverCompanies = (yield* run["companies.list"](f.jane, { teamId: f.acme, filter: countFilter })).items.map(
        (company) => company.name,
      )
      expect(serverCompanies).toEqual(
        companies
          .filter((company) => matchesFilter(countFilter, companyFieldReader(company)))
          .map((company) => company.name),
      )
      expect(serverCompanies).toEqual(["Acme"])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("sorts with stable pages, and rejects bad conditions in our words", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      for (const name of ["Cleo", "Abe", "Bea", "Dot"]) {
        yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: name })
      }
      const first = yield* run["contacts.list"](f.jane, {
        teamId: f.acme,
        sort: { field: "name", direction: "asc" },
        limit: 2,
      })
      expect(first.items.map((contact) => contact.displayName)).toEqual(["Abe", "Bea"])
      const second = yield* run["contacts.list"](f.jane, {
        teamId: f.acme,
        sort: { field: "name", direction: "asc" },
        limit: 2,
        cursor: first.nextCursor ?? "",
      })
      expect(second.items.map((contact) => contact.displayName)).toEqual(["Cleo", "Dot"])

      const bad = yield* run["contacts.list"](f.jane, {
        teamId: f.acme,
        filter: {
          match: "all",
          conditions: [
            { field: "shoe-size", operator: "equals", value: 9 },
            { field: "email", operator: "greater-than", value: 3 },
            { field: "name", operator: "contains" },
          ],
        },
      }).pipe(Effect.flip)
      expect(bad._tag).toBe("InputRejected")
      if (bad._tag === "InputRejected") {
        expect(bad.problems.map((problem) => [problem.field, problem.problem])).toEqual([
          ["filter.conditions.0", "not-allowed"],
          ["filter.conditions.1", "invalid-format"],
          ["filter.conditions.2", "missing"],
        ])
      }
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("refuses filter values that would make a bad or runaway query", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      for (const value of [1.5, 1e12]) {
        const refused = yield* run["contacts.list"](f.jane, {
          teamId: f.acme,
          filter: { match: "all", conditions: [{ field: "createdAt", operator: "in-last-days", value }] },
        }).pipe(Effect.flip)
        expect(refused._tag).toBe("InputRejected")
      }
      // A forged cursor starts from the top rather than failing.
      const page = yield* run["contacts.list"](f.jane, { teamId: f.acme, cursor: btoa("2020-01-01T00:00:00Z|x") })
      expect(page.items).toBeDefined()
    }).pipe(Effect.provide(CoreLive)),
  )
})
