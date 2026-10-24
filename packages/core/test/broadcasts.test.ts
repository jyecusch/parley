import { createHmac } from "node:crypto"
import { describe, expect, it } from "@effect/vitest"
import type { TeamId } from "@parley/domain"
import { Effect } from "effect"
import {
  BroadcastSender,
  CoreLive,
  Mailer,
  type Principal,
  receiveDeliveryEvent,
  implementations as run,
} from "../src/index.ts"
import { Fixture } from "./fixture.ts"

const unique = () => crypto.randomUUID().slice(0, 8)

/** A sending domain, sender and footer, so the team can send. */
const setUpSending = (owner: Principal, teamId: TeamId) =>
  Effect.gen(function* () {
    const domain = `send-${unique()}.example.com`
    yield* run["sendingDomains.create"](owner, { teamId, domain: domain as never })
    yield* run["emailSettings.update"](owner, {
      teamId,
      senderName: "Acme News",
      senderAddress: `news@${domain}` as never,
      legalName: "Acme Pty Ltd",
      postalAddress: "1 Market St, Sydney NSW 2000",
      footerReason: "You're getting this because you're an Acme customer.",
    })
    return domain
  })

const signed = (body: string) => {
  const id = `msg_${unique()}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const secret = Buffer.from("dGVzdC13ZWJob29rLXNlY3JldC0xMjM0NTY3ODk=", "base64")
  const signature = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64")
  return new Headers({ "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` })
}

describe("templates and broadcasts", () => {
  it.effect("drafts from a template, previews with merge tags, and test-sends to members", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const mailer = yield* Mailer
      const template = yield* run["templates.create"](f.sam, {
        teamId: f.acme,
        name: "Monthly update",
        subject: "Hi {{first_name|there}}",
        body: "# News\n\nHello **{{name}}** from {{company|your team}}. {{favorite_color}}\n\n<script>alert(1)</script>",
      })
      const contact = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Ada",
        lastName: "<Lovelace>",
        emails: [{ address: `ada-${unique()}@example.com` as never }],
      })
      const broadcast = yield* run["broadcasts.create"](f.sam, {
        teamId: f.acme,
        name: "October update",
        templateId: template.id,
      })
      expect(broadcast).toMatchObject({ status: "draft", subject: template.subject, counts: null })

      const preview = yield* run["broadcasts.preview"](f.sam, {
        teamId: f.acme,
        broadcastId: broadcast.id,
        contactId: contact.id,
      })
      expect(preview.subject).toBe("Hi Ada")
      expect(preview.html).toContain("<h1>News</h1>")
      expect(preview.html).toContain("<strong>Ada &lt;Lovelace&gt;</strong> from your team")
      expect(preview.html).toContain("&lt;script&gt;")
      expect(preview.html).not.toContain("<script>")
      expect(preview.unknownMergeTags).toEqual(["favorite_color"])
      // Without a sender set up, the footer has placeholders.
      expect(preview.text).toContain("Your legal name")

      const notReady = yield* run["broadcasts.testSend"](f.sam, { teamId: f.acme, broadcastId: broadcast.id }).pipe(
        Effect.flip,
      )
      expect(notReady._tag).toBe("SenderNotReady")
      yield* setUpSending(f.jane, f.acme)
      const tested = yield* run["broadcasts.testSend"](f.sam, { teamId: f.acme, broadcastId: broadcast.id })
      expect(tested.sentTo).toHaveLength(1)
      const sent = (yield* mailer.outbox).at(-1)
      expect(sent?.subject).toBe("[Test] Hi Sam")
      expect(sent?.from).toMatch(/^Acme News <news@send-[a-f0-9]+\.example\.com>$/)
      expect(sent?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
      expect(sent?.text).toContain("Acme Pty Ltd · 1 Market St, Sydney NSW 2000")

      const outsider = yield* run["broadcasts.testSend"](f.jane, {
        teamId: f.acme,
        broadcastId: broadcast.id,
        userIds: [f.bob.userId],
      }).pipe(Effect.flip)
      expect(outsider._tag).toBe("TestRecipientNotMember")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("sends to a segment's subscribed contacts, skips the rest, and records what happened", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const mailer = yield* Mailer
      const sender = yield* BroadcastSender
      yield* setUpSending(f.jane, f.acme)
      const tag = unique()
      const make = (firstName: string, extra: object = {}) =>
        run["contacts.create"](f.jane, {
          teamId: f.acme,
          firstName,
          emails: [{ address: `${firstName.toLowerCase()}-${tag}@example.com` as never }],
          ...extra,
        })
      const ada = yield* make("Ada")
      const bo = yield* make("Bo", { subscriptionStatus: "unsubscribed" })
      const cy = yield* make("Cy")
      const topic = yield* run["topics.create"](f.jane, { teamId: f.acme, name: `News ${tag}` })
      yield* run["contacts.updateSubscriptions"](f.jane, {
        teamId: f.acme,
        contactId: cy.id,
        topics: [{ topicId: topic.id, subscribed: false }],
      })
      const segment = yield* run["segments.create"](f.jane, {
        teamId: f.acme,
        name: "Tagged",
        kind: "dynamic",
        filter: { match: "all", conditions: [{ field: "email", operator: "contains", value: tag }] },
      })
      const broadcast = yield* run["broadcasts.create"](f.jane, {
        teamId: f.acme,
        name: "Launch",
        segmentId: segment.id,
        topicId: topic.id,
      })

      const incomplete = yield* run["broadcasts.send"](f.jane, { teamId: f.acme, broadcastId: broadcast.id }).pipe(
        Effect.flip,
      )
      expect(incomplete).toMatchObject({ _tag: "BroadcastIncomplete", missing: ["subject", "body"] })
      yield* run["broadcasts.update"](f.jane, {
        teamId: f.acme,
        broadcastId: broadcast.id,
        subject: "We launched, {{first_name}}",
        body: "It's out.",
      })
      const memberCant = yield* run["broadcasts.send"](f.sam, { teamId: f.acme, broadcastId: broadcast.id }).pipe(
        Effect.flip,
      )
      expect(memberCant).toMatchObject({ _tag: "RoleLacksPermission", needed: "email:send" })

      const sending = yield* run["broadcasts.send"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      expect(sending.status).toBe("sending")
      expect(sending.counts).toMatchObject({ recipients: 3, queued: 1, skipped: 2 })
      const again = yield* run["broadcasts.update"](f.jane, {
        teamId: f.acme,
        broadcastId: broadcast.id,
        name: "Too late",
      }).pipe(Effect.flip)
      expect(again).toMatchObject({ _tag: "BroadcastNotDraft", status: "sending" })

      yield* sender.drain
      const done = yield* run["broadcasts.get"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      expect(done).toMatchObject({
        status: "sent",
        sentByName: "Jane",
        segmentName: "Tagged",
        topicName: `News ${tag}`,
      })
      expect(done.counts).toMatchObject({ sent: 1, skipped: 2 })
      const email = (yield* mailer.outbox).find((message) => message.to === `ada-${tag}@example.com`)
      expect(email?.subject).toBe("We launched, Ada")
      expect(email?.headers?.["List-Unsubscribe"]).toMatch(/^<.*\/api\/unsubscribe\/.+>$/)

      const recipients = yield* run["broadcasts.recipients"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      expect(recipients.items.map((item) => [item.name, item.status, item.skipReason])).toEqual([
        ["Ada", "sent", null],
        ["Bo", "skipped", "unsubscribed"],
        ["Cy", "skipped", "unsubscribed-from-topic"],
      ])
      const activity = yield* run["contacts.activity"](f.jane, { teamId: f.acme, contactId: ada.id })
      expect(activity.at(-1)).toMatchObject({ kind: "emailed", actorName: "Jane", related: { name: "Launch" } })
      void bo

      // The provider reports a bounce: the contact stops getting broadcasts.
      const body = JSON.stringify({ type: "email.bounced", data: { email_id: "unknown" } })
      expect(yield* receiveDeliveryEvent(new Headers(), body)).toBe("refused")
      expect(yield* receiveDeliveryEvent(signed(body), body)).toBe("accepted")

      const copy = yield* run["broadcasts.duplicate"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      expect(copy).toMatchObject({ status: "draft", name: "Launch (copy)", subject: "We launched, {{first_name}}" })
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("cancels the rest of a sending, and refuses a segment nobody can be sent", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      yield* setUpSending(f.jane, f.acme)
      const empty = yield* run["segments.create"](f.jane, { teamId: f.acme, name: "Empty", kind: "fixed" })
      const broadcast = yield* run["broadcasts.create"](f.jane, {
        teamId: f.acme,
        name: "Nobody",
        segmentId: empty.id,
        subject: "Hello",
        body: "Hi",
      })
      const nobody = yield* run["broadcasts.send"](f.jane, { teamId: f.acme, broadcastId: broadcast.id }).pipe(
        Effect.flip,
      )
      expect(nobody._tag).toBe("SegmentHasNoRecipients")
      expect((yield* run["broadcasts.get"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })).status).toBe("draft")

      const contact = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Dee",
        emails: [{ address: `dee-${unique()}@example.com` as never }],
      })
      yield* run["segments.addContacts"](f.jane, { teamId: f.acme, segmentId: empty.id, contactIds: [contact.id] })
      yield* run["broadcasts.send"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      const canceled = yield* run["broadcasts.cancel"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      expect(canceled.status).toBe("canceled")
      expect(canceled.counts).toMatchObject({ canceled: 1, sent: 0 })
      const twice = yield* run["broadcasts.cancel"](f.jane, { teamId: f.acme, broadcastId: broadcast.id }).pipe(
        Effect.flip,
      )
      expect(twice._tag).toBe("BroadcastNotSending")
      const kept = yield* run["broadcasts.delete"](f.jane, { teamId: f.acme, broadcastId: broadcast.id }).pipe(
        Effect.flip,
      )
      expect(kept._tag).toBe("BroadcastNotDraft")
    }).pipe(Effect.provide(CoreLive)),
  )
})
