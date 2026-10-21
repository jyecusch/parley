import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

describe("segments", () => {
  it.effect("a dynamic segment follows its filter, and counts who a broadcast would reach", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const domain = `seg-${crypto.randomUUID().slice(0, 8)}.example.com`
      const make = (firstName: string, subscribed: boolean) =>
        run["contacts.create"](f.jane, {
          teamId: f.acme,
          firstName,
          emails: [{ address: `${firstName.toLowerCase()}@${domain}` as never }],
          subscriptionStatus: subscribed ? "subscribed" : "unsubscribed",
        })
      const ada = yield* make("Ada", true)
      const bo = yield* make("Bo", false)
      yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Cy" })

      const segment = yield* run["segments.create"](f.sam, {
        teamId: f.acme,
        name: "Our domain",
        kind: "dynamic",
        filter: { match: "all", conditions: [{ field: "email", operator: "contains", value: domain }] },
      })
      expect(segment).toMatchObject({ kind: "dynamic", contactCount: 2, sendableCount: 1 })
      const page = yield* run["segments.contacts"](f.jane, { teamId: f.acme, segmentId: segment.id })
      expect(page.items.map((contact) => contact.id).sort()).toEqual([ada.id, bo.id].sort())

      // Records change, and so does the segment.
      yield* run["contacts.update"](f.jane, { teamId: f.acme, contactId: bo.id, subscriptionStatus: "subscribed" })
      expect((yield* run["segments.get"](f.jane, { teamId: f.acme, segmentId: segment.id })).sendableCount).toBe(2)

      const bad = yield* run["segments.update"](f.jane, {
        teamId: f.acme,
        segmentId: segment.id,
        filter: { match: "all", conditions: [{ field: "nope", operator: "contains", value: "x" }] },
      }).pipe(Effect.flip)
      expect(bad._tag).toBe("InputRejected")

      const notFixed = yield* run["segments.addContacts"](f.jane, {
        teamId: f.acme,
        segmentId: segment.id,
        contactIds: [ada.id],
      }).pipe(Effect.flip)
      expect(notFixed._tag).toBe("SegmentIsDynamic")

      const readOnly = yield* run["segments.create"](f.janeReadOnlyKey, {
        teamId: f.acme,
        name: "Nope",
        kind: "fixed",
      }).pipe(Effect.flip)
      expect(readOnly).toMatchObject({ _tag: "ApiKeyScopeExcludes", needed: "email:write" })
      const listed = yield* run["segments.list"](f.janeReadOnlyKey, { teamId: f.acme })
      expect(listed.map((entry) => entry.id)).toContain(segment.id)
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("a segment has an optional description, cleared by empty or null (D141)", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const segment = yield* run["segments.create"](f.sam, {
        teamId: f.acme,
        name: `Described ${crypto.randomUUID().slice(0, 8)}`,
        description: "Customers on the annual plan",
        kind: "fixed",
      })
      expect(segment.description).toBe("Customers on the annual plan")
      const plain = yield* run["segments.create"](f.sam, { teamId: f.acme, name: `Plain ${segment.id}`, kind: "fixed" })
      expect(plain.description).toBeNull()

      const changed = yield* run["segments.update"](f.sam, {
        teamId: f.acme,
        segmentId: segment.id,
        description: "Annual and monthly",
      })
      expect(changed).toMatchObject({ description: "Annual and monthly", name: segment.name })
      // Renaming leaves it alone; an empty description clears it.
      expect(
        (yield* run["segments.update"](f.sam, { teamId: f.acme, segmentId: segment.id, name: `${segment.name}!` }))
          .description,
      ).toBe("Annual and monthly")
      expect(
        (yield* run["segments.update"](f.sam, { teamId: f.acme, segmentId: segment.id, description: "" })).description,
      ).toBeNull()
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("a fixed segment holds hand-picked contacts from its own team only", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const ada = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ada" })
      const cy = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Cy" })
      const theirs = yield* run["contacts.create"](f.bob, { teamId: f.globex, firstName: "Theirs" })
      const segment = yield* run["segments.create"](f.jane, { teamId: f.acme, name: "VIPs", kind: "fixed" })
      expect(segment).toMatchObject({ contactCount: 0, filter: null })

      const added = yield* run["segments.addContacts"](f.jane, {
        teamId: f.acme,
        segmentId: segment.id,
        contactIds: [ada.id, cy.id, ada.id],
      })
      expect(added.contactCount).toBe(2)
      const foreign = yield* run["segments.addContacts"](f.jane, {
        teamId: f.acme,
        segmentId: segment.id,
        contactIds: [theirs.id],
      }).pipe(Effect.flip)
      expect(foreign._tag).toBe("ContactNotFound")

      const removed = yield* run["segments.removeContacts"](f.jane, {
        teamId: f.acme,
        segmentId: segment.id,
        contactIds: [cy.id],
      })
      expect(removed.contactCount).toBe(1)
      // A deleted contact drops out until it's restored.
      yield* run["contacts.delete"](f.jane, { teamId: f.acme, contactId: ada.id })
      expect((yield* run["segments.get"](f.jane, { teamId: f.acme, segmentId: segment.id })).contactCount).toBe(0)

      const filtered = yield* run["segments.update"](f.jane, {
        teamId: f.acme,
        segmentId: segment.id,
        filter: { match: "all", conditions: [{ field: "name", operator: "contains", value: "A" }] },
      }).pipe(Effect.flip)
      expect(filtered._tag).toBe("InputRejected")
      yield* run["segments.delete"](f.jane, { teamId: f.acme, segmentId: segment.id })
      const gone = yield* run["segments.get"](f.jane, { teamId: f.acme, segmentId: segment.id }).pipe(Effect.flip)
      expect(gone._tag).toBe("SegmentNotFound")
    }).pipe(Effect.provide(CoreLive)),
  )
})
