import { describe, expect, it } from "@effect/vitest"
import { Database } from "@parley/db"
import type { ContactId, TopicId } from "@parley/domain"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import {
  CoreLive,
  Mailer,
  implementations as run,
  UnsubscribeLinks,
  unsubscribeApply,
  unsubscribePage,
} from "../src/index.ts"
import { Fixture } from "./fixture.ts"

const unique = () => crypto.randomUUID().slice(0, 8)

describe("email setup", () => {
  it.effect("rotates the unsubscribe secret: links signed with a previous one still work", () =>
    Effect.gen(function* () {
      const linksWith = (config: Record<string, string>) =>
        Effect.provide(
          Effect.gen(function* () {
            return yield* UnsubscribeLinks
          }),
          Layer.fresh(UnsubscribeLinks.layer).pipe(
            Layer.provide(
              ConfigProvider.layer(
                ConfigProvider.fromUnknown({
                  BETTER_AUTH_SECRET: "test",
                  BETTER_AUTH_URL: "https://parley.test",
                  ...config,
                }),
              ),
            ),
          ),
        )
      const facts = { teamId: "team" as never, contactId: null, topicId: null, broadcastId: null, test: false }
      const old = yield* linksWith({ UNSUBSCRIBE_SECRET: "old-secret" })
      const sent = old.sign(facts)

      const rotated = yield* linksWith({ UNSUBSCRIBE_SECRET: "new-secret", UNSUBSCRIBE_SECRETS_PREVIOUS: "old-secret" })
      expect(rotated.read(sent)).toEqual(facts)
      expect(rotated.sign(facts)).not.toBe(sent)
      expect(rotated.read(rotated.sign(facts))).toEqual(facts)

      const forgotten = yield* linksWith({ UNSUBSCRIBE_SECRET: "new-secret" })
      expect(forgotten.read(sent)).toBeUndefined()
    }),
  )

  it.effect("sets up senders on verified sending domains, for admins only", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const mailer = yield* Mailer
      const domain = `mail-${unique()}.example.com`
      const other = `labs-${unique()}.example.com`
      expect(yield* run["senders.list"](f.jane, { teamId: f.acme })).toEqual([])

      // A member can draft but not change senders.
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
      yield* run["sendingDomains.create"](f.jane, { teamId: f.acme, domain: other as never })

      const fields = { legalName: "Acme Pty Ltd", postalAddress: "1 Market St, Sydney NSW 2000" }
      const offDomain = yield* run["senders.create"](f.jane, {
        teamId: f.acme,
        name: "Acme",
        address: "news@elsewhere.example" as never,
        ...fields,
      }).pipe(Effect.flip)
      expect(offDomain._tag).toBe("SenderAddressNotOnSendingDomain")

      // The first sender is the default; the next isn't, unless asked.
      const acme = yield* run["senders.create"](f.jane, {
        teamId: f.acme,
        name: "Acme",
        address: `Hello@${domain}` as never,
        ...fields,
      })
      expect(acme).toMatchObject({ address: `hello@${domain}`, isDefault: true, ready: true })
      const labs = yield* run["senders.create"](f.jane, {
        teamId: f.acme,
        name: "Acme Labs",
        address: `team@${other}` as never,
        replyTo: `support@${other}` as never,
        legalName: "Acme Labs Inc",
        postalAddress: "500 Howard St, San Francisco CA 94105",
      })
      expect(labs.isDefault).toBe(false)

      // A broadcast without a sender goes out as the default; one with a sender, as that sender.
      const broadcast = yield* run["broadcasts.create"](f.sam, {
        teamId: f.acme,
        name: "Labs news",
        subject: "Hi",
        body: "News",
      })
      expect(broadcast.senderId).toBeNull()
      yield* run["broadcasts.testSend"](f.sam, { teamId: f.acme, broadcastId: broadcast.id })
      expect((yield* mailer.outbox).at(-1)?.from).toBe(`Acme <hello@${domain}>`)
      const outsider = yield* run["broadcasts.update"](f.sam, {
        teamId: f.acme,
        broadcastId: broadcast.id,
        senderId: (yield* run["senders.list"](f.bob, { teamId: f.globex }))[0]?.id ?? (crypto.randomUUID() as never),
      }).pipe(Effect.flip)
      expect(outsider._tag).toBe("SenderNotFound")
      yield* run["broadcasts.update"](f.sam, { teamId: f.acme, broadcastId: broadcast.id, senderId: labs.id })
      yield* run["broadcasts.testSend"](f.sam, { teamId: f.acme, broadcastId: broadcast.id })
      const sent = (yield* mailer.outbox).at(-1)
      expect(sent).toMatchObject({ from: `Acme Labs <team@${other}>`, replyTo: `support@${other}` })
      expect(sent?.text).toContain("Acme Labs Inc · 500 Howard St")
      // The unsubscribe page names the sender the email came from; a link without a broadcast, the default.
      const links = yield* UnsubscribeLinks
      const fromLabs = links.sign({
        teamId: f.acme,
        contactId: null,
        topicId: null,
        broadcastId: broadcast.id,
        test: true,
      })
      expect((yield* unsubscribePage(fromLabs)).senderName).toBe("Acme Labs Inc")
      const fromTeam = links.sign({ teamId: f.acme, contactId: null, topicId: null, broadcastId: null, test: true })
      expect((yield* unsubscribePage(fromTeam)).senderName).toBe("Acme Pty Ltd")

      // A form can pick the sender too; the list counts what uses each.
      const form = yield* run["forms.create"](f.jane, { teamId: f.acme, name: "Beta", template: "blank" })
      yield* run["forms.update"](f.jane, {
        teamId: f.acme,
        formId: form.id,
        draft: { ...form.draft, senderId: labs.id },
      })
      const listed = yield* run["senders.list"](f.jane, { teamId: f.acme })
      expect(listed.map((entry) => [entry.name, entry.isDefault, entry.usedBy])).toEqual([
        ["Acme", true, { forms: 0, broadcasts: 0 }],
        ["Acme Labs", false, { forms: 1, broadcasts: 1 }],
      ])

      // The default can't be deleted; another can, and what used it goes back to the default.
      const isDefault = yield* run["senders.delete"](f.jane, { teamId: f.acme, senderId: acme.id }).pipe(Effect.flip)
      expect(isDefault._tag).toBe("SenderIsDefault")
      yield* run["senders.delete"](f.jane, { teamId: f.acme, senderId: labs.id })
      expect((yield* run["broadcasts.get"](f.sam, { teamId: f.acme, broadcastId: broadcast.id })).senderId).toBeNull()
      expect((yield* run["forms.get"](f.jane, { teamId: f.acme, formId: form.id })).draft.senderId).toBeNull()

      // Changing the default changes who default broadcasts come from.
      const news = yield* run["senders.create"](f.jane, {
        teamId: f.acme,
        name: "Acme News",
        address: `news@${domain}` as never,
        ...fields,
        isDefault: true,
      })
      expect(news.isDefault).toBe(true)
      const [first] = yield* run["senders.list"](f.jane, { teamId: f.acme })
      expect(first?.id).toBe(news.id)
      yield* run["senders.update"](f.jane, { teamId: f.acme, senderId: news.id, name: "Acme Updates" })
      yield* run["broadcasts.testSend"](f.sam, { teamId: f.acme, broadcastId: broadcast.id })
      expect((yield* mailer.outbox).at(-1)?.from).toBe(`Acme Updates <news@${domain}>`)

      // Removing the domain leaves its senders unable to send.
      yield* run["sendingDomains.delete"](f.jane, { teamId: f.acme, sendingDomainId: added.id })
      expect((yield* run["senders.list"](f.jane, { teamId: f.acme })).every((entry) => !entry.ready)).toBe(true)
      const notReady = yield* run["broadcasts.testSend"](f.sam, { teamId: f.acme, broadcastId: broadcast.id }).pipe(
        Effect.flip,
      )
      expect(notReady).toMatchObject({ _tag: "SenderNotReady", missing: "verified-domain" })
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
        broadcastId: null,
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
      const test = links.sign({ teamId: f.acme, contactId: null, topicId: null, broadcastId: null, test: true })
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

  it.effect("an unverified domain claim lapses, so another team can take the domain", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const db = yield* Database
      const domain = `claim-${unique()}.example.com`
      const squatted = yield* run["sendingDomains.create"](f.bob, { teamId: f.globex, domain: domain as never })
      const fresh = yield* run["sendingDomains.create"](f.jane, { teamId: f.acme, domain: domain as never }).pipe(
        Effect.flip,
      )
      expect(fresh._tag).toBe("SendingDomainTaken")
      // Pretend Globex never verified it, and added it four days ago.
      yield* db.query((d) =>
        d.execute(
          sql`update "sending_domains" set status = 'pending', created_at = now() - interval '4 days' where id = ${squatted.id}`,
        ),
      )
      const taken = yield* run["sendingDomains.create"](f.jane, { teamId: f.acme, domain: domain as never })
      expect(taken.domain).toBe(domain)
      expect(yield* run["sendingDomains.list"](f.bob, { teamId: f.globex })).not.toContainEqual(
        expect.objectContaining({ domain }),
      )
    }).pipe(Effect.provide(CoreLive)),
  )
})
