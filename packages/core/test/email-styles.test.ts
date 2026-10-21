import { describe, expect, it } from "@effect/vitest"
import { Database, schema } from "@parley/db"
import { type ContactId, PLAIN_COLORS, type TeamId } from "@parley/domain"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import sharp from "sharp"
import {
  BroadcastSender,
  CoreLive,
  type Principal,
  implementations as run,
  UnsubscribeLinks,
  unsubscribeApply,
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
  })

const BLUE = { ...PLAIN_COLORS, background: "#EEF1F6", link: "#2F5BEA", button: "#2F5BEA" }

describe("email styles", () => {
  it.effect("every team has a plain default; the default moves, and can't be deleted", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const [plain, ...others] = yield* run["emailStyles.list"](f.sam, { teamId: f.acme })
      expect(others).toEqual([])
      expect(plain).toMatchObject({ name: "Plain", isDefault: true, layout: "plain", font: "default", logoUrl: null })
      expect(plain?.colors).toEqual(PLAIN_COLORS)

      const newsletter = yield* run["emailStyles.create"](f.jane, {
        teamId: f.acme,
        name: "Product newsletter",
        layout: "card",
        colors: BLUE,
        headerText: "The Acme newsletter",
      })
      expect(newsletter).toMatchObject({ isDefault: false, layout: "card", font: "default", logoAlign: "left" })
      expect(newsletter.colors).toEqual(BLUE)

      const made = yield* run["emailStyles.setDefault"](f.jane, { teamId: f.acme, styleId: newsletter.id })
      expect(made.isDefault).toBe(true)
      const after = yield* run["emailStyles.list"](f.jane, { teamId: f.acme })
      expect(after.filter((style) => style.isDefault).map((style) => style.id)).toEqual([newsletter.id])

      const refused = yield* run["emailStyles.delete"](f.jane, { teamId: f.acme, styleId: newsletter.id }).pipe(
        Effect.flip,
      )
      expect(refused._tag).toBe("EmailStyleIsDefault")
      const deleted = yield* run["emailStyles.delete"](f.jane, { teamId: f.acme, styleId: plain?.id as never })
      expect(deleted.name).toBe("Plain")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("members see styles but only admins change them; custom HTML needs {{content}}", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const memberCant = yield* run["emailStyles.create"](f.sam, { teamId: f.acme, name: "Mine" }).pipe(Effect.flip)
      expect(memberCant).toMatchObject({ _tag: "RoleLacksPermission", needed: "email:manage" })

      const noSlot = yield* run["emailStyles.create"](f.jane, {
        teamId: f.acme,
        name: "Event invite",
        layout: "custom",
        customHtml: "<div>No body here</div>",
      }).pipe(Effect.flip)
      expect(noSlot._tag).toBe("CustomHtmlMissingContent")
      const invite = yield* run["emailStyles.create"](f.jane, {
        teamId: f.acme,
        name: "Event invite",
        layout: "custom",
        customHtml: "<div>{{ content }}</div>",
      })
      // Switching to custom without HTML would leave nowhere for the body.
      const plainNow = yield* run["emailStyles.update"](f.jane, {
        teamId: f.acme,
        styleId: invite.id,
        layout: "plain",
        customHtml: null,
      })
      const backToCustom = yield* run["emailStyles.update"](f.jane, {
        teamId: f.acme,
        styleId: plainNow.id,
        layout: "custom",
      }).pipe(Effect.flip)
      expect(backToCustom._tag).toBe("CustomHtmlMissingContent")

      const elsewhere = yield* run["emailStyles.get"](f.bob, { teamId: f.globex, styleId: invite.id }).pipe(Effect.flip)
      expect(elsewhere._tag).toBe("EmailStyleNotFound")

      const preview = yield* run["emailStyles.preview"](f.sam, { teamId: f.acme, styleId: invite.id })
      expect(preview.subject).toBe("A preview of this email style")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("stores a logo as a hosted email image, and removes it", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const png = yield* Effect.tryPromise(() =>
        sharp({ create: { width: 40, height: 20, channels: 3, background: "#2f5bea" } })
          .png()
          .toBuffer(),
      ).pipe(Effect.orDie)
      const style = yield* run["emailStyles.create"](f.jane, {
        teamId: f.acme,
        name: "With logo",
        logo: png.toString("base64"),
        logoAlign: "center",
      })
      expect(style.logoUrl).toMatch(/\/i\/[0-9a-f-]+/)
      expect(style.logoAlign).toBe("center")
      const removed = yield* run["emailStyles.update"](f.jane, { teamId: f.acme, styleId: style.id, logo: null })
      expect(removed.logoUrl).toBeNull()
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("templates and broadcasts choose a style; a style in use can't be deleted", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const newsletter = yield* run["emailStyles.create"](f.jane, { teamId: f.acme, name: "Newsletter" })
      const template = yield* run["templates.create"](f.sam, {
        teamId: f.acme,
        name: "Monthly",
        styleId: newsletter.id,
      })
      expect(template.styleId).toBe(newsletter.id)
      const fromTemplate = yield* run["broadcasts.create"](f.sam, {
        teamId: f.acme,
        name: "October",
        templateId: template.id,
      })
      expect(fromTemplate.styleId).toBe(newsletter.id)
      const overridden = yield* run["broadcasts.create"](f.sam, {
        teamId: f.acme,
        name: "October, plain",
        templateId: template.id,
        styleId: null,
      })
      expect(overridden.styleId).toBeNull()
      const copy = yield* run["broadcasts.duplicate"](f.sam, { teamId: f.acme, broadcastId: fromTemplate.id })
      expect(copy.styleId).toBe(newsletter.id)

      const foreign = yield* run["emailStyles.list"](f.bob, { teamId: f.globex })
      const notOurs = yield* run["templates.update"](f.sam, {
        teamId: f.acme,
        templateId: template.id,
        styleId: foreign[0]?.id as never,
      }).pipe(Effect.flip)
      expect(notOurs._tag).toBe("EmailStyleNotFound")

      const [listed] = (yield* run["emailStyles.list"](f.jane, { teamId: f.acme })).filter(
        (style) => style.id === newsletter.id,
      )
      expect(listed?.usedBy).toEqual({ templates: 1, broadcasts: 2 })
      const inUse = yield* run["emailStyles.delete"](f.jane, { teamId: f.acme, styleId: newsletter.id }).pipe(
        Effect.flip,
      )
      expect(inUse).toMatchObject({ _tag: "EmailStyleInUse", templates: 1, broadcasts: 2 })

      const preview = yield* run["templates.preview"](f.sam, {
        teamId: f.acme,
        templateId: template.id,
        styleId: null,
      })
      expect(preview.html).toContain("<html")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("a sent broadcast keeps the look it was sent with, and reports who unsubscribed", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const db = yield* Database
      const sender = yield* BroadcastSender
      const links = yield* UnsubscribeLinks
      yield* setUpSending(f.jane, f.acme)
      const style = yield* run["emailStyles.create"](f.jane, {
        teamId: f.acme,
        name: "Launch",
        layout: "card",
        headerText: "Launch day",
        colors: BLUE,
      })
      const tag = unique()
      const make = (firstName: string) =>
        run["contacts.create"](f.jane, {
          teamId: f.acme,
          firstName,
          emails: [{ address: `${firstName.toLowerCase()}-${tag}@example.com` as never }],
        })
      const ada = yield* make("Ada")
      const bo = yield* make("Bo")
      yield* make("Cy")
      const topic = yield* run["topics.create"](f.jane, { teamId: f.acme, name: `News ${tag}` })
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
        styleId: style.id,
        subject: "We launched",
        body: "It's out.",
      })
      yield* run["broadcasts.send"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      yield* sender.drain

      // Editing the style afterwards doesn't change what was sent.
      yield* run["emailStyles.update"](f.jane, { teamId: f.acme, styleId: style.id, headerText: "Changed" })
      const [row] = yield* db
        .query((d) =>
          d
            .select({ sentAs: schema.broadcasts.sentAs })
            .from(schema.broadcasts)
            .where(eq(schema.broadcasts.id, broadcast.id)),
        )
        .pipe(Effect.orDie)
      expect((row?.sentAs as { style?: { headerText: string; layout: string } } | undefined)?.style).toMatchObject({
        headerText: "Launch day",
        layout: "card",
      })

      const unsubscribe = (contactId: string, change: Parameters<typeof unsubscribeApply>[1]) =>
        unsubscribeApply(
          links.sign({
            teamId: f.acme,
            contactId: contactId as ContactId,
            topicId: topic.id,
            broadcastId: broadcast.id,
            test: false,
          }),
          change,
        )
      yield* unsubscribe(ada.id, { kind: "all", subscribed: false })
      yield* unsubscribe(bo.id, { kind: "topic", topicId: topic.id, subscribed: false })

      const done = yield* run["broadcasts.get"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      expect(done.counts?.unsubscribed).toBe(2)
      const recipients = yield* run["broadcasts.recipients"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      expect(Object.fromEntries(recipients.items.map((item) => [item.name, item.unsubscribed]))).toEqual({
        Ada: "everything",
        Bo: "topic",
        Cy: null,
      })
    }).pipe(Effect.provide(CoreLive)),
  )
})
