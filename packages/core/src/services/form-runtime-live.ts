import { Database, schema } from "@parley/db"
import {
  appearanceProblems,
  CLICK_ID_PARAMETERS,
  type CustomField,
  type CustomFieldId,
  FormAppearance,
  type FormContent,
  type FormId,
  isUuid,
  mergeAppearance,
  readAnswers,
  type StoredConsent,
  UTM_PARAMETER,
} from "@parley/domain"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { Duration, Effect, Layer, Schema } from "effect"
import type { SqlError } from "effect/sql"
import { PublicUrl } from "../config/public-url.ts"
import { EmailChecks, FormTokens, RENDER_TOKEN_MAX_AGE, RENDER_TOKEN_MIN_AGE, Turnstile } from "../forms/protection.ts"
import { Encryption } from "./encryption.ts"
import { FormRuntime, type RenderedForm, type SubmissionOutcome } from "./form-runtime.ts"
import { FormSubmissions } from "./form-submissions.ts"
import { digest, RateLimiter } from "./rate-limiter.ts"
import { classifySqlError } from "./sql-errors.ts"

/** Limits per visitor (IP), per form and per address (D147). Generous for people, tight for scripts. */
const LIMITS = {
  ipPerForm: { count: 10, window: Duration.minutes(10) },
  ipOverall: { count: 30, window: Duration.minutes(10) },
  emailPerForm: { count: 3, window: Duration.hours(1) },
  /** Past this many form loads from one address, its proof of work gets ten times harder (D147). */
  rendersPerIp: { count: 30, window: Duration.minutes(10) },
} as const

/** Host and path of the page a form was on, or "" for the hosted page. */
const pageKey = (url: string): string => {
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
        if (!isUuid(formId)) return undefined
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

    /** The form without consent boxes for topics deleted since it was published: there's nothing to agree to. */
    const withoutDeletedTopics = (teamId: string, content: FormContent) =>
      Effect.gen(function* () {
        const ids = content.fields.flatMap((field) => (field.kind === "consent" ? [field.topicId as string] : []))
        if (ids.length === 0) return content
        const rows = yield* run(
          db.query((d) =>
            d
              .select({ id: schema.topics.id })
              .from(schema.topics)
              .where(and(eq(schema.topics.teamId, teamId), inArray(schema.topics.id, ids))),
          ),
        )
        const live = new Set(rows.map((row) => row.id))
        return {
          ...content,
          fields: content.fields.filter((field) => field.kind !== "consent" || live.has(field.topicId)),
        }
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

    /**
     * The team's Turnstile secret, if Turnstile is on and the secret can be read. One no key opens
     * (a lost key, or a server without a newly added one) counts as Turnstile off: the form falls
     * back to the built-in proof of work rather than marking every submission spam (D152).
     */
    const turnstileSecretOf = (
      settings: { readonly captchaProvider: string; readonly turnstileSecret: string | null } | null,
    ) => {
      if (settings?.captchaProvider !== "turnstile" || !settings.turnstileSecret) return undefined
      return encryption.decrypt(settings.turnstileSecret)
    }

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
          let content = yield* withoutDeletedTopics(form.teamId, found.content)
          // Overrides from where it's embedded (D148): kept only if the result is a valid appearance.
          if (context.appearance) {
            const merged = decodeAppearance(mergeAppearance(content.appearance, context.appearance))
            if (merged._tag === "Some" && appearanceProblems(merged.value).length === 0) {
              content = { ...content, appearance: merged.value }
            }
          }
          const now = Date.now()
          const day = new Date(now).toISOString().slice(0, 10)
          // Loads aren't refused, so a busy office still gets its form; bots looping load-and-submit
          // just pay more for each one. Nor are they counted, so a script can't fill the views table.
          const busy = !!context.ip && !(yield* takes(`form-render:${context.ip}`, LIMITS.rendersPerIp))
          if (!busy && context.countView !== false) {
            yield* run(
              db.query((d) =>
                d
                  .insert(schema.formViews)
                  // By page only when the form records pages, as its submissions do; else all as one.
                  .values({
                    formId: form.id,
                    day,
                    page: content.captureTracking ? pageKey(context.page) : "",
                    views: 1,
                  })
                  .onConflictDoUpdate({
                    target: [schema.formViews.formId, schema.formViews.day, schema.formViews.page],
                    set: { views: sql`${schema.formViews.views} + 1` },
                  }),
              ),
            )
          }
          const turnstileReady = settings?.turnstileSiteKey && turnstileSecretOf(settings) !== undefined
          const rendered: RenderedForm = {
            formId: form.id as FormId,
            version: form.version,
            content,
            customFields: [...(yield* customFieldsOf(form.teamId, content)).values()],
            privacyPolicyUrl: settings?.privacyPolicyUrl ?? null,
            renderToken: yield* tokens.signRender(form.id, now),
            captcha: turnstileReady
              ? {
                  provider: "turnstile",
                  siteKey: settings.turnstileSiteKey ?? "",
                  mode: settings.turnstileMode ?? "invisible",
                }
              : {
                  provider: "builtin",
                  challenge: yield* tokens.challenge(now, busy ? "hard" : "normal"),
                },
          }
          return rendered
        }),

      allowedSites: (formId) =>
        Effect.gen(function* () {
          if (!isUuid(formId)) return null
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
          const { form, settings } = found
          const content = yield* withoutDeletedTopics(form.teamId, found.content)
          const accepted: SubmissionOutcome = {
            kind: "accepted",
            afterSubmit: content.afterSubmit,
            confirmByEmail: content.doubleOptIn,
          }
          const customFields = yield* customFieldsOf(form.teamId, content)
          const { values, problems } = readAnswers(content, customFields, input.values)
          if (Object.keys(problems).length > 0) return { kind: "invalid", problems } satisfies SubmissionOutcome
          const email = values.email as string
          const now = Date.now()

          const token = yield* tokens.readRender(input.renderToken)
          if (token && token.formId === form.id && now - token.issuedAt > Duration.toMillis(RENDER_TOKEN_MAX_AGE)) {
            return {
              kind: "invalid",
              problems: { form: "This form has been open a while. Reload the page and try again." },
            } satisfies SubmissionOutcome
          }

          /** Why it looks like a bot, checked in order (D147); undefined when it doesn't. */
          const spamReason = yield* Effect.gen(function* () {
            if (!token || token.formId !== form.id) return "Sent without loading the form"
            const age = now - token.issuedAt
            if (age < Duration.toMillis(RENDER_TOKEN_MIN_AGE))
              return `Sent ${(age / 1000).toFixed(1)}s after the form loaded`
            if (input.honeypot !== "") return "Hidden field filled in"
            if (
              !(yield* useOnce(
                `render:${token.nonce}`,
                new Date(token.issuedAt + Duration.toMillis(RENDER_TOKEN_MAX_AGE)),
              ))
            ) {
              return "The same form sent twice"
            }
            const turnstileSecret = turnstileSecretOf(settings)
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
              if (!(yield* useOnce(`pow:${signature}`, new Date(now + Duration.toMillis(RENDER_TOKEN_MAX_AGE))))) {
                return "Proof of work used twice"
              }
            }
            // Counted only once the form was really loaded and its work done, so a script can't use
            // up a visitor's allowance. Over it, kept on the spam list where it can be released (D147).
            if (
              !(yield* takes(`form-ip:${form.id}:${visitor.ip}`, LIMITS.ipPerForm)) ||
              !(yield* takes(`form-ip:${visitor.ip}`, LIMITS.ipOverall))
            ) {
              return "Too many from one visitor"
            }
            const domain = email.split("@")[1] ?? ""
            if (settings?.blockDisposableEmails && emailChecks.isDisposable(domain)) return "Disposable email address"
            if (!(yield* emailChecks.acceptsMail(domain))) return "No mail server for that domain"
            if (!(yield* takes(`form-email:${form.id}:${digest(email)}`, LIMITS.emailPerForm))) {
              return "Too many from one address"
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
          const consent: StoredConsent = {
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
          const submissionId = yield* tokens.readConfirm(token, Date.now())
          if (!submissionId) return { kind: "invalid" } as const
          const outcome = yield* processor.apply(submissionId, visitor)
          if (outcome === "missing") return { kind: "invalid" } as const
          const [row] = yield* run(
            db.query((d) =>
              d
                .select({
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
            content: row.content as FormContent,
            privacyPolicyUrl: row.privacyPolicyUrl ?? null,
          } as const
        }),
    })
  }),
)
