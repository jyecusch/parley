import { Database, schema } from "@parley/db"
import {
  appearanceProblems,
  type CustomField,
  checkCustomValue,
  countryCodeOf,
  type DatabaseUnavailable,
  type FieldProblem,
  FORM_SET_FIELDS,
  type Form,
  type FormAnalytics,
  type FormContent,
  type FormCounts,
  type FormId,
  type FormSettings,
  formFieldKey,
  InputRejected,
  SegmentNotFound,
  type Submission,
  type SubmissionId,
  type SubmissionStatus,
  setValueOf,
  type TeamId,
  TopicNotFound,
} from "@parley/domain"
import { userText } from "@parley/errors"
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { type FormTemplateName, templateContent } from "../forms/templates.ts"
import type { FormInTeam, SubmissionOfForm } from "../proofs/form-in-team.ts"
import type { CanManageEmail, CanWriteEmail, CanWriteRecords, MemberOf } from "../proofs/permissions.ts"
import { decodeCursor, encodeCursor } from "./cursors.ts"
import { Encryption } from "./encryption.ts"
import { FormSubmissions } from "./form-submissions.ts"
import { classifySqlError } from "./sql-errors.ts"

export interface FormUpdate {
  readonly name?: string | undefined
  readonly draft?: FormContent | undefined
  readonly allowedSites?: ReadonlyArray<string> | null | undefined
}

export interface FormSettingsUpdate {
  readonly captcha?:
    | { readonly provider: "builtin" }
    | {
        readonly provider: "turnstile"
        readonly siteKey: string
        readonly mode: "invisible" | "managed"
        readonly secretKey?: string | undefined
      }
    | undefined
  readonly blockDisposableEmails?: boolean | undefined
  readonly privacyPolicyUrl?: string | null | undefined
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const problem = (field: string, kind: FieldProblem["problem"], message: ReturnType<typeof userText>): FieldProblem => ({
  field,
  problem: kind,
  userMessage: message,
})

const toSubmission = (row: typeof schema.formSubmissions.$inferSelect): Submission => ({
  id: row.id as SubmissionId,
  formId: row.formId as FormId,
  email: row.email,
  values: row.values,
  status: row.status,
  spamReason: row.spamReason,
  contactId: row.contactId,
  outcome: row.outcome,
  page: row.page,
  utm: row.utm,
  clickIds: row.clickIds,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
})

/**
 * Forms (D144–D150): what the designer edits and publishes, submissions, and the team's form
 * settings. Process tier: every call names its team through a proof.
 */
export class Forms extends Context.Service<
  Forms,
  {
    readonly list: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<Form>, DatabaseUnavailable>
    /** Used only by the FormInTeam prover. */
    readonly locate: (teamId: TeamId, formId: FormId) => Effect.Effect<Form | undefined, DatabaseUnavailable>
    readonly create: <P, T>(
      access: CanWriteEmail<P, T>,
      name: string,
      template: FormTemplateName,
    ) => Effect.Effect<Form, DatabaseUnavailable>
    readonly update: <P, T, F>(
      target: FormInTeam<F, T>,
      input: FormUpdate,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Form, InputRejected | TopicNotFound | SegmentNotFound | DatabaseUnavailable>
    /** Publishes the draft, checked again: a topic, field or segment it uses may have gone since it was saved. */
    readonly publish: <P, T, F>(
      target: FormInTeam<F, T>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Form, InputRejected | TopicNotFound | SegmentNotFound | DatabaseUnavailable>
    readonly delete: <P, T, F>(
      target: FormInTeam<F, T>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Form, DatabaseUnavailable>
    readonly analytics: <F, T>(target: FormInTeam<F, T>) => Effect.Effect<FormAnalytics, DatabaseUnavailable>
    readonly submissions: <F, T>(
      target: FormInTeam<F, T>,
      query: {
        readonly status?: SubmissionStatus | undefined
        readonly limit?: number | undefined
        readonly cursor?: string | undefined
      },
    ) => Effect.Effect<
      { readonly items: ReadonlyArray<Submission>; readonly nextCursor: string | null },
      DatabaseUnavailable
    >
    /** Used only by the SubmissionOfForm prover. */
    readonly locateSubmission: (
      formId: FormId,
      submissionId: SubmissionId,
    ) => Effect.Effect<Submission | undefined, DatabaseUnavailable>
    readonly release: <P, T, S, F>(
      target: SubmissionOfForm<S, F>,
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<Submission, DatabaseUnavailable>
    readonly settings: <P, T>(member: MemberOf<P, T>) => Effect.Effect<FormSettings, DatabaseUnavailable>
    readonly updateSettings: <P, T>(
      access: CanManageEmail<P, T>,
      input: FormSettingsUpdate,
    ) => Effect.Effect<FormSettings, InputRejected | DatabaseUnavailable>
  }
>()("@parley/core/Forms") {
  static readonly layer = Layer.effect(
    Forms,
    Effect.gen(function* () {
      const db = yield* Database
      const encryption = yield* Encryption
      const processor = yield* FormSubmissions
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const countsOf = (formIds: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const result = new Map<
            string,
            { views: number; submitted: number; confirmed: number; waiting: number; expired: number; spam: number }
          >()
          if (formIds.length === 0) return result
          const [views, statuses] = yield* Effect.all(
            [
              run(
                db.query((d) =>
                  d
                    .select({
                      formId: schema.formViews.formId,
                      views: sql<number>`sum(${schema.formViews.views})::int`,
                    })
                    .from(schema.formViews)
                    .where(inArray(schema.formViews.formId, [...formIds]))
                    .groupBy(schema.formViews.formId),
                ),
              ),
              run(
                db.query((d) =>
                  d
                    .select({
                      formId: schema.formSubmissions.formId,
                      status: schema.formSubmissions.status,
                      count: sql<number>`count(*)::int`,
                    })
                    .from(schema.formSubmissions)
                    .where(inArray(schema.formSubmissions.formId, [...formIds]))
                    .groupBy(schema.formSubmissions.formId, schema.formSubmissions.status),
                ),
              ),
            ],
            { concurrency: 2 },
          )
          for (const id of formIds)
            result.set(id, { views: 0, submitted: 0, confirmed: 0, waiting: 0, expired: 0, spam: 0 })
          for (const row of views) {
            const entry = result.get(row.formId)
            if (entry) entry.views = Number(row.views)
          }
          for (const row of statuses) {
            const entry = result.get(row.formId)
            if (!entry) continue
            const count = Number(row.count)
            // Spam isn't a submission anyone made on purpose; expired ones were.
            if (row.status !== "spam") entry.submitted += count
            if (row.status === "confirmed") entry.confirmed += count
            if (row.status === "waiting") entry.waiting += count
            if (row.status === "expired") entry.expired += count
            if (row.status === "spam") entry.spam += count
          }
          return result
        })

      const toForm = (row: typeof schema.forms.$inferSelect, counts: FormCounts): Form => {
        const draft = row.draft as FormContent
        const published = (row.published as FormContent | null) ?? null
        return {
          id: row.id as FormId,
          name: row.name,
          draft,
          published,
          version: row.version,
          hasDraftChanges: published === null || !same(draft, published),
          allowedSites: row.allowedSites ?? null,
          counts,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }
      }

      const select = (teamId: TeamId, formId?: string) =>
        Effect.gen(function* () {
          const rows = yield* run(
            db.query((d) =>
              d
                .select()
                .from(schema.forms)
                .where(
                  and(
                    eq(schema.forms.teamId, teamId),
                    isNull(schema.forms.deletedAt),
                    formId ? eq(schema.forms.id, formId) : undefined,
                  ),
                )
                .orderBy(desc(schema.forms.updatedAt)),
            ),
          )
          const counts = yield* countsOf(rows.map((row) => row.id))
          return rows.map((row) =>
            toForm(
              row,
              counts.get(row.id) ?? { views: 0, submitted: 0, confirmed: 0, waiting: 0, expired: 0, spam: 0 },
            ),
          )
        })

      const one = (teamId: TeamId, formId: string) =>
        Effect.flatMap(select(teamId, formId), ([form]) =>
          form ? Effect.succeed(form) : Effect.die(new Error("form vanished")),
        )

      /** Every problem with a draft at once, in our words (D26). */
      const check = <T>(teamId: TeamId, teamName: MemberOf<unknown, T>["teamName"], draft: FormContent) =>
        Effect.gen(function* () {
          const problems: Array<FieldProblem> = appearanceProblems(draft.appearance).map((entry) => ({
            ...entry,
            field: `draft.${entry.field}`,
          }))
          const [first] = draft.fields
          if (first?.kind !== "contact" || first.field !== "email" || !first.required) {
            problems.push(
              problem("draft.fields", "missing", userText`A form asks for an email address first, and it's required.`),
            )
          }
          const keys = new Set<string>()
          for (const [index, field] of draft.fields.entries()) {
            const key = formFieldKey(field)
            if (keys.has(key)) {
              problems.push(problem(`draft.fields.${index}`, "conflict", userText`This field is on the form twice.`))
            }
            keys.add(key)
          }
          const setIds = Object.keys(draft.set).flatMap((key) =>
            key.startsWith("custom:") ? [key.slice("custom:".length)] : [],
          )
          const customIds = [
            ...draft.fields.flatMap((field) => (field.kind === "custom" ? [field.fieldId as string] : [])),
            ...setIds,
          ]
          if (customIds.length > 0) {
            const found = yield* run(
              db.query((d) =>
                d
                  .select({
                    id: schema.customFields.id,
                    type: schema.customFields.type,
                    options: schema.customFields.options,
                  })
                  .from(schema.customFields)
                  .where(
                    and(
                      eq(schema.customFields.teamId, teamId),
                      eq(schema.customFields.recordType, "contact"),
                      inArray(schema.customFields.id, customIds),
                    ),
                  ),
              ),
            )
            const known = new Map(found.map((row) => [row.id, row]))
            for (const [index, field] of draft.fields.entries()) {
              if (field.kind === "custom" && !known.has(field.fieldId)) {
                problems.push(
                  problem(
                    `draft.fields.${index}`,
                    "not-allowed",
                    userText`This custom field isn't one of the team's contact fields any more.`,
                  ),
                )
              }
            }
            for (const id of setIds) {
              const definition = known.get(id)
              const value = definition
                ? setValueOf(definition.type as CustomField["type"], draft.set[`custom:${id}`] ?? "")
                : undefined
              if (!definition) {
                problems.push(
                  problem(
                    `draft.set.custom:${id}`,
                    "not-allowed",
                    userText`This custom field isn't one of the team's contact fields any more.`,
                  ),
                )
              } else if (
                value === undefined ||
                checkCustomValue(
                  {
                    type: definition.type as CustomField["type"],
                    options: definition.options as CustomField["options"],
                  },
                  value as never,
                )
              ) {
                problems.push(
                  problem(
                    `draft.set.custom:${id}`,
                    "invalid-format",
                    userText`That isn't a valid value for this field.`,
                  ),
                )
              }
            }
          }
          for (const [key, value] of Object.entries(draft.set)) {
            if (key.startsWith("custom:")) continue
            if (!(FORM_SET_FIELDS as ReadonlyArray<string>).includes(key)) {
              problems.push(
                problem(
                  `draft.set.${key}`,
                  "not-allowed",
                  userText`A form can set the company, job title, city, country or a custom field.`,
                ),
              )
            } else if (key === "country" && !countryCodeOf(value)) {
              problems.push(problem(`draft.set.${key}`, "invalid-format", userText`We don't recognize that country.`))
            } else if (value.trim() === "") {
              problems.push(problem(`draft.set.${key}`, "missing", userText`Give it a value, or remove it.`))
            }
          }
          if (problems.length > 0) return yield* new InputRejected({ problems })
          const topicIds = draft.fields.flatMap((field) => (field.kind === "consent" ? [field.topicId as string] : []))
          if (topicIds.length > 0) {
            const found = yield* run(
              db.query((d) =>
                d
                  .select({ id: schema.topics.id })
                  .from(schema.topics)
                  .where(and(eq(schema.topics.teamId, teamId), inArray(schema.topics.id, topicIds))),
              ),
            )
            const missing = topicIds.find((id) => !found.some((row) => row.id === id))
            if (missing) return yield* new TopicNotFound({ team: teamName, topicId: missing as never })
          }
          if (draft.segmentId) {
            const [segment] = yield* run(
              db.query((d) =>
                d
                  .select({ kind: schema.segments.kind })
                  .from(schema.segments)
                  .where(and(eq(schema.segments.teamId, teamId), eq(schema.segments.id, draft.segmentId as string))),
              ),
            )
            if (!segment) return yield* new SegmentNotFound({ team: teamName, segmentId: draft.segmentId })
            if (segment.kind !== "fixed") {
              return yield* new InputRejected({
                problems: [
                  problem(
                    "draft.segmentId",
                    "not-allowed",
                    userText`A form can add contacts to a fixed segment only. A dynamic segment follows its filter.`,
                  ),
                ],
              })
            }
          }
        })

      const settingsOf = (teamId: TeamId) =>
        Effect.map(
          run(db.query((d) => d.select().from(schema.formSettings).where(eq(schema.formSettings.teamId, teamId)))),
          ([row]): FormSettings => ({
            captcha:
              row?.captchaProvider === "turnstile" && row.turnstileSiteKey
                ? {
                    provider: "turnstile",
                    siteKey: row.turnstileSiteKey,
                    mode: row.turnstileMode ?? "invisible",
                    hasSecret: Boolean(row.turnstileSecret),
                  }
                : { provider: "builtin" },
            blockDisposableEmails: row?.blockDisposableEmails ?? false,
            privacyPolicyUrl: row?.privacyPolicyUrl ?? null,
          }),
        )

      return {
        list: (member) => select(member.team.value),
        locate: (teamId, formId) => Effect.map(select(teamId, formId), (rows) => rows[0]),
        create: (access, name, template) =>
          Effect.gen(function* () {
            const id = crypto.randomUUID()
            const teamId = access.member.team.value
            yield* run(
              db.query((d) => d.insert(schema.forms).values({ id, teamId, name, draft: templateContent(template) })),
            )
            return yield* one(teamId, id)
          }).pipe(Effect.withSpan("Forms.create")),
        update: (target, input, access) =>
          Effect.gen(function* () {
            const teamId = target.team.value
            if (input.draft) yield* check(teamId, access.member.teamName, input.draft)
            yield* run(
              db.query((d) =>
                d
                  .update(schema.forms)
                  .set({
                    ...(input.name !== undefined ? { name: input.name } : {}),
                    ...(input.draft !== undefined ? { draft: input.draft } : {}),
                    ...(input.allowedSites !== undefined
                      ? {
                          allowedSites:
                            input.allowedSites === null
                              ? null
                              : [...new Set(input.allowedSites.map((site) => site.toLowerCase()))],
                        }
                      : {}),
                    updatedAt: sql`now()`,
                  })
                  .where(and(eq(schema.forms.teamId, teamId), eq(schema.forms.id, target.form.value))),
              ),
            )
            return yield* one(teamId, target.form.value)
          }).pipe(Effect.withSpan("Forms.update")),
        publish: (target, access) =>
          Effect.gen(function* () {
            const teamId = target.team.value
            const formId = target.form.value
            yield* check(teamId, access.member.teamName, target.found.draft)
            yield* run(
              db.transaction(
                Effect.gen(function* () {
                  const [row] = yield* db.query((d) =>
                    d
                      .update(schema.forms)
                      .set({
                        published: sql`${schema.forms.draft}`,
                        version: sql`${schema.forms.version} + 1`,
                        publishedAt: sql`now()`,
                        updatedAt: sql`now()`,
                      })
                      .where(and(eq(schema.forms.teamId, teamId), eq(schema.forms.id, formId)))
                      .returning({ version: schema.forms.version, draft: schema.forms.draft }),
                  )
                  if (row) {
                    yield* db.query((d) =>
                      d.insert(schema.formVersions).values({ formId, version: row.version, content: row.draft }),
                    )
                  }
                }),
              ),
            )
            return yield* one(teamId, formId)
          }).pipe(Effect.withSpan("Forms.publish")),
        delete: (target) =>
          Effect.gen(function* () {
            yield* run(
              db.query((d) =>
                d
                  .update(schema.forms)
                  .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
                  .where(and(eq(schema.forms.teamId, target.team.value), eq(schema.forms.id, target.form.value))),
              ),
            )
            return target.found
          }).pipe(Effect.withSpan("Forms.delete")),
        analytics: (target) =>
          Effect.gen(function* () {
            const formId = target.form.value
            /** Confirmed submissions by one UTM parameter's value. */
            const byUtm = (parameter: string) =>
              run(
                db.query((d) =>
                  d
                    .select({
                      value: sql<string>`coalesce(${schema.formSubmissions.utm}->>${parameter}, '')`,
                      count: sql<number>`count(*)::int`,
                    })
                    .from(schema.formSubmissions)
                    .where(
                      and(eq(schema.formSubmissions.formId, formId), eq(schema.formSubmissions.status, "confirmed")),
                    )
                    .groupBy(sql`1`),
                ),
              ).pipe(
                Effect.map((rows) =>
                  rows
                    .map((row) => ({ value: row.value, confirmed: Number(row.count) }))
                    .sort((a, b) => b.confirmed - a.confirmed),
                ),
              )
            const [views, confirmed, sources, mediums, campaigns] = yield* Effect.all(
              [
                run(
                  db.query((d) =>
                    d
                      .select({ page: schema.formViews.page, views: sql<number>`sum(${schema.formViews.views})::int` })
                      .from(schema.formViews)
                      .where(eq(schema.formViews.formId, formId))
                      .groupBy(schema.formViews.page),
                  ),
                ),
                run(
                  db.query((d) =>
                    d
                      .select({
                        page: sql<string>`coalesce(${schema.formSubmissions.page}, '')`,
                        count: sql<number>`count(*)::int`,
                      })
                      .from(schema.formSubmissions)
                      .where(
                        and(eq(schema.formSubmissions.formId, formId), eq(schema.formSubmissions.status, "confirmed")),
                      )
                      .groupBy(sql`coalesce(${schema.formSubmissions.page}, '')`),
                  ),
                ),
                byUtm("utm_source"),
                byUtm("utm_medium"),
                byUtm("utm_campaign"),
              ],
              { concurrency: 5 },
            )
            const pages = new Map<string, { page: string; views: number; confirmed: number }>()
            for (const row of views) pages.set(row.page, { page: row.page, views: Number(row.views), confirmed: 0 })
            for (const row of confirmed) {
              const entry = pages.get(row.page) ?? { page: row.page, views: 0, confirmed: 0 }
              entry.confirmed = Number(row.count)
              pages.set(row.page, entry)
            }
            const result: FormAnalytics = {
              pages: [...pages.values()].sort((a, b) => b.views - a.views || b.confirmed - a.confirmed),
              sources,
              mediums,
              campaigns,
            }
            return result
          }),
        submissions: (target, query) =>
          Effect.gen(function* () {
            const limit = query.limit ?? 50
            const cursor = query.cursor ? decodeCursor(query.cursor) : undefined
            const after = cursor
              ? or(
                  lt(schema.formSubmissions.createdAt, cursor.at),
                  and(eq(schema.formSubmissions.createdAt, cursor.at), lt(schema.formSubmissions.id, cursor.id)),
                )
              : undefined
            const rows = yield* run(
              db.query((d) =>
                d
                  .select()
                  .from(schema.formSubmissions)
                  .where(
                    and(
                      eq(schema.formSubmissions.formId, target.form.value),
                      query.status ? eq(schema.formSubmissions.status, query.status) : undefined,
                      after,
                    ),
                  )
                  .orderBy(desc(schema.formSubmissions.createdAt), desc(schema.formSubmissions.id))
                  .limit(limit + 1),
              ),
            )
            const page = rows.slice(0, limit)
            const last = page.at(-1)
            return {
              items: page.map(toSubmission),
              nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
            }
          }),
        locateSubmission: (formId, submissionId) =>
          Effect.map(
            run(
              db.query((d) =>
                d
                  .select()
                  .from(schema.formSubmissions)
                  .where(and(eq(schema.formSubmissions.formId, formId), eq(schema.formSubmissions.id, submissionId))),
              ),
            ),
            ([row]) => (row ? toSubmission(row) : undefined),
          ),
        release: (target) =>
          Effect.gen(function* () {
            const id = target.submission.value
            const released = yield* run(
              db.query((d) =>
                d
                  .update(schema.formSubmissions)
                  // Its 7 days to be confirmed start now, not when it was first sent (D146).
                  .set({ status: "waiting", spamReason: null, waitingSince: sql`now()` })
                  .where(and(eq(schema.formSubmissions.id, id), eq(schema.formSubmissions.status, "spam")))
                  .returning({ id: schema.formSubmissions.id }),
              ),
            )
            // Handled as if just sent: the confirmation email, or straight in (D147).
            if (released.length > 0) yield* processor.accept(id)
            const [row] = yield* run(
              db.query((d) => d.select().from(schema.formSubmissions).where(eq(schema.formSubmissions.id, id))),
            )
            return row ? toSubmission(row) : target.found
          }).pipe(Effect.withSpan("Forms.release")),
        settings: (member) => settingsOf(member.team.value),
        updateSettings: (access, input) =>
          Effect.gen(function* () {
            const teamId = access.member.team.value
            const [current] = yield* run(
              db.query((d) => d.select().from(schema.formSettings).where(eq(schema.formSettings.teamId, teamId))),
            )
            const captcha = input.captcha
            if (captcha?.provider === "turnstile" && !captcha.secretKey && !current?.turnstileSecret) {
              return yield* new InputRejected({
                problems: [
                  problem(
                    "captcha.secretKey",
                    "missing",
                    userText`Add Turnstile's secret key too. Cloudflare shows it beside the site key.`,
                  ),
                ],
              })
            }
            const values = {
              ...(captcha?.provider === "builtin" ? { captchaProvider: "builtin" as const } : {}),
              ...(captcha?.provider === "turnstile"
                ? {
                    captchaProvider: "turnstile" as const,
                    turnstileSiteKey: captcha.siteKey,
                    turnstileMode: captcha.mode,
                    ...(captcha.secretKey ? { turnstileSecret: encryption.encrypt(captcha.secretKey) } : {}),
                  }
                : {}),
              ...(input.blockDisposableEmails !== undefined
                ? { blockDisposableEmails: input.blockDisposableEmails }
                : {}),
              ...(input.privacyPolicyUrl !== undefined ? { privacyPolicyUrl: input.privacyPolicyUrl } : {}),
            }
            yield* run(
              db.query((d) =>
                d
                  .insert(schema.formSettings)
                  .values({ teamId, ...values })
                  .onConflictDoUpdate({
                    target: schema.formSettings.teamId,
                    set: { ...values, updatedAt: sql`now()` },
                  }),
              ),
            )
            return yield* settingsOf(teamId)
          }).pipe(Effect.withSpan("Forms.updateSettings")),
      }
    }),
  )
}
