import { describe, expect, it } from "@effect/vitest"
import type { ContactId, TopicId } from "@parley/domain"
import { Effect } from "effect"
import { CoreLive, implementations as run, UnsubscribeLinks, unsubscribeApply, unsubscribePage } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

const unique = () => crypto.randomUUID().slice(0, 8)

describe("email setup", () => {
  it.effect("sets up a sender and footer on a verified sending domain, for admins only", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const domain = `mail-${unique()}.example.com`
      const before = yield* run["emailSettings.get"](f.jane, { teamId: f.acme })
      expect(before.missing).toEqual(["sender-name", "sender-address", "legal-name", "postal-address", "footer-reason"])

      // A member can draft but not change the sender.
      const denied = yield* run["sendingDomains.create"](f.sam, { teamId: f.acme, domain: domain as never }).pipe(
        Effect.flip,
      )
      expect(denied).toMatchObject({ _tag: "RoleLacksPermission", needed: "email:manage" })

      const added = yield* run["sendingDomains.create"](f.jane, {
        teamId: f.acme,
        domain: domain.toUpperCase() as never,
      })
      // Without RESEND_API_KEY every domain counts as verified (R44).
      expect(added).toMatchObject({ domain, status: "verified" })
      const taken = yield* run["sendingDomains.create"](f.bob, { teamId: f.globex, domain: domain as never }).pipe(
        Effect.flip,
      )
      expect(taken._tag).toBe("SendingDomainTaken")

      const offDomain = yield* run["emailSettings.update"](f.jane, {
        teamId: f.acme,
        senderAddress: "news@elsewhere.example" as never,
      }).pipe(Effect.flip)
      expect(offDomain._tag).toBe("SenderAddressNotOnSendingDomain")

      const ready = yield* run["emailSettings.update"](f.jane, {
        teamId: f.acme,
        senderName: "Acme",
        senderAddress: `news@${domain}` as never,
        legalName: "Acme Pty Ltd",
        postalAddress: "1 Market St, Sydney NSW 2000",
        footerReason: "You're getting this because you're an Acme customer.",
      })
      expect(ready.missing).toEqual([])

      // Removing the domain makes the sender address unusable again.
      yield* run["sendingDomains.delete"](f.jane, { teamId: f.acme, sendingDomainId: added.id })
      const after = yield* run["emailSettings.get"](f.jane, { teamId: f.acme })
      expect(after.missing).toEqual(["verified-domain"])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("tracks subscription status and topics, with activity, and filters on them", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const contact = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Sam",
        emails: [{ address: `sam-${unique()}@example.com` as never }],
      })
      expect(contact.subscriptionStatus).toBe("subscribed")
      const product = yield* run["topics.create"](f.jane, { teamId: f.acme, name: "Product updates" })
      const events = yield* run["topics.create"](f.jane, { teamId: f.acme, name: "Events" })

      const left = yield* run["contacts.updateSubscriptions"](f.sam, {
        teamId: f.acme,
        contactId: contact.id,
        topics: [{ topicId: product.id, subscribed: false }],
      })
      expect(left.topics).toEqual([
        { topicId: events.id, name: "Events", subscribed: true },
        { topicId: product.id, name: "Product updates", subscribed: false },
      ])
      const otherTeams = yield* run["contacts.updateSubscriptions"](f.jane, {
        teamId: f.acme,
        contactId: contact.id,
        topics: [{ topicId: crypto.randomUUID() as TopicId, subscribed: false }],
      }).pipe(Effect.flip)
      expect(otherTeams._tag).toBe("TopicNotFound")

      const unsubscribed = yield* run["contacts.update"](f.jane, {
        teamId: f.acme,
        contactId: contact.id,
        subscriptionStatus: "unsubscribed",
      })
      expect(unsubscribed.subscriptionStatus).toBe("unsubscribed")
      const activity = yield* run["contacts.activity"](f.jane, { teamId: f.acme, contactId: contact.id })
      expect(activity.map((entry) => [entry.kind, entry.topicName])).toEqual([
        ["created", null],
        ["unsubscribed", "Product updates"],
        ["unsubscribed", null],
      ])

      const filtered = yield* run["contacts.list"](f.jane, {
        teamId: f.acme,
        filter: {
          match: "all",
          conditions: [{ field: "subscriptionStatus", operator: "is-any-of", value: ["unsubscribed"] }],
        },
      })
      expect(filtered.items.map((item) => item.id)).toContain(contact.id)
      const topics = yield* run["topics.list"](f.jane, { teamId: f.acme })
      expect(topics.find((topic) => topic.id === product.id)?.unsubscribedCount).toBe(1)
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("unsubscribes through a signed link: one click leaves the topic, and tampering fails", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const links = yield* UnsubscribeLinks
      const address = `ada-${unique()}@example.com`
      const contact = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Ada",
        emails: [{ address: address as never }],
      })
      const topic = yield* run["topics.create"](f.jane, { teamId: f.acme, name: "Newsletter" })
      const token = links.sign({
        teamId: f.acme,
        contactId: contact.id as ContactId,
        topicId: topic.id,
        campaignId: null,
        test: false,
      })
      expect(links.urls(token).oneClick).toMatch(/\/api\/unsubscribe\//)

      const page = yield* unsubscribePage(token)
      expect(page).toMatchObject({ status: "subscribed", topicId: topic.id, test: false })
      expect(page.address).toMatch(/^a\*+@example\.com$/)

      const clicked = yield* unsubscribeApply(token, { kind: "one-click" })
      expect(clicked.status).toBe("subscribed")
      expect(clicked.topics.find((entry) => entry.id === topic.id)?.subscribed).toBe(false)
      const all = yield* unsubscribeApply(token, { kind: "all", subscribed: false })
      expect(all.status).toBe("unsubscribed")
      const activity = yield* run["contacts.activity"](f.jane, { teamId: f.acme, contactId: contact.id })
      expect(activity.slice(1).map((entry) => [entry.kind, entry.actorName, entry.via, entry.topicName])).toEqual([
        ["unsubscribed", "Ada", "unsubscribe link", "Newsletter"],
        ["unsubscribed", "Ada", "unsubscribe link", null],
      ])

      const tampered = `${token.slice(0, -2)}xx`
      const invalid = yield* unsubscribePage(tampered).pipe(Effect.flip)
      expect(invalid._tag).toBe("UnsubscribeLinkInvalid")

      // A test send's link changes nothing (R45).
      const test = links.sign({ teamId: f.acme, contactId: null, topicId: null, campaignId: null, test: true })
      expect((yield* unsubscribeApply(test, { kind: "one-click" })).test).toBe(true)
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("subscribing someone again after they opted out takes email:manage, and import never does it", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const address = `optout-${unique()}@example.com`
      const contact = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Opal",
        emails: [{ address: address as never }],
        subscriptionStatus: "unsubscribed",
      })
      const member = yield* run["contacts.update"](f.sam, {
        teamId: f.acme,
        contactId: contact.id,
        subscriptionStatus: "subscribed",
      }).pipe(Effect.flip)
      expect(member).toMatchObject({ _tag: "RoleLacksPermission", needed: "email:manage" })

      const imported = yield* run["contacts.import"](f.jane, {
        teamId: f.acme,
        csv: `Email,Subscription status\n${address},Subscribed\n`,
      })
      expect(imported.updated).toBe(1)
      const after = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: contact.id })
      expect(after.subscriptionStatus).toBe("unsubscribed")

      const admin = yield* run["contacts.update"](f.jane, {
        teamId: f.acme,
        contactId: contact.id,
        subscriptionStatus: "subscribed",
      })
      expect(admin.subscriptionStatus).toBe("subscribed")
    }).pipe(Effect.provide(CoreLive)),
  )
})
