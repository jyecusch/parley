import { describe, expect, it } from "@effect/vitest"
import type { ContactId } from "@parley/domain"
import { Effect } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

/** A tag unique to one test, so searches find only its records. */
const tagged = () => `t${crypto.randomUUID().slice(0, 8)}`

describe("paged lists and selections (D136, D137)", () => {
  it.effect("counts matching records on the first page only", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const tag = tagged()
      for (const name of ["Ana", "Ben", "Cal"]) {
        yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: name, lastName: tag })
      }
      yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Dee" })

      const first = yield* run["contacts.list"](f.jane, { teamId: f.acme, search: tag, limit: 2 })
      expect(first.items).toHaveLength(2)
      expect(first.total).toBe(3)
      const second = yield* run["contacts.list"](f.jane, {
        teamId: f.acme,
        search: tag,
        limit: 2,
        cursor: first.nextCursor ?? "",
      })
      expect(second.items).toHaveLength(1)
      expect(second.total).toBeNull()
      expect((yield* run["contacts.list"](f.jane, { teamId: f.acme })).total).toBe(4)

      yield* run["companies.create"](f.jane, { teamId: f.acme, name: `${tag} One` })
      yield* run["companies.create"](f.jane, { teamId: f.acme, name: "Other" })
      expect((yield* run["companies.list"](f.jane, { teamId: f.acme, search: tag })).total).toBe(1)

      const segment = yield* run["segments.create"](f.jane, { teamId: f.acme, name: tag, kind: "fixed" })
      const contacts = yield* run["contacts.list"](f.jane, { teamId: f.acme, search: tag })
      yield* run["segments.addContacts"](f.jane, {
        teamId: f.acme,
        segmentId: segment.id,
        contactIds: contacts.items.slice(0, 2).map((contact) => contact.id),
      })
      expect((yield* run["segments.contacts"](f.jane, { teamId: f.acme, segmentId: segment.id })).total).toBe(2)
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("sets a field and the owner on picked ids or on every matching contact", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const tag = tagged()
      const plan = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Plan",
        type: "text",
      })
      const seats = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Seats",
        type: "number",
      })
      const made = []
      for (const name of ["Ana", "Ben", "Cal"]) {
        made.push(yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: name, lastName: tag }))
      }
      const other = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Dee" })
      const outsider = yield* run["contacts.create"](f.bob, { teamId: f.globex, firstName: "Eve" })

      const matching = yield* run["contacts.updateMany"](f.jane, {
        teamId: f.acme,
        selection: { matching: { search: tag } },
        custom: { [plan.id]: "Pro", [seats.id]: 5 },
        ownerId: f.sam.userId,
      })
      expect(matching.count).toBe(3)
      const updated = yield* run["contacts.list"](f.jane, { teamId: f.acme, search: tag })
      for (const contact of updated.items) {
        expect(contact).toMatchObject({ custom: { [plan.id]: "Pro", [seats.id]: 5 }, ownerId: f.sam.userId })
      }
      expect((yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: other.id })).custom).toEqual({})
      const activity = yield* run["contacts.activity"](f.jane, { teamId: f.acme, contactId: made[0]?.id as ContactId })
      expect(activity.at(-1)?.changedFields).toEqual(expect.arrayContaining(["Plan", "Seats", "ownerId"]))

      // Picked ids: another team's contact and an id that isn't one are left out, not counted.
      const picked = yield* run["contacts.updateMany"](f.jane, {
        teamId: f.acme,
        selection: { ids: [made[0]?.id ?? "", outsider.id, "not-an-id"] },
        custom: { [plan.id]: null },
      })
      expect(picked.count).toBe(1)
      const cleared = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: made[0]?.id as ContactId })
      expect(cleared.custom).toEqual({ [seats.id]: 5 })
      expect((yield* run["contacts.get"](f.bob, { teamId: f.globex, contactId: outsider.id })).custom).toEqual({})

      // Bad values and owners are refused, even when nothing matches.
      const badValue = yield* run["contacts.updateMany"](f.jane, {
        teamId: f.acme,
        selection: { matching: { search: "nobody-matches-this" } },
        custom: { [seats.id]: "many" },
      }).pipe(Effect.flip)
      expect(badValue._tag).toBe("InputRejected")
      const badOwner = yield* run["contacts.updateMany"](f.jane, {
        teamId: f.acme,
        selection: { matching: { search: tag } },
        ownerId: f.bob.userId,
      }).pipe(Effect.flip)
      expect(badOwner._tag).toBe("MemberNotFound")
      const readOnly = yield* run["contacts.updateMany"](f.janeReadOnlyKey, {
        teamId: f.acme,
        selection: { matching: { search: tag } },
        ownerId: null,
      }).pipe(Effect.flip)
      expect(readOnly._tag).toBe("ApiKeyScopeExcludes")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect(
    "deletes every matching contact, past one chunk, and restores them together",
    () =>
      Effect.gen(function* () {
        const f = yield* Fixture
        const tag = tagged()
        const rows = Array.from({ length: 1205 }, (_, index) => `Person${index},${tag},p${index}-${tag}@example.com`)
        const imported = yield* run["contacts.import"](f.jane, {
          teamId: f.acme,
          csv: ["First name,Last name,Email", ...rows].join("\n"),
        })
        expect(imported.created).toBe(1205)
        yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Keep", lastName: tag })

        // The filter narrows the search: only contacts with an email.
        const deleted = yield* run["contacts.deleteMany"](f.jane, {
          teamId: f.acme,
          selection: {
            matching: {
              search: tag,
              filter: { match: "all", conditions: [{ field: "email", operator: "contains", value: tag }] },
            },
          },
        })
        expect(deleted.count).toBe(1205)
        expect((yield* run["contacts.list"](f.jane, { teamId: f.acme, search: tag })).total).toBe(1)
        expect((yield* run["contacts.list"](f.jane, { teamId: f.acme, search: tag, deleted: true })).total).toBe(1205)

        // Someone takes one of the addresses meanwhile: that contact stays deleted.
        yield* run["contacts.create"](f.jane, {
          teamId: f.acme,
          firstName: "Taker",
          emails: [{ address: `p7-${tag}@example.com` as never }],
        })
        const restored = yield* run["contacts.restoreMany"](f.jane, { teamId: f.acme, deletedAt: deleted.deletedAt })
        expect(restored.count).toBe(1204)
        expect(
          (yield* run["contacts.list"](f.jane, { teamId: f.acme, search: `p7-${tag}@`, deleted: true })).total,
        ).toBe(1)

        const again = yield* run["contacts.restoreMany"](f.jane, { teamId: f.acme, deletedAt: deleted.deletedAt })
        expect(again.count).toBe(0)
        const bad = yield* run["contacts.restoreMany"](f.jane, { teamId: f.acme, deletedAt: "yesterday" }).pipe(
          Effect.flip,
        )
        expect(bad._tag).toBe("InputRejected")
      }).pipe(Effect.provide(CoreLive)),
    120_000,
  )

  it.effect("deletes picked ids only in the team, and a bad filter is refused", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const mine = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Mine" })
      const theirs = yield* run["contacts.create"](f.bob, { teamId: f.globex, firstName: "Theirs" })
      const deleted = yield* run["contacts.deleteMany"](f.jane, {
        teamId: f.acme,
        selection: { ids: [mine.id, theirs.id] },
      })
      expect(deleted.count).toBe(1)
      expect((yield* run["contacts.get"](f.bob, { teamId: f.globex, contactId: theirs.id })).deletedAt).toBeNull()

      const badFilter = yield* run["contacts.deleteMany"](f.jane, {
        teamId: f.acme,
        selection: {
          matching: { filter: { match: "all", conditions: [{ field: "nope", operator: "is", value: "x" }] } },
        },
      }).pipe(Effect.flip)
      expect(badFilter._tag).toBe("InputRejected")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("companies: set the owner, delete and restore, skipping one whose domain was taken", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const tag = tagged()
      const one = yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: `${tag} One`,
        domains: [{ domain: `one-${tag}.com` as never }],
      })
      yield* run["companies.create"](f.jane, { teamId: f.acme, name: `${tag} Two` })

      const owned = yield* run["companies.updateMany"](f.jane, {
        teamId: f.acme,
        selection: { matching: { search: tag } },
        ownerId: f.sam.userId,
      })
      expect(owned.count).toBe(2)
      expect((yield* run["companies.get"](f.jane, { teamId: f.acme, companyId: one.id })).ownerId).toBe(f.sam.userId)

      const deleted = yield* run["companies.deleteMany"](f.jane, {
        teamId: f.acme,
        selection: { matching: { search: tag } },
      })
      expect(deleted.count).toBe(2)
      yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Taker",
        domains: [{ domain: `one-${tag}.com` as never }],
      })
      const restored = yield* run["companies.restoreMany"](f.jane, { teamId: f.acme, deletedAt: deleted.deletedAt })
      expect(restored.count).toBe(1)
      expect((yield* run["companies.list"](f.jane, { teamId: f.acme, search: `${tag} T` })).total).toBe(1)
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("affiliates every matching contact with a company, updating titles of those already affiliated", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const tag = tagged()
      const company = yield* run["companies.create"](f.jane, { teamId: f.acme, name: `${tag} Co` })
      const ana = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ana", lastName: tag })
      yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ben", lastName: tag })
      yield* run["affiliations.create"](f.jane, {
        teamId: f.acme,
        contactId: ana.id,
        companyId: company.id,
        title: "CEO",
      })

      const added = yield* run["affiliations.createMany"](f.jane, {
        teamId: f.acme,
        contacts: { matching: { search: tag } },
        companyId: company.id,
      })
      expect(added.count).toBe(2)
      const listed = yield* run["affiliations.list"](f.jane, { teamId: f.acme, companyId: company.id })
      expect(listed.map((entry) => [entry.contactName, entry.title]).sort()).toEqual([
        [`Ana ${tag}`, "CEO"],
        [`Ben ${tag}`, null],
      ])

      yield* run["affiliations.createMany"](f.jane, {
        teamId: f.acme,
        contacts: { matching: { search: tag } },
        companyId: company.id,
        title: "Buyer",
      })
      const retitled = yield* run["affiliations.list"](f.jane, { teamId: f.acme, companyId: company.id })
      expect(retitled.map((entry) => entry.title)).toEqual(["Buyer", "Buyer"])
      const activity = yield* run["companies.activity"](f.jane, { teamId: f.acme, companyId: company.id })
      expect(activity.filter((entry) => entry.kind === "affiliated")).toHaveLength(2)

      const elsewhere = yield* run["companies.create"](f.bob, { teamId: f.globex, name: "Globex Co" })
      const refused = yield* run["affiliations.createMany"](f.jane, {
        teamId: f.acme,
        contacts: { matching: { search: tag } },
        companyId: elsewhere.id,
      }).pipe(Effect.flip)
      expect(refused._tag).toBe("CompanyNotFound")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("adds every matching contact to a fixed segment, given either ids or matching", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const tag = tagged()
      for (const name of ["Ana", "Ben", "Cal"]) {
        yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: name, lastName: tag })
      }
      const segment = yield* run["segments.create"](f.jane, { teamId: f.acme, name: tag, kind: "fixed" })
      const added = yield* run["segments.addContacts"](f.jane, {
        teamId: f.acme,
        segmentId: segment.id,
        matching: { search: tag },
      })
      expect(added.contactCount).toBe(3)
      const none = yield* run["segments.addContacts"](f.jane, {
        teamId: f.acme,
        segmentId: segment.id,
        matching: { search: "nobody-matches-this" },
      })
      expect(none.contactCount).toBe(3)

      const neither = yield* run["segments.addContacts"](f.jane, { teamId: f.acme, segmentId: segment.id }).pipe(
        Effect.flip,
      )
      expect(neither._tag).toBe("InputRejected")
      const both = yield* run["segments.addContacts"](f.jane, {
        teamId: f.acme,
        segmentId: segment.id,
        contactIds: [],
        matching: { search: tag },
      }).pipe(Effect.flip)
      expect(both._tag).toBe("InputRejected")
    }).pipe(Effect.provide(CoreLive)),
  )
})
