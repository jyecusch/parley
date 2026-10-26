import { describe, expect, it } from "@effect/vitest"
import { Database, schema } from "@parley/db"
import type { FormContent, FormId, TeamId, TopicId } from "@parley/domain"
import { solveChallenge } from "altcha-lib"
import { deriveKey } from "altcha-lib/algorithms/pbkdf2"
import { eq, sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import {
  coreLiveWith,
  EmailChecks,
  Encryption,
  FormRuntime,
  FormTokens,
  Mailer,
  type Principal,
  Purge,
  implementations as run,
  Turnstile,
} from "../src/index.ts"
import { Fixture } from "./fixture.ts"

// One PBKDF2 iteration per try instead of 5,000, so solving takes milliseconds; verifying is unchanged.
process.env.FORMS_POW_COST = "1"

/** Cloudflare and DNS, stood in for: "good" is a good Turnstile token; nomail.example takes no mail. */
const publicHost = new URL(process.env.PORTLESS_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost").hostname
const Outside = Layer.mergeAll(
  Layer.succeed(Turnstile, {
    verify: (input) =>
      Effect.succeed({ success: input.token === "good", hostname: input.token === "good" ? publicHost : null }),
  }),
  Layer.succeed(EmailChecks, {
    acceptsMail: (domain) => Effect.succeed(domain !== "nomail.example"),
    isDisposable: (domain) => domain === "mailinator.com",
  }),
)
const TestLive = coreLiveWith(Outside)

const unique = () => crypto.randomUUID().slice(0, 8)
const visitor = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 test" }
/** A visitor of their own, so tests don't share (and use up) one address's limits. */
const someVisitor = () => ({
  ...visitor,
  ip: `203.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
})

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

/** A published form, with an opt-in topic behind a consent box. */
const publishedForm = (
  owner: Principal,
  teamId: TeamId,
  change: (draft: FormContent, topicId: TopicId) => FormContent,
) =>
  Effect.gen(function* () {
    const topic = yield* run["topics.create"](owner, { teamId, name: `Launch ${unique()}`, mode: "opt-in" })
    const form = yield* run["forms.create"](owner, { teamId, name: "Waitlist", template: "waitlist" })
    yield* run["forms.update"](owner, { teamId, formId: form.id, draft: change(form.draft, topic.id) })
    const published = yield* run["forms.publish"](owner, { teamId, formId: form.id })
    return { form: published, topic }
  })

const withConsent = (draft: FormContent, topicId: TopicId): FormContent => ({
  ...draft,
  fields: [...draft.fields, { kind: "consent", topicId, label: "Send me launch news.", required: false }],
})

/** Loads the form as a visitor's browser does: a render token (from 5s ago) and a solved puzzle. */
const visit = (formId: FormId, ip?: string) =>
  Effect.gen(function* () {
    const runtime = yield* FormRuntime
    const tokens = yield* FormTokens
    const rendered = yield* runtime.render(formId, { page: "https://example.com/launch?x=1", ip })
    if (!rendered) throw new Error("no form")
    let captchaToken = ""
    let counter = 0
    if (rendered.captcha.provider === "builtin") {
      const challenge = rendered.captcha.challenge
      const solution = yield* Effect.tryPromise(() => solveChallenge({ challenge, deriveKey })).pipe(Effect.orDie)
      counter = solution?.counter ?? 0
      // The payload ALTCHA's widget sends: the challenge and its solution, as base64 JSON.
      captchaToken = Buffer.from(JSON.stringify({ challenge, solution })).toString("base64")
    }
    return { rendered, renderToken: yield* tokens.signRender(formId, Date.now() - 5000), captchaToken, counter }
  })

const submit = (
  formId: FormId,
  values: Record<string, unknown>,
  override: Partial<{ renderToken: string; captchaToken: string; honeypot: string }> = {},
) =>
  Effect.gen(function* () {
    const runtime = yield* FormRuntime
    const loaded = yield* visit(formId)
    return yield* runtime.submit(
      formId,
      {
        renderToken: override.renderToken ?? loaded.renderToken,
        captchaToken: override.captchaToken ?? loaded.captchaToken,
        honeypot: override.honeypot ?? "",
        values,
        page: "https://example.com/launch?utm_source=newsletter",
        utm: { utm_source: "newsletter", utm_medium: "email", utm_source_platform: "Klaviyo", other: "dropped" },
        clickIds: { gclid: "Cj0KCQ", other: "dropped" },
      },
      someVisitor(),
    )
  })

const latestSubmission = (formId: FormId) =>
  Effect.gen(function* () {
    const db = yield* Database
    const [row] = yield* db
      .query((d) =>
        d
          .select()
          .from(schema.formSubmissions)
          .where(eq(schema.formSubmissions.formId, formId))
          .orderBy(sql`${schema.formSubmissions.createdAt} desc`)
          .limit(1),
      )
      .pipe(Effect.orDie)
    return row
  })

/** Clicks the latest confirmation link sent to an address. */
const runtimeConfirm = (to: string) =>
  Effect.gen(function* () {
    const runtime = yield* FormRuntime
    return (yield* runtime.confirm((yield* confirmToken(to)) ?? "", visitor)).kind
  })

const confirmToken = (to: string) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer
    const email = (yield* mailer.outbox).filter((message) => message.to === to).at(-1)
    return email?.text.match(/\/f\/confirm\/([A-Za-z0-9_.-]+)/)?.[1]
  })

describe("forms (D144–D150)", () => {
  it.effect("checks drafts, needs a sender for double opt-in, and publishes versions", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const form = yield* run["forms.create"](f.jane, { teamId: f.acme, name: "Newsletter", template: "newsletter" })
      expect(form).toMatchObject({ version: 0, published: null, hasDraftChanges: true })
      expect(form.draft.doubleOptIn).toBe(true)

      const noEmail = yield* run["forms.update"](f.jane, {
        teamId: f.acme,
        formId: form.id,
        draft: { ...form.draft, fields: form.draft.fields.slice(1) },
      }).pipe(Effect.flip)
      expect(noEmail._tag).toBe("InputRejected")
      const badRule = yield* run["forms.update"](f.jane, {
        teamId: f.acme,
        formId: form.id,
        draft: { ...form.draft, appearance: { ...form.draft.appearance, rules: { ".Button": { position: "fixed" } } } },
      }).pipe(Effect.flip)
      expect(badRule._tag).toBe("InputRejected")
      const unknownTopic = yield* run["forms.update"](f.jane, {
        teamId: f.acme,
        formId: form.id,
        draft: withConsent(form.draft, crypto.randomUUID() as TopicId),
      }).pipe(Effect.flip)
      expect(unknownTopic._tag).toBe("TopicNotFound")
      const dynamic = yield* run["segments.create"](f.jane, { teamId: f.acme, name: `D ${unique()}`, kind: "dynamic" })
      const notFixed = yield* run["forms.update"](f.jane, {
        teamId: f.acme,
        formId: form.id,
        draft: { ...form.draft, segmentId: dynamic.id },
      }).pipe(Effect.flip)
      expect(notFixed._tag).toBe("InputRejected")

      const noSender = yield* run["forms.publish"](f.jane, { teamId: f.acme, formId: form.id }).pipe(Effect.flip)
      expect(noSender._tag).toBe("SenderNotReady")
      yield* setUpSending(f.jane, f.acme)
      const published = yield* run["forms.publish"](f.jane, { teamId: f.acme, formId: form.id })
      expect(published).toMatchObject({ version: 1, hasDraftChanges: false })
      const edited = yield* run["forms.update"](f.jane, {
        teamId: f.acme,
        formId: form.id,
        draft: { ...form.draft, title: "Newer" },
      })
      expect(edited.hasDraftChanges).toBe(true)
      expect(edited.published?.title).toBe(form.draft.title)
      // Keys without email:write can read but not change forms.
      const readOnlyCant = yield* run["forms.create"](f.janeReadOnlyKey, {
        teamId: f.acme,
        name: "x",
        template: "blank",
      }).pipe(Effect.flip)
      expect(readOnlyCant._tag).toBe("ApiKeyScopeExcludes")
      expect(
        (yield* run["forms.list"](f.janeReadOnlyKey, { teamId: f.acme })).some((entry) => entry.id === form.id),
      ).toBe(true)
      // Another team can't see it.
      const other = yield* run["forms.get"](f.bob, { teamId: f.globex, formId: form.id }).pipe(Effect.flip)
      expect(other._tag).toBe("FormNotFound")
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("double opt-in: nothing happens until the link is clicked, then a contact joins the topic", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      yield* setUpSending(f.jane, f.acme)
      const { form, topic } = yield* publishedForm(f.jane, f.acme, withConsent)
      const email = `ada-${unique()}@example.com`
      const outcome = yield* submit(form.id, { email, firstName: "Ada", company: "Hooli", [`topic:${topic.id}`]: true })
      expect(outcome).toMatchObject({ kind: "accepted", confirmByEmail: true })
      const waiting = yield* latestSubmission(form.id)
      expect(waiting).toMatchObject({ status: "waiting", contactId: null, page: "example.com/launch" })
      // Every utm_* parameter, GA4's longer ones too, and only known click IDs (D153, D154).
      expect(waiting?.utm).toEqual({ utm_source: "newsletter", utm_medium: "email", utm_source_platform: "Klaviyo" })
      expect(waiting?.clickIds).toEqual({ gclid: "Cj0KCQ" })
      expect(waiting?.consent).toMatchObject({
        version: 1,
        consents: [{ topicId: topic.id, label: "Send me launch news.", ticked: true }],
      })
      const before = yield* run["contacts.list"](f.jane, { teamId: f.acme, search: email })
      expect(before.items).toHaveLength(0)

      const token = yield* confirmToken(email)
      expect(token).toBeDefined()
      const runtime = yield* FormRuntime
      const page = yield* runtime.confirm(token ?? "", { ip: "198.51.100.2", userAgent: "Mail app" })
      expect(page).toMatchObject({ kind: "confirmed", email })
      expect((yield* runtime.confirm(token ?? "", visitor)).kind).toBe("confirmed")
      expect((yield* runtime.confirm("nope", visitor)).kind).toBe("invalid")

      const confirmed = yield* latestSubmission(form.id)
      expect(confirmed).toMatchObject({ status: "confirmed", outcome: "created", confirmIp: "198.51.100.2" })
      // The consent record (D150): what was shown and ticked, and when and from where.
      const [listedSubmission] = (yield* run["forms.submissions"](f.jane, { teamId: f.acme, formId: form.id })).items
      expect(listedSubmission?.consent).toMatchObject({
        version: 1,
        title: form.draft.title,
        consents: [{ topicId: topic.id, label: "Send me launch news.", ticked: true }],
        sent: { userAgent: "Mozilla/5.0 test" },
        confirmed: { ip: "198.51.100.2", userAgent: "Mail app" },
      })
      const [contact] = (yield* run["contacts.list"](f.jane, { teamId: f.acme, search: email })).items
      expect(contact).toMatchObject({ firstName: "Ada", subscriptionStatus: "subscribed" })
      expect(contact?.affiliations.map((entry) => entry.companyName)).toEqual(["Hooli"])
      const subscriptions = yield* run["contacts.subscriptions"](f.jane, {
        teamId: f.acme,
        contactId: contact?.id ?? ("" as never),
      })
      expect(subscriptions.topics.find((entry) => entry.topicId === topic.id)?.subscribed).toBe(true)
      const activity = yield* run["contacts.activity"](f.jane, {
        teamId: f.acme,
        contactId: contact?.id ?? ("" as never),
      })
      expect(activity.find((entry) => entry.kind === "submitted-form")).toMatchObject({
        actorName: "Form: Waitlist",
        related: { recordType: "form", id: form.id, name: "Waitlist" },
        tracking: {
          page: "example.com/launch",
          utm: { utm_source: "newsletter", utm_medium: "email", utm_source_platform: "Klaviyo" },
          clickIds: { gclid: "Cj0KCQ" },
        },
      })
      const listed = yield* run["forms.get"](f.jane, { teamId: f.acme, formId: form.id })
      expect(listed.counts).toMatchObject({ views: 1, submitted: 1, confirmed: 1, waiting: 0, spam: 0 })
      const analytics = yield* run["forms.analytics"](f.jane, { teamId: f.acme, formId: form.id })
      expect(analytics.pages[0]).toMatchObject({ page: "example.com/launch", confirmed: 1 })
      expect(analytics.sources).toEqual([{ value: "newsletter", confirmed: 1 }])
      expect(analytics.mediums).toEqual([{ value: "email", confirmed: 1 }])
      expect(analytics.campaigns).toEqual([{ value: "", confirmed: 1 }])
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("fills an existing contact's empty fields only, keeping the rest in its activity", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const { form } = yield* publishedForm(f.jane, f.acme, (draft) => ({
        ...draft,
        doubleOptIn: false,
        fields: [...draft.fields, { kind: "contact", field: "lastName", label: "Last name", required: false }],
      }))
      const email = `adeline-${unique()}@example.com`
      const existing = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Adeline",
        emails: [{ address: email as never }],
      })
      const outcome = yield* submit(form.id, { email, firstName: "Ada", lastName: "Lovelace" })
      expect(outcome.kind).toBe("accepted")
      const contact = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: existing.id })
      expect(contact).toMatchObject({ firstName: "Adeline", lastName: "Lovelace" })
      const activity = yield* run["contacts.activity"](f.jane, { teamId: f.acme, contactId: existing.id })
      expect(activity.find((entry) => entry.kind === "submitted-form")).toMatchObject({
        changedFields: ["lastName"],
        kept: [{ field: "firstName", label: "First name", value: "Ada" }],
      })
      expect((yield* latestSubmission(form.id))?.outcome).toBe("updated")
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("puts back someone who left only once they confirm, even without double opt-in", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      yield* setUpSending(f.jane, f.acme)
      const { form } = yield* publishedForm(f.jane, f.acme, (draft) => ({ ...draft, doubleOptIn: false }))
      const email = `left-${unique()}@example.com`
      const existing = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        emails: [{ address: email as never }],
        subscriptionStatus: "unsubscribed",
      })
      yield* submit(form.id, { email })
      expect((yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: existing.id })).subscriptionStatus).toBe(
        "unsubscribed",
      )
      expect((yield* latestSubmission(form.id))?.status).toBe("waiting")
      const runtime = yield* FormRuntime
      yield* runtime.confirm((yield* confirmToken(email)) ?? "", visitor)
      expect((yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: existing.id })).subscriptionStatus).toBe(
        "subscribed",
      )
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect(
    "holds bot-like submissions as spam with a reason, and answers them the same",
    () =>
      Effect.gen(function* () {
        const f = yield* Fixture
        yield* run["formSettings.update"](f.jane, { teamId: f.acme, blockDisposableEmails: true })
        const { form } = yield* publishedForm(f.jane, f.acme, (draft) => ({ ...draft, doubleOptIn: false }))
        const tokens = yield* FormTokens
        const cases: ReadonlyArray<[string, Record<string, unknown>, Parameters<typeof submit>[2], string]> = [
          [
            "fresh",
            { email: `a-${unique()}@example.com` },
            { renderToken: yield* tokens.signRender(form.id, Date.now()) },
            "after the form loaded",
          ],
          ["none", { email: `b-${unique()}@example.com` }, { renderToken: "made-up" }, "Sent without loading the form"],
          ["honey", { email: `c-${unique()}@example.com` }, { honeypot: "https://spam" }, "Hidden field filled in"],
          ["pow", { email: `d-${unique()}@example.com` }, { captchaToken: "" }, "Proof of work missing"],
          ["disposable", { email: `e-${unique()}@mailinator.com` }, {}, "Disposable email address"],
          ["mx", { email: `f-${unique()}@nomail.example` }, {}, "No mail server for that domain"],
        ]
        for (const [, values, override, reason] of cases) {
          const outcome = yield* submit(form.id, values, override)
          expect(outcome.kind).toBe("accepted")
          const row = yield* latestSubmission(form.id)
          expect(row?.status).toBe("spam")
          expect(row?.spamReason).toContain(reason)
        }
        // A token used once can't be used again.
        const loaded = yield* visit(form.id)
        const runtime = yield* FormRuntime
        const input = {
          renderToken: loaded.renderToken,
          captchaToken: loaded.captchaToken,
          honeypot: "",
          values: { email: `g-${unique()}@example.com` },
          page: "",
          utm: {},
          clickIds: {},
        }
        yield* runtime.submit(form.id, input, someVisitor())
        expect((yield* latestSubmission(form.id))?.status).toBe("confirmed")
        yield* runtime.submit(form.id, { ...input, values: { email: `h-${unique()}@example.com` } }, someVisitor())
        expect((yield* latestSubmission(form.id))?.spamReason).toBe("The same form sent twice")
        // Answers that don't fit are reported, and nothing is stored.
        const invalid = yield* submit(form.id, { email: "not an email" })
        expect(invalid).toEqual({
          kind: "invalid",
          problems: { email: "Enter an email address like you@example.com." },
        })
        // A released one is handled as if just sent.
        const spam = yield* run["forms.submissions"](f.jane, { teamId: f.acme, formId: form.id, status: "spam" })
        const released = yield* run["forms.releaseSubmission"](f.jane, {
          teamId: f.acme,
          formId: form.id,
          submissionId: spam.items.find((entry) => entry.spamReason === "Hidden field filled in")?.id ?? ("" as never),
        })
        expect(released).toMatchObject({ status: "confirmed", outcome: "created", spamReason: null })
      }).pipe(Effect.provide(TestLive)),
    30_000,
  )

  it.effect(
    "keeps submissions over a visitor's limit on the spam list, counting only really loaded forms",
    () =>
      Effect.gen(function* () {
        const f = yield* Fixture
        const { form } = yield* publishedForm(f.jane, f.acme, (draft) => ({ ...draft, doubleOptIn: false }))
        const runtime = yield* FormRuntime
        const from = { ip: `192.0.2.${Math.floor(Math.random() * 200) + 20}`, userAgent: "test" }
        const send = (override: Partial<{ renderToken: string }> = {}) =>
          Effect.gen(function* () {
            const loaded = yield* visit(form.id)
            return yield* runtime.submit(
              form.id,
              {
                renderToken: override.renderToken ?? loaded.renderToken,
                captchaToken: loaded.captchaToken,
                honeypot: "",
                values: { email: `ip-${unique()}@example.com` },
                page: "",
                utm: {},
                clickIds: {},
              },
              from,
            )
          })
        // Forged sends (no loaded form) don't use up the visitor's allowance.
        for (let attempt = 0; attempt < 12; attempt++) yield* send({ renderToken: "made-up" })
        for (let attempt = 0; attempt < 10; attempt++) yield* send()
        expect((yield* latestSubmission(form.id))?.status).toBe("confirmed")
        expect((yield* send()).kind).toBe("accepted")
        const over = yield* latestSubmission(form.id)
        expect(over).toMatchObject({ status: "spam", spamReason: "Too many from one visitor" })
        // Kept, so a real one (a booth behind one router) can be released.
        const released = yield* run["forms.releaseSubmission"](f.jane, {
          teamId: f.acme,
          formId: form.id,
          submissionId: over?.id as never,
        })
        expect(released.status).toBe("confirmed")
      }).pipe(Effect.provide(TestLive)),
    30_000,
  )

  it.effect("limits submissions per address", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const { form } = yield* publishedForm(f.jane, f.acme, (draft) => ({ ...draft, doubleOptIn: false }))
      const email = `many-${unique()}@example.com`
      for (let attempt = 0; attempt < 4; attempt++) yield* submit(form.id, { email })
      expect((yield* latestSubmission(form.id))?.spamReason).toBe("Too many from one address")
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("makes the proof of work ten times harder for an address loading forms far too often", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const { form } = yield* publishedForm(f.jane, f.acme, (draft) => ({ ...draft, doubleOptIn: false }))
      const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`
      expect((yield* visit(form.id, ip)).counter).toBeLessThan(10_000)
      const runtime = yield* FormRuntime
      for (let load = 0; load < 30; load++) yield* runtime.render(form.id, { page: "", ip })
      const busy = yield* visit(form.id, ip)
      expect(busy.counter).toBeGreaterThanOrEqual(50_000)
      // Still a working challenge: the submission goes through.
      const outcome = yield* runtime.submit(
        form.id,
        {
          renderToken: busy.renderToken,
          captchaToken: busy.captchaToken,
          honeypot: "",
          values: { email: `busy-${unique()}@example.com` },
          page: "",
          utm: {},
          clickIds: {},
        },
        { ip: "203.0.113.99", userAgent: "test" },
      )
      expect(outcome.kind).toBe("accepted")
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("keeps Turnstile's secret encrypted and never returns it, and checks its tokens", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const missing = yield* run["formSettings.update"](f.jane, {
        teamId: f.acme,
        captcha: { provider: "turnstile", siteKey: "0x4AAA", mode: "invisible" },
      }).pipe(Effect.flip)
      expect(missing._tag).toBe("InputRejected")
      const saved = yield* run["formSettings.update"](f.jane, {
        teamId: f.acme,
        captcha: { provider: "turnstile", siteKey: "0x4AAA", mode: "invisible", secretKey: "0x-very-secret" },
        privacyPolicyUrl: "https://acme.example/privacy",
      })
      expect(saved).toEqual({
        captcha: { provider: "turnstile", siteKey: "0x4AAA", mode: "invisible", hasSecret: true },
        blockDisposableEmails: false,
        privacyPolicyUrl: "https://acme.example/privacy",
      })
      expect(JSON.stringify(saved)).not.toContain("very-secret")
      const db = yield* Database
      const [row] = yield* db
        .query((d) => d.select().from(schema.formSettings).where(eq(schema.formSettings.teamId, f.acme)))
        .pipe(Effect.orDie)
      expect(row?.turnstileSecret).toMatch(/^v1\.[\w-]{8}\./)
      expect(row?.turnstileSecret).not.toContain("very-secret")
      const memberCant = yield* run["formSettings.update"](f.sam, {
        teamId: f.acme,
        blockDisposableEmails: true,
      }).pipe(Effect.flip)
      expect(memberCant._tag).toBe("RoleLacksPermission")

      const { form } = yield* publishedForm(f.jane, f.acme, (draft) => ({ ...draft, doubleOptIn: false }))
      const loaded = yield* visit(form.id)
      expect(loaded.rendered.captcha).toEqual({ provider: "turnstile", siteKey: "0x4AAA", mode: "invisible" })
      expect(loaded.rendered.privacyPolicyUrl).toBe("https://acme.example/privacy")
      yield* submit(form.id, { email: `t-${unique()}@example.com` }, { captchaToken: "bad" })
      expect((yield* latestSubmission(form.id))?.spamReason).toBe("Turnstile failed")
      yield* submit(form.id, { email: `u-${unique()}@example.com` }, { captchaToken: "good" })
      expect((yield* latestSubmission(form.id))?.status).toBe("confirmed")
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("falls back to the proof of work when Turnstile's secret can't be read", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const db = yield* Database
      // Encrypted with a key this server doesn't have (lost, or added on a newer server).
      const unreadable = {
        captchaProvider: "turnstile" as const,
        turnstileSiteKey: "0x4AAA",
        turnstileSecret: "v1.abcdefgh.AAAA",
      }
      yield* db
        .query((d) =>
          d
            .insert(schema.formSettings)
            .values({ teamId: f.acme, ...unreadable })
            .onConflictDoUpdate({ target: schema.formSettings.teamId, set: unreadable }),
        )
        .pipe(Effect.orDie)
      const { form } = yield* publishedForm(f.jane, f.acme, (draft) => ({ ...draft, doubleOptIn: false }))
      expect((yield* visit(form.id)).rendered.captcha.provider).toBe("builtin")
      yield* submit(form.id, { email: `fallback-${unique()}@example.com` })
      expect((yield* latestSubmission(form.id))?.status).toBe("confirmed")
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("takes fonts only from font services, and fixed values only of the right kind", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const form = yield* run["forms.create"](f.jane, { teamId: f.acme, name: "Styled", template: "waitlist" })
      const update = (draft: FormContent) =>
        run["forms.update"](f.jane, { teamId: f.acme, formId: form.id, draft }).pipe(Effect.flip)
      const withAppearance = (appearance: Partial<FormContent["appearance"]>) => ({
        ...form.draft,
        appearance: { ...form.draft.appearance, ...appearance },
      })
      expect((yield* update(withAppearance({ fonts: ["https://evil.example/steal.css"] })))._tag).toBe("InputRejected")
      expect((yield* update(withAppearance({ fontFamily: 'Inter"}*{color:red' })))._tag).toBe("InputRejected")
      expect(
        (yield* update(
          withAppearance({ rules: { ".Button": { background: "image-set('https://x.example/a.png' 1x)" } } }),
        ))._tag,
      ).toBe("InputRejected")
      yield* run["forms.update"](f.jane, {
        teamId: f.acme,
        formId: form.id,
        draft: withAppearance({ fonts: ["https://fonts.googleapis.com/css2?family=Inter"], fontFamily: "Inter" }),
      })

      const plan = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: `Plan ${unique()}`,
        type: "single-select",
        options: [{ id: "free", label: "Free" }],
      })
      const rejected = yield* update({
        ...form.draft,
        set: { [`custom:${plan.id}`]: "Free", country: "Atlantis", lastName: "Smith" },
      })
      expect(rejected._tag).toBe("InputRejected")
      expect(rejected._tag === "InputRejected" && rejected.problems.map((entry) => entry.field).sort()).toEqual([
        "draft.set.country",
        `draft.set.custom:${plan.id}`,
        "draft.set.lastName",
      ])
      const saved = yield* run["forms.update"](f.jane, {
        teamId: f.acme,
        formId: form.id,
        draft: { ...form.draft, set: { [`custom:${plan.id}`]: "free", country: "Australia" } },
      })
      expect(saved.draft.set).toEqual({ [`custom:${plan.id}`]: "free", country: "Australia" })
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("rotates the encryption key: previous keys still decrypt, and a start re-encrypts with the new one", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const key = () => crypto.getRandomValues(new Uint8Array(32))
      const [oldKey, newKey] = [Buffer.from(key()).toString("base64"), Buffer.from(key()).toString("base64")]
      const withKeys = (config: Record<string, string>) =>
        Layer.fresh(Encryption.layer).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ BETTER_AUTH_SECRET: "test", ...config }))),
        )
      const encryptor = (config: Record<string, string>) =>
        Effect.provide(
          Effect.gen(function* () {
            return yield* Encryption
          }),
          withKeys(config),
        )
      const before = yield* encryptor({ PARLEY_ENCRYPTION_KEY: oldKey })
      const stored = before.encrypt("0x-rotated-secret")
      const db = yield* Database
      yield* db
        .query((d) =>
          d
            .insert(schema.formSettings)
            .values({ teamId: f.acme, turnstileSecret: stored })
            .onConflictDoUpdate({ target: schema.formSettings.teamId, set: { turnstileSecret: stored } }),
        )
        .pipe(Effect.orDie)

      // Rotated: the old key moves to the previous keys, and still decrypts.
      const rotated = { PARLEY_ENCRYPTION_KEY: newKey, PARLEY_ENCRYPTION_KEYS_PREVIOUS: `${oldKey}` }
      const during = yield* encryptor(rotated)
      expect(during.decrypt(stored)).toBe("0x-rotated-secret")
      expect(during.isCurrent(stored)).toBe(false)

      yield* Layer.build(Layer.fresh(Encryption.reencrypt).pipe(Layer.provide(withKeys(rotated)))).pipe(Effect.scoped)
      const [row] = yield* db
        .query((d) => d.select().from(schema.formSettings).where(eq(schema.formSettings.teamId, f.acme)))
        .pipe(Effect.orDie)
      // With the old key gone, the re-encrypted secret still reads.
      const after = yield* encryptor({ PARLEY_ENCRYPTION_KEY: newKey })
      expect(row?.turnstileSecret && after.decrypt(row.turnstileSecret)).toBe("0x-rotated-secret")
      expect(after.decrypt(stored)).toBeUndefined()
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("sends a broadcast with an opt-in topic only to its members", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      yield* setUpSending(f.jane, f.acme)
      const tag = unique()
      const topic = yield* run["topics.create"](f.jane, { teamId: f.acme, name: `Opt in ${tag}`, mode: "opt-in" })
      expect(topic).toMatchObject({ mode: "opt-in", memberCount: 0 })
      const ada = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Ada",
        emails: [{ address: `ada-${tag}@example.com` as never }],
      })
      yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Bo",
        emails: [{ address: `bo-${tag}@example.com` as never }],
      })
      // Joining by hand takes email:manage, as consent does.
      const memberCant = yield* run["contacts.updateSubscriptions"](f.sam, {
        teamId: f.acme,
        contactId: ada.id,
        topics: [{ topicId: topic.id, subscribed: true }],
      }).pipe(Effect.flip)
      expect(memberCant._tag).toBe("RoleLacksPermission")
      yield* run["contacts.updateSubscriptions"](f.jane, {
        teamId: f.acme,
        contactId: ada.id,
        topics: [{ topicId: topic.id, subscribed: true }],
      })
      const segment = yield* run["segments.create"](f.jane, {
        teamId: f.acme,
        name: `Tagged ${tag}`,
        kind: "dynamic",
        filter: { match: "all", conditions: [{ field: "email", operator: "contains", value: tag }] },
      })
      const broadcast = yield* run["broadcasts.create"](f.jane, {
        teamId: f.acme,
        name: "Opt-in news",
        segmentId: segment.id,
        topicId: topic.id,
      })
      yield* run["broadcasts.update"](f.jane, {
        teamId: f.acme,
        broadcastId: broadcast.id,
        subject: "Hi",
        body: "News.",
      })
      const sending = yield* run["broadcasts.send"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      expect(sending.counts).toMatchObject({ recipients: 2, queued: 1, skipped: 1 })
      const recipients = yield* run["broadcasts.recipients"](f.jane, { teamId: f.acme, broadcastId: broadcast.id })
      expect(recipients.items.map((item) => [item.name, item.status])).toEqual([
        ["Ada", "queued"],
        ["Bo", "skipped"],
      ])
      // Switching it to opt-out keeps who joined, and everyone else is in again.
      const optOut = yield* run["topics.update"](f.jane, { teamId: f.acme, topicId: topic.id, mode: "opt-out" })
      expect(optOut.mode).toBe("opt-out")
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("someone who left an opt-in topic is back only by confirming, even without double opt-in", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      yield* setUpSending(f.jane, f.acme)
      const { form, topic } = yield* publishedForm(f.jane, f.acme, (draft, topicId) => ({
        ...withConsent(draft, topicId),
        doubleOptIn: false,
      }))
      const email = `rejoin-${unique()}@example.com`
      yield* submit(form.id, { email, [`topic:${topic.id}`]: true })
      const [contact] = (yield* run["contacts.list"](f.jane, { teamId: f.acme, search: email })).items
      const contactId = contact?.id as never
      const subscribed = () =>
        run["contacts.subscriptions"](f.jane, { teamId: f.acme, contactId }).pipe(
          Effect.map((result) => result.topics.find((entry) => entry.topicId === topic.id)?.subscribed),
        )
      expect(yield* subscribed()).toBe(true)
      yield* run["contacts.updateSubscriptions"](f.jane, {
        teamId: f.acme,
        contactId,
        topics: [{ topicId: topic.id, subscribed: false }],
      })
      expect(yield* subscribed()).toBe(false)
      // Ticking the box again doesn't put them back: it asks them to confirm (D145).
      yield* submit(form.id, { email, [`topic:${topic.id}`]: true })
      expect((yield* latestSubmission(form.id))?.status).toBe("waiting")
      expect(yield* subscribed()).toBe(false)
      // Nor does switching the topic to opt-out.
      yield* run["topics.update"](f.jane, { teamId: f.acme, topicId: topic.id, mode: "opt-out" })
      expect(yield* subscribed()).toBe(false)
      yield* run["topics.update"](f.jane, { teamId: f.acme, topicId: topic.id, mode: "opt-in" })
      const runtime = yield* FormRuntime
      yield* runtime.confirm((yield* confirmToken(email)) ?? "", visitor)
      expect(yield* subscribed()).toBe(true)
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("two submissions for one new address at once make one contact", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const { form } = yield* publishedForm(f.jane, f.acme, (draft) => ({ ...draft, doubleOptIn: false }))
      const email = `twice-${unique()}@example.com`
      const company = `Twice ${unique()}`
      yield* Effect.all(
        [submit(form.id, { email, company }), submit(form.id, { email: email.replace("twice", "other"), company })],
        { concurrency: "unbounded" },
      )
      yield* Effect.all([submit(form.id, { email }), submit(form.id, { email })], { concurrency: "unbounded" })
      const contacts = yield* run["contacts.list"](f.jane, { teamId: f.acme, search: email })
      expect(contacts.items).toHaveLength(1)
      const companies = yield* run["companies.list"](f.jane, { teamId: f.acme, search: company })
      expect(companies.items).toHaveLength(1)
      const db = yield* Database
      const rows = yield* db
        .query((d) => d.select().from(schema.formSubmissions).where(eq(schema.formSubmissions.formId, form.id)))
        .pipe(Effect.orDie)
      expect(rows.map((row) => row.status)).toEqual(["confirmed", "confirmed", "confirmed", "confirmed"])
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("publishes only a draft that still checks out, and drops boxes for deleted topics", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const { form, topic } = yield* publishedForm(f.jane, f.acme, (draft, topicId) => ({
        ...withConsent(draft, topicId),
        doubleOptIn: false,
      }))
      yield* run["topics.delete"](f.jane, { teamId: f.acme, topicId: topic.id })
      const refused = yield* run["forms.publish"](f.jane, { teamId: f.acme, formId: form.id }).pipe(Effect.flip)
      expect(refused._tag).toBe("TopicNotFound")
      const loaded = yield* visit(form.id)
      expect(loaded.rendered.content.fields.some((field) => field.kind === "consent")).toBe(false)
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("a deleted form takes no confirmations, and a bad cursor reads as the first page", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      yield* setUpSending(f.jane, f.acme)
      const { form } = yield* publishedForm(f.jane, f.acme, (draft) => draft)
      const email = `gone-${unique()}@example.com`
      yield* submit(form.id, { email })
      const page = yield* run["forms.submissions"](f.jane, { teamId: f.acme, formId: form.id, cursor: "bm90fGF1dWlk" })
      expect(page.items).toHaveLength(1)
      yield* run["forms.delete"](f.jane, { teamId: f.acme, formId: form.id })
      const runtime = yield* FormRuntime
      expect((yield* runtime.confirm((yield* confirmToken(email)) ?? "", visitor)).kind).toBe("invalid")
    }).pipe(Effect.provide(TestLive)),
  )

  it.effect("purges old spam and expires unconfirmed submissions", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const { form } = yield* publishedForm(f.jane, f.acme, (draft) => ({ ...draft, doubleOptIn: false }))
      yield* submit(form.id, { email: `old-${unique()}@example.com` }, { honeypot: "x" })
      const spam = yield* latestSubmission(form.id)
      const db = yield* Database
      const age = (id: string, days: number, status: "spam" | "waiting") =>
        db
          .query((d) =>
            d
              .update(schema.formSubmissions)
              .set({
                status,
                createdAt: sql`now() - make_interval(days => ${days})`,
                waitingSince: sql`now() - make_interval(days => ${days})`,
              })
              .where(eq(schema.formSubmissions.id, id)),
          )
          .pipe(Effect.orDie)
      yield* age(spam?.id ?? "", 31, "spam")
      yield* submit(form.id, { email: `wait-${unique()}@example.com` }, { honeypot: "x" })
      const waiting = yield* latestSubmission(form.id)
      yield* age(waiting?.id ?? "", 8, "waiting")
      const purge = yield* Purge
      const purged = yield* purge.run
      expect(purged.spam).toBeGreaterThanOrEqual(1)
      expect(purged.expired).toBeGreaterThanOrEqual(1)
      const rows = yield* db
        .query((d) => d.select().from(schema.formSubmissions).where(eq(schema.formSubmissions.formId, form.id)))
        .pipe(Effect.orDie)
      expect(rows.find((row) => row.id === spam?.id)).toBeUndefined()
      expect(rows.find((row) => row.id === waiting?.id)).toMatchObject({ status: "expired", values: {} })

      // Released from spam 10 days on, it has its own 7 days to be confirmed.
      yield* submit(form.id, { email: `late-${unique()}@example.com` }, { honeypot: "x" })
      const late = yield* latestSubmission(form.id)
      yield* age(late?.id ?? "", 10, "spam")
      yield* setUpSending(f.jane, f.acme)
      yield* db
        .query((d) =>
          d
            .update(schema.formVersions)
            .set({ content: sql`jsonb_set(${schema.formVersions.content}, '{doubleOptIn}', 'true')` })
            .where(eq(schema.formVersions.formId, form.id)),
        )
        .pipe(Effect.orDie)
      yield* run["forms.releaseSubmission"](f.jane, {
        teamId: f.acme,
        formId: form.id,
        submissionId: late?.id as never,
      })
      yield* purge.run
      const [released] = yield* db
        .query((d) =>
          d
            .select()
            .from(schema.formSubmissions)
            .where(eq(schema.formSubmissions.id, late?.id ?? "")),
        )
        .pipe(Effect.orDie)
      expect(released?.status).toBe("waiting")

      // A purged contact's submissions go with it.
      const email = `purged-${unique()}@example.com`
      yield* submit(form.id, { email })
      const confirmed = yield* runtimeConfirm(email)
      expect(confirmed).toBe("confirmed")
      const mine = yield* latestSubmission(form.id)
      yield* run["contacts.delete"](f.jane, { teamId: f.acme, contactId: mine?.contactId as never })
      yield* db
        .query((d) =>
          d
            .update(schema.contacts)
            .set({ deletedAt: sql`now() - make_interval(days => 31)` })
            .where(eq(schema.contacts.id, mine?.contactId ?? "")),
        )
        .pipe(Effect.orDie)
      yield* purge.run
      const left = yield* db
        .query((d) =>
          d
            .select()
            .from(schema.formSubmissions)
            .where(eq(schema.formSubmissions.id, mine?.id ?? "")),
        )
        .pipe(Effect.orDie)
      expect(left).toHaveLength(0)
    }).pipe(Effect.provide(Layer.provideMerge(Purge.layer, TestLive))),
  )
})
