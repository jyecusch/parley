import { Database, schema } from "@parley/db"
import {
  appearanceProblems,
  CLICK_ID_PARAMETERS,
  type CustomField,
  type CustomFieldId,
  checkCustomValue,
  countryCodeOf,
  FormAppearance,
  type FormContent,
  type FormId,
  mergeAppearance,
  UTM_PARAMETER,
} from "@parley/domain"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { Duration, Effect, Layer, Schema } from "effect"
import type { SqlError } from "effect/sql"
import { PublicUrl } from "../config/public-url.ts"
import {
  EmailChecks,
  FormTokens,
  RENDER_TOKEN_MAX_AGE_MS,
  RENDER_TOKEN_MIN_AGE_MS,
  Turnstile,
} from "../forms/protection.ts"
import { Encryption } from "./encryption.ts"
import { FormRuntime, type RenderedForm, type SubmissionOutcome } from "./form-runtime.ts"
import { type ConsentRecord, FormSubmissions } from "./form-submissions.ts"
import { RateLimiter } from "./rate-limiter.ts"
import { classifySqlError } from "./sql-errors.ts"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+[1-9]\d{6,14}$/

/** Limits per visitor (IP), per form and per address (D147). Generous for people, tight for scripts. */
const LIMITS = {
  ipPerForm: { count: 10, window: Duration.minutes(10) },
  ipOverall: { count: 30, window: Duration.minutes(10) },
  emailPerForm: { count: 3, window: Duration.hours(1) },
  /** Past this many form loads from one address, its proof of work gets ten times harder (D147). */
  rendersPerIp: { count: 30, window: Duration.minutes(10) },
} as const

/** Host and path of the page a form was on, or "" for the hosted page. */
export const pageKey = (url: string): string => {
  if (!url) return ""
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return ""
    return `${parsed.host}${parsed.pathname}`.slice(0, 500)
  } catch {
    return ""
  }
}

const decodeAppearance = Schema.decodeUnknownOption(FormAppearance)

/** The key a field's answer goes under. */
const keyOf = (field: FormContent["fields"][number]) =>
  field.kind === "contact"
    ? field.field
    : field.kind === "custom"
      ? `custom:${field.fieldId}`
      : `topic:${field.topicId}`

/** Short fields on the contact, and how long each may be. */
const TEXT_LIMITS: Readonly<Record<string, number>> = {
  firstName: 100,
  lastName: 100,
  company: 200,
  title: 100,
  city: 100,
  region: 100,
}

/** Answers checked against the form and turned into contact values, or problems by field key. */
const readAnswers = (
  content: FormContent,
  customFields: ReadonlyMap<string, CustomField>,
  raw: Readonly<Record<string, unknown>>,
): { readonly values: Record<string, unknown>; readonly problems: Record<string, string> } => {
  const values: Record<string, unknown> = {}
  const problems: Record<string, string> = {}
  for (const field of content.fields) {
    const key = keyOf(field)
    const given = raw[key]
    if (field.kind === "consent") {
      const ticked = given === true || given === "true" || given === "on"
      if (field.required && !ticked) problems[key] = "Tick this to continue."
      values[key] = ticked
      continue
    }
    const text = typeof given === "string" ? given.trim() : ""
    const missing =
      given === undefined || given === null || text === "" ? (Array.isArray(given) ? given.length === 0 : true) : false
    if (missing) {
      if (field.required)
        problems[key] =
          field.kind === "contact" && field.field === "email" ? "Enter your email address." : "This one's needed."
      continue
    }
    if (field.kind === "contact") {
      switch (field.field) {
        case "email": {
          const email = text.toLowerCase()
          if (!EMAIL.test(email) || email.length > 254) problems[key] = "That doesn't look like an email address."
          else values[key] = email
          break
        }
        case "phone": {
          const phone = text.replace(/[\s().-]/g, "")
          if (!PHONE.test(phone)) problems[key] = "Enter your number with its country code, like +61 400 000 000."
          else values[key] = phone
          break
        }
        case "country": {
          const code = countryCodeOf(text)
          if (!code) problems[key] = "We don't recognize that country."
          else values[key] = code
          break
        }
        default:
          if (text.length > (TEXT_LIMITS[field.field] ?? 200)) problems[key] = "That's too long."
          else values[key] = text
      }
      continue
    }
    const definition = customFields.get(field.fieldId)
    if (!definition) continue
    const value =
      definition.type === "number"
        ? Number(text)
        : definition.type === "checkbox"
          ? given === true || given === "true" || given === "on"
          : definition.type === "multi-select"
            ? Array.isArray(given)
              ? given.filter((entry): entry is string => typeof entry === "string")
              : []
            : text
    const fault = checkCustomValue(definition, value as never)
    if (fault) problems[key] = fault === "too-long" ? "That's too long." : "That isn't a valid answer here."
    else values[key] = value
  }
  return { values, problems }
}

/** The public side of forms (D144–D147), for the form page, embed.js and confirmation links. */
export const FormRuntimeLive = Layer.effect(
  FormRuntime,
  Effect.gen(function* () {
    const db = yield* Database
    const tokens = yield* FormTokens
    const turnstile = yield* Turnstile
    const emailChecks = yield* EmailChecks
    const limiter = yield* RateLimiter
    const encryption = yield* Encryption
    const processor = yield* FormSubmissions
    const publicHost = new URL(yield* PublicUrl.pipe(Effect.orDie)).hostname
    const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
      effect.pipe(Effect.catchTag("SqlError", classifySqlError))

    /** A live, published form with its team's settings. */
    const live = (formId: string) =>
      Effect.gen(function* () {
        if (!UUID.test(formId)) return undefined
        const [row] = yield* run(
          db.query((d) =>
            d
              .select({ form: schema.forms, settings: schema.formSettings })
              .from(schema.forms)
              .leftJoin(schema.formSettings, eq(schema.formSettings.teamId, schema.forms.teamId))
              .where(and(eq(schema.forms.id, formId), isNull(schema.forms.deletedAt))),
          ),
        )
        if (!row?.form.published) return undefined
        return { form: row.form, content: row.form.published as FormContent, settings: row.settings }
      })

    const customFieldsOf = (teamId: string, content: FormContent) =>
      Effect.gen(function* () {
        const ids = content.fields.flatMap((field) => (field.kind === "custom" ? [field.fieldId as string] : []))
        if (ids.length === 0) return new Map<string, CustomField>()
        const rows = yield* run(
          db.query((d) =>
            d
              .select()
              .from(schema.customFields)
              .where(and(eq(schema.customFields.teamId, teamId), inArray(schema.customFields.id, ids))),
          ),
        )
        return new Map(
          rows.map((row): [string, CustomField] => [
            row.id,
            {
              id: row.id as CustomFieldId,
              recordType: row.recordType,
              name: row.name,
              type: row.type as CustomField["type"],
              options: row.options as CustomField["options"],
              position: row.position,
            },
          ]),
        )
      })

    /** Marks a one-time token or challenge used. False when it already was. */
    const useOnce = (nonce: string, expiresAt: Date) =>
      Effect.map(
        run(
          db.query((d) =>
            d
              .insert(schema.formTokenUses)
              .values({ nonce, expiresAt })
              .onConflictDoNothing()
              .returning({ nonce: schema.formTokenUses.nonce }),
          ),
        ),
        (rows) => rows.length > 0,
      )

    const takes = (key: string, limit: { readonly count: number; readonly window: Duration.Duration }) =>
      limiter.take(key, limit.count, limit.window).pipe(
        Effect.as(true),
        Effect.catchTag("RequestsTooFrequent", () => Effect.succeed(false)),
      )

    return FormRuntime.of({
      render: (formId, context) =>
        Effect.gen(function* () {
          const found = yield* live(formId)
          if (!found) return undefined
          const { form, settings } = found
          let content = found.content
          // Overrides from where it's embedded (D148): kept only if the result is a valid appearance.
          if (context.appearance) {
            const merged = decodeAppearance(mergeAppearance(content.appearance, context.appearance))
            if (merged._tag === "Some" && appearanceProblems(merged.value).length === 0) {
              content = { ...content, appearance: merged.value }
            }
          }
          const now = Date.now()
          const day = new Date(now).toISOString().slice(0, 10)
          yield* run(
            db.query((d) =>
              d
                .insert(schema.formViews)
                .values({ formId: form.id, day, page: pageKey(context.page), views: 1 })
                .onConflictDoUpdate({
                  target: [schema.formViews.formId, schema.formViews.day, schema.formViews.page],
                  set: { views: sql`${schema.formViews.views} + 1` },
                }),
            ),
          )
          const turnstileReady =
            settings?.captchaProvider === "turnstile" && settings.turnstileSiteKey && settings.turnstileSecret
          const rendered: RenderedForm = {
            formId: form.id as FormId,
            version: form.version,
            content,
            customFields: [...(yield* customFieldsOf(form.teamId, content)).values()],
            privacyPolicyUrl: settings?.privacyPolicyUrl ?? null,
            renderToken: tokens.signRender(form.id, now),
            captcha: turnstileReady
              ? {
                  provider: "turnstile",
                  siteKey: settings.turnstileSiteKey ?? "",
                  mode: settings.turnstileMode ?? "invisible",
                }
              : {
                  provider: "builtin",
                  challenge: yield* tokens.challenge(
                    now,
                    // Loads aren't refused, so a busy office still gets its form; bots looping
                    // load-and-submit just pay more for each one.
                    context.ip && !(yield* takes(`form-render:${context.ip}`, LIMITS.rendersPerIp)) ? "hard" : "normal",
                  ),
                },
          }
          return rendered
        }),

      allowedSites: (formId) =>
        Effect.gen(function* () {
          if (!UUID.test(formId)) return null
          const [row] = yield* run(
            db.query((d) =>
              d
                .select({ allowedSites: schema.forms.allowedSites })
                .from(schema.forms)
                .where(and(eq(schema.forms.id, formId), isNull(schema.forms.deletedAt))),
            ),
          )
          return row?.allowedSites ?? null
        }),

      submit: (formId, input, visitor) =>
        Effect.gen(function* () {
          const found = yield* live(formId)
          if (!found) return { kind: "unavailable" } satisfies SubmissionOutcome
          const { form, content, settings } = found
          const accepted: SubmissionOutcome = {
            kind: "accepted",
            afterSubmit: content.afterSubmit,
            confirmByEmail: content.doubleOptIn,
          }
          // Floods from one visitor: answered the same, and not stored (D145, D147).
          const withinLimits =
            (yield* takes(`form-ip:${form.id}:${visitor.ip}`, LIMITS.ipPerForm)) &&
            (yield* takes(`form-ip:${visitor.ip}`, LIMITS.ipOverall))
          if (!withinLimits) {
            yield* Effect.logInfo(`form ${form.id}: submission from ${visitor.ip} over the limit`)
            return accepted
          }

          const customFields = yield* customFieldsOf(form.teamId, content)
          const { values, problems } = readAnswers(content, customFields, input.values)
          if (Object.keys(problems).length > 0) return { kind: "invalid", problems } satisfies SubmissionOutcome
          const email = values.email as string
          const now = Date.now()

          const token = tokens.readRender(input.renderToken)
          if (token && token.formId === form.id && now - token.issuedAt > RENDER_TOKEN_MAX_AGE_MS) {
            return {
              kind: "invalid",
              problems: { form: "This form has been open a while. Reload the page and try again." },
            } satisfies SubmissionOutcome
          }

          /** Why it looks like a bot, checked in order (D147); undefined when it doesn't. */
          const spamReason = yield* Effect.gen(function* () {
            if (!token || token.formId !== form.id) return "Sent without loading the form"
            const age = now - token.issuedAt
            if (age < RENDER_TOKEN_MIN_AGE_MS) return `Sent ${(age / 1000).toFixed(1)}s after the form loaded`
            if (input.honeypot !== "") return "Hidden field filled in"
            if (!(yield* useOnce(`render:${token.nonce}`, new Date(token.issuedAt + RENDER_TOKEN_MAX_AGE_MS)))) {
              return "The same form sent twice"
            }
            const turnstileSecret =
              settings?.captchaProvider === "turnstile" && settings.turnstileSecret
                ? encryption.decrypt(settings.turnstileSecret)
                : undefined
            if (turnstileSecret) {
              if (!input.captchaToken) return "Turnstile missing"
              const result = yield* turnstile.verify({
                secret: turnstileSecret,
                token: input.captchaToken,
                ip: visitor.ip,
                idempotencyKey: token.nonce,
              })
              // The widget runs on Parley's own page, so that's the hostname Cloudflare must report.
              if (!result.success || (result.hostname !== null && result.hostname !== publicHost)) {
                return "Turnstile failed"
              }
            } else {
              if (!input.captchaToken) return "Proof of work missing"
              const signature = yield* tokens.verifyWork(input.captchaToken)
              if (!signature) return "Proof of work wrong"
              if (!(yield* useOnce(`pow:${signature}`, new Date(now + RENDER_TOKEN_MAX_AGE_MS)))) {
                return "Proof of work used twice"
              }
            }
            const domain = email.split("@")[1] ?? ""
            if (settings?.blockDisposableEmails && emailChecks.isDisposable(domain)) return "Disposable email address"
            if (!(yield* emailChecks.acceptsMail(domain))) return "No mail server for that domain"
            if (!(yield* takes(`form-email:${form.id}:${email}`, LIMITS.emailPerForm))) {
              return "Too many sign-ups from one address"
            }
            return undefined
          })

          const topics = yield* run(
            db.query((d) =>
              d
                .select({ id: schema.topics.id, name: schema.topics.name })
                .from(schema.topics)
                .where(eq(schema.topics.teamId, form.teamId)),
            ),
          )
          const consent: ConsentRecord = {
            version: form.version,
            title: content.title,
            finePrint: content.finePrint,
            privacyPolicyUrl: settings?.privacyPolicyUrl ?? null,
            consents: content.fields.flatMap((field) =>
              field.kind === "consent"
                ? [
                    {
                      topicId: field.topicId,
                      topicName: topics.find((topic) => topic.id === field.topicId)?.name ?? "",
                      label: field.label,
                      ticked: values[`topic:${field.topicId}`] === true,
                    },
                  ]
                : [],
            ),
          }
          // Every utm_* parameter, GA4's longer ones included (D153), and the known click IDs (D154).
          const kept = (given: Readonly<Record<string, string>>, accepts: (key: string) => boolean) =>
            content.captureTracking
              ? Object.fromEntries(
                  Object.entries(given)
                    .filter(([key, value]) => accepts(key) && typeof value === "string" && value !== "")
                    .slice(0, 12)
                    .map(([key, value]) => [key, value.slice(0, 500)]),
                )
              : {}
          const utm = kept(input.utm, (key) => UTM_PARAMETER.test(key))
          const clickIds = kept(input.clickIds, (key) => Object.hasOwn(CLICK_ID_PARAMETERS, key))
          const id = crypto.randomUUID()
          yield* run(
            db.query((d) =>
              d.insert(schema.formSubmissions).values({
                id,
                teamId: form.teamId,
                formId: form.id,
                version: form.version,
                email,
                values,
                status: spamReason ? "spam" : "waiting",
                spamReason: spamReason ?? null,
                page: content.captureTracking ? pageKey(input.page) || null : null,
                utm,
                clickIds,
                consent,
                ip: visitor.ip.slice(0, 64),
                userAgent: visitor.userAgent.slice(0, 500),
              }),
            ),
          )
          if (!spamReason) yield* processor.accept(id)
          return accepted
        }),

      confirm: (token, visitor) =>
        Effect.gen(function* () {
          const submissionId = tokens.readConfirm(token, Date.now())
          if (!submissionId) return { kind: "invalid" } as const
          const outcome = yield* processor.apply(submissionId, visitor)
          if (outcome === "missing") return { kind: "invalid" } as const
          const [row] = yield* run(
            db.query((d) =>
              d
                .select({
                  email: schema.formSubmissions.email,
                  content: schema.formVersions.content,
                  privacyPolicyUrl: schema.formSettings.privacyPolicyUrl,
                })
                .from(schema.formSubmissions)
                .innerJoin(
                  schema.formVersions,
                  and(
                    eq(schema.formVersions.formId, schema.formSubmissions.formId),
                    eq(schema.formVersions.version, schema.formSubmissions.version),
                  ),
                )
                .leftJoin(schema.formSettings, eq(schema.formSettings.teamId, schema.formSubmissions.teamId))
                .where(eq(schema.formSubmissions.id, submissionId)),
            ),
          )
          if (!row) return { kind: "invalid" } as const
          return {
            kind: "confirmed",
            email: row.email,
            content: row.content as FormContent,
            privacyPolicyUrl: row.privacyPolicyUrl ?? null,
          } as const
        }),
    })
  }),
)
