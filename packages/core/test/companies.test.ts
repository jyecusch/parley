import { describe, expect, it } from "@effect/vitest"
import type { CompanyId, ContactId } from "@parley/domain"
import { Effect } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

const email = (address: string) => ({ address: address as never })
const domain = (name: string) => ({ domain: name as never })

describe("companies operations", () => {
  it.effect("create, update, delete and restore, with domains normalized and released", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const acme = yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Acme",
        domains: [domain("WWW.Acme.COM"), domain("acme.co.uk")],
        address: { line1: "1 Market St", line2: null, city: "Sydney", region: "NSW", postcode: "2000", country: "AU" },
      })
      expect(acme.domains).toEqual([
        { domain: "acme.com", isPrimary: true },
        { domain: "acme.co.uk", isPrimary: false },
      ])
      expect(acme.address?.city).toBe("Sydney")

      const renamed = yield* run["companies.update"](f.jane, { teamId: f.acme, companyId: acme.id, name: "Acme Corp" })
      expect(renamed.name).toBe("Acme Corp")
      const found = yield* run["companies.list"](f.jane, { teamId: f.acme, search: "acme.co.uk" })
      expect(found.items.map((company) => company.id)).toEqual([acme.id])

      const taken = yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Impostor",
        domains: [domain("acme.com")],
      }).pipe(Effect.flip)
      expect(taken).toMatchObject({ _tag: "CompanyDomainTaken", existing: acme.id, existingName: "Acme Corp" })

      yield* run["companies.delete"](f.jane, { teamId: f.acme, companyId: acme.id })
      const gone = yield* run["companies.get"](f.jane, { teamId: f.acme, companyId: acme.id }).pipe(Effect.flip)
      expect(gone._tag).toBe("CompanyNotFound")
      // Deleting released the domain, so another company can take it, which blocks restoring.
      const other = yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Other",
        domains: [domain("acme.com")],
      })
      const blocked = yield* run["companies.restore"](f.jane, { teamId: f.acme, companyId: acme.id }).pipe(Effect.flip)
      expect(blocked._tag).toBe("CompanyDomainTaken")
      yield* run["companies.delete"](f.jane, { teamId: f.acme, companyId: other.id })
      const restored = yield* run["companies.restore"](f.jane, { teamId: f.acme, companyId: acme.id })
      expect(restored.deletedAt).toBeNull()

      const activity = yield* run["companies.activity"](f.jane, { teamId: f.acme, companyId: acme.id })
      expect(activity.map((entry) => entry.kind)).toEqual(["created", "updated", "deleted", "restored"])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("never lets a free email domain belong to a company", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const rejected = yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Gmail fans",
        domains: [domain("gmail.com")],
      }).pipe(Effect.flip)
      expect(rejected).toMatchObject({ _tag: "FreeEmailDomain", domain: "gmail.com" })
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("domain matching affiliates both ways, and a removed affiliation stays removed", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const sam = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Sam",
        emails: [email("sam@northwind.io")],
      })
      const gmailUser = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Gee",
        emails: [email("gee@gmail.com")],
      })

      // A company getting a domain picks up existing contacts on it.
      const northwind = yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Northwind",
        domains: [domain("northwind.io")],
      })
      expect(northwind.contactCount).toBe(1)
      const samNow = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: sam.id })
      expect(samNow.affiliations).toMatchObject([{ companyId: northwind.id, companyName: "Northwind", title: null }])
      const gmailNow = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: gmailUser.id })
      expect(gmailNow.affiliations).toEqual([])

      // A contact getting an email picks up the company with that domain.
      const jo = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Jo",
        emails: [email("Jo@Northwind.io")],
      })
      expect(jo.affiliations.map((affiliation) => affiliation.companyId)).toEqual([northwind.id])

      const activity = yield* run["contacts.activity"](f.jane, { teamId: f.acme, contactId: sam.id })
      expect(activity.at(-1)).toMatchObject({
        kind: "affiliated",
        reason: "domain-matching",
        matchedDomain: "northwind.io",
        related: { recordType: "company", id: northwind.id, name: "Northwind" },
        actorName: "Jane",
      })

      // Removing an affiliation sticks, through edits that don't add an email (D107).
      const [samLink] = samNow.affiliations
      yield* run["affiliations.delete"](f.jane, { teamId: f.acme, affiliationId: samLink?.id ?? ("" as never) })
      const edited = yield* run["contacts.update"](f.jane, {
        teamId: f.acme,
        contactId: sam.id,
        lastName: "Leigh",
        emails: [email("sam@northwind.io")],
      })
      expect(edited.affiliations).toEqual([])
      const companyActivity = yield* run["companies.activity"](f.jane, { teamId: f.acme, companyId: northwind.id })
      expect(companyActivity.map((entry) => entry.kind)).toContain("unaffiliated")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("affiliations: idempotent create with titles, and hidden while a side is deleted", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const contact = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ana" })
      const company = yield* run["companies.create"](f.jane, { teamId: f.acme, name: "Helio" })
      const first = yield* run["affiliations.create"](f.jane, {
        teamId: f.acme,
        contactId: contact.id,
        companyId: company.id,
      })
      expect(first.title).toBeNull()
      // Affiliating again returns the same affiliation and takes the given title (D43).
      const again = yield* run["affiliations.create"](f.jane, {
        teamId: f.acme,
        contactId: contact.id,
        companyId: company.id,
        title: "CTO",
      })
      expect(again).toMatchObject({ id: first.id, title: "CTO", contactName: "Ana", companyName: "Helio" })
      const retitled = yield* run["affiliations.update"](f.jane, {
        teamId: f.acme,
        affiliationId: first.id,
        title: "CEO",
      })
      expect(retitled.title).toBe("CEO")

      const listed = yield* run["affiliations.list"](f.jane, { teamId: f.acme, companyId: company.id })
      expect(listed.map((affiliation) => affiliation.id)).toEqual([first.id])

      // Deleting the company hides the affiliation; restoring brings it back (D109).
      yield* run["companies.delete"](f.jane, { teamId: f.acme, companyId: company.id })
      const hidden = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: contact.id })
      expect(hidden.affiliations).toEqual([])
      const missing = yield* run["affiliations.update"](f.jane, {
        teamId: f.acme,
        affiliationId: first.id,
        title: null,
      }).pipe(Effect.flip)
      expect(missing._tag).toBe("AffiliationNotFound")
      yield* run["companies.restore"](f.jane, { teamId: f.acme, companyId: company.id })
      const back = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: contact.id })
      expect(back.affiliations).toMatchObject([{ id: first.id, title: "CEO" }])

      // A deleted contact doesn't count towards the company.
      yield* run["contacts.delete"](f.jane, { teamId: f.acme, contactId: contact.id })
      const counted = yield* run["companies.get"](f.jane, { teamId: f.acme, companyId: company.id })
      expect(counted.contactCount).toBe(0)
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("never reaches across teams, and respects API key scopes", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const theirs = yield* run["companies.create"](f.bob, { teamId: f.globex, name: "Secret" })
      const mine = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Mo" })
      const crossTeam = yield* run["affiliations.create"](f.jane, {
        teamId: f.acme,
        contactId: mine.id,
        companyId: theirs.id as CompanyId,
      }).pipe(Effect.flip)
      expect(crossTeam._tag).toBe("CompanyNotFound")
      const notMine = yield* run["companies.get"](f.jane, { teamId: f.globex, companyId: theirs.id }).pipe(Effect.flip)
      expect(notMine._tag).toBe("NotATeamMember")

      const readOnly = yield* run["companies.create"](f.janeReadOnlyKey, { teamId: f.acme, name: "Nope" }).pipe(
        Effect.flip,
      )
      expect(readOnly._tag).toBe("ApiKeyScopeExcludes")
      const missingContact = yield* run["affiliations.create"](f.jane, {
        teamId: f.acme,
        contactId: crypto.randomUUID() as ContactId,
        companyId: theirs.id,
      }).pipe(Effect.flip)
      expect(missingContact._tag).toBe("ContactNotFound")
    }).pipe(Effect.provide(CoreLive)),
  )
})
