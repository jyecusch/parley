import { Database, schema } from "@parley/db"
import {
  type CustomField,
  countryCodeOf,
  type DatabaseUnavailable,
  type FormContent,
  type FormField,
  formFieldKey,
  setValueOf,
  type TeamId,
} from "@parley/domain"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { Context, Duration, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { PublicUrl } from "../config/public-url.ts"
import { CONFIRM_LINK_AGE, CONFIRM_LINK_DAYS, FormTokens } from "../forms/protection.ts"
import { Mailer } from "../mail/mailer.ts"
import type { SystemActor } from "../principal.ts"
import { activityRow } from "./activity.ts"
import { Affiliations } from "./affiliations.ts"
import { digest, RateLimiter } from "./rate-limiter.ts"
import { Sending } from "./sending.ts"
import { classifySqlError } from "./sql-errors.ts"

/** Who confirmed, for the consent record (D150). */
export interface ConfirmingVisitor {
  readonly ip: string
  readonly userAgent: string
}

/** One consent box as shown, and whether it was ticked: the heart of the consent record (D150). */
export interface ConsentEntry {
  readonly topicId: string
  readonly topicName: string
  readonly label: string
  readonly ticked: boolean
}

/** What a submission's consent record holds besides its own columns (D150). */
export interface ConsentRecord {
  readonly version: number
  readonly title: string
  readonly finePrint: string
  readonly privacyPolicyUrl: string | null
  readonly consents: ReadonlyArray<ConsentEntry>
}

/** Confirmation emails one address may get from a team in a day (D146): no bombing through forms. */
const CONFIRMATIONS_PER_DAY = 3

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c)

/** Contact fields a form fills, as their columns on the contact. */
const COLUMNS = {
  firstName: "firstName",
  lastName: "lastName",
  city: "city",
  region: "region",
  country: "country",
} as const

const isEmpty = (value: unknown) =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Carries a form submission through (D145, D146): sends its confirmation email, or applies it to
 * contacts once confirmed. Process tier, and no principal: these run for a visitor nobody signed
 * in, so writes are attributed to the form itself ("Form: Waitlist").
 */
export class FormSubmissions extends Context.Service<
  FormSubmissions,
  {
    /**
     * A submission just accepted (or released from spam): emails the confirmation link, or applies
     * it at once when the form has no double opt-in and nothing needs consent confirmed.
     */
    readonly accept: (submissionId: string) => Effect.Effect<void, DatabaseUnavailable>
    /** Applies a waiting submission to contacts. Idempotent: a second call changes nothing. */
    readonly apply: (
      submissionId: string,
      visitor: ConfirmingVisitor | null,
    ) => Effect.Effect<"applied" | "already" | "missing", DatabaseUnavailable>
  }
>()("@parley/core/FormSubmissions") {
  static readonly layer = Layer.effect(
    FormSubmissions,
    Effect.gen(function* () {
      const db = yield* Database
      const mailer = yield* Mailer
      const sending = yield* Sending
      const tokens = yield* FormTokens
      const limiter = yield* RateLimiter
      const affiliations = yield* Affiliations
      const base = yield* PublicUrl.pipe(Effect.orDie)
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      /** A submission with the version of its form that was shown. */
      const load = (submissionId: string) =>
        run(
          db.query((d) =>
            d
              .select({
                submission: schema.formSubmissions,
                formName: schema.forms.name,
                content: schema.formVersions.content,
              })
              .from(schema.formSubmissions)
              // A deleted form takes nothing more, confirmations included (forms.delete says so).
              .innerJoin(
                schema.forms,
                and(eq(schema.forms.id, schema.formSubmissions.formId), isNull(schema.forms.deletedAt)),
              )
              .innerJoin(
                schema.formVersions,
                and(
                  eq(schema.formVersions.formId, schema.formSubmissions.formId),
                  eq(schema.formVersions.version, schema.formSubmissions.version),
                ),
              )
              .where(eq(schema.formSubmissions.id, submissionId)),
          ),
        ).pipe(Effect.map(([row]) => (row ? { ...row, content: row.content as FormContent } : undefined)))

      /** The live contact an address belongs to in a team, if any. */
      const contactByEmail = (teamId: string, email: string) =>
        db
          .query((d) =>
            d
              .select({ id: schema.contacts.id, status: schema.contacts.subscriptionStatus })
              .from(schema.contactEmails)
              .innerJoin(schema.contacts, eq(schema.contacts.id, schema.contactEmails.contactId))
              .where(
                and(
                  eq(schema.contactEmails.teamId, teamId),
                  eq(schema.contactEmails.address, email),
                  eq(schema.contactEmails.active, true),
                  isNull(schema.contacts.deletedAt),
                ),
              ),
          )
          .pipe(Effect.map(([row]) => row))

      /** Topics the contact left that this submission ticks, of either mode: rejoining needs confirmation (D145). */
      const leftTicked = (contactId: string, consent: ConsentRecord) => {
        const ticked = consent.consents.filter((entry) => entry.ticked).map((entry) => entry.topicId)
        if (ticked.length === 0) return Effect.succeed(false)
        return db
          .query((d) =>
            d
              .select({ topicId: schema.topicUnsubscribes.topicId })
              .from(schema.topicUnsubscribes)
              .where(
                and(
                  eq(schema.topicUnsubscribes.contactId, contactId),
                  inArray(schema.topicUnsubscribes.topicId, ticked),
                ),
              ),
          )
          .pipe(Effect.map((rows) => rows.length > 0))
      }

      const sendConfirmation = (row: NonNullable<Effect.Success<ReturnType<typeof load>>>) =>
        Effect.gen(function* () {
          const { submission, content } = row
          const teamId = submission.teamId as TeamId
          // A few a day per address, so nobody can flood an inbox through a form (D146).
          const allowed = yield* limiter
            .take(`form-confirm:${teamId}:${digest(submission.email)}`, CONFIRMATIONS_PER_DAY, Duration.days(1))
            .pipe(
              Effect.as(true),
              Effect.catchTag("RequestsTooFrequent", () => Effect.succeed(false)),
            )
          if (!allowed) return yield* Effect.logInfo(`form confirmation for ${submission.id} not sent: too many today`)
          const sender = yield* sending.senderForTeam(teamId)
          // Publishing refuses double opt-in without a sender; one removed since leaves it waiting.
          if (!sender) return yield* Effect.logWarning(`form confirmation for ${submission.id} not sent: no sender`)
          const expiresAt = Date.now() + Duration.toMillis(CONFIRM_LINK_AGE)
          const link = `${base.replace(/\/$/, "")}/f/confirm/${yield* tokens.signConfirm(submission.id, expiresAt)}`
          const consent = submission.consent as ConsentRecord
          const topics = consent.consents.filter((entry) => entry.ticked).map((entry) => entry.topicName)
          const what = content.title || row.formName
          const name = sender.legalName
          // No marketing here: German courts treat it as advertising sent without consent (D146).
          const lines = [
            `Someone, hopefully you, asked to sign up to "${what}" from ${name} with this address. Confirm to finish:`,
            ...(topics.length > 0 ? [`You also asked for: ${topics.join(", ")}.`] : []),
            "If this wasn't you, ignore this email. Nothing happens until you confirm, and we won't email you again about it.",
          ]
          const html = `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a">
<p>Hi,</p>
<p>${escapeHtml(lines[0] ?? "")}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1a1a1a;color:#ffffff;text-decoration:none;font-weight:600">Confirm</a></p>
${lines
  .slice(1)
  .map((line) => `<p style="color:#555555;font-size:14px">${escapeHtml(line)}</p>`)
  .join("\n")}
<p style="color:#888888;font-size:12px">${escapeHtml(sender.legalName)} · ${escapeHtml(sender.postalAddress)} · This link works for ${CONFIRM_LINK_DAYS} days.</p>
</body></html>`
          const text = `Hi,\n\n${lines[0]}\n\n${link}\n\n${lines.slice(1).join("\n\n")}\n\n${sender.legalName} · ${sender.postalAddress}\n`
          yield* mailer
            .send({
              to: submission.email,
              subject: `Confirm: ${what}`,
              html,
              text,
              from: sender.from,
              ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
            })
            .pipe(
              Effect.catchCause((cause) => Effect.logWarning(`form confirmation for ${submission.id} failed`, cause)),
            )
        })

      const accept = (submissionId: string) =>
        Effect.gen(function* () {
          const row = yield* load(submissionId)
          if (row?.submission.status !== "waiting") return
          if (row.content.doubleOptIn) return yield* sendConfirmation(row)
          // Without double opt-in, someone who left still has to confirm before they're back (D145).
          const existing = yield* run(contactByEmail(row.submission.teamId, row.submission.email))
          const needsConsent =
            existing !== undefined &&
            (existing.status === "unsubscribed" ||
              (yield* run(leftTicked(existing.id, row.submission.consent as ConsentRecord))))
          if (needsConsent) return yield* sendConfirmation(row)
          yield* apply(submissionId, null)
        })

      const apply = (submissionId: string, visitor: ConfirmingVisitor | null) =>
        Effect.gen(function* () {
          const row = yield* load(submissionId)
          if (!row) return "missing" as const
          if (row.submission.status === "confirmed") return "already" as const
          if (row.submission.status !== "waiting") return "missing" as const
          const { submission, content } = row
          const teamId = submission.teamId as TeamId
          const actor: SystemActor = { _tag: "SystemActor", name: `Form: ${row.formName}` }
          const related = { recordType: "form" as const, id: submission.formId, name: row.formName }
          const values = submission.values as Record<string, unknown>
          const consent = submission.consent as ConsentRecord
          // The form's fixed values fill in too, behind the visitor's own answers.
          const answers: Record<string, unknown> = { ...(content.set as Record<string, unknown>) }
          for (const [key, value] of Object.entries(values)) if (!isEmpty(value)) answers[key] = value
          // A fixed country may be written as a name; the contact keeps its code.
          if (typeof answers.country === "string") answers.country = countryCodeOf(answers.country) ?? answers.country
          const labels = new Map<string, string>(
            content.fields.map((field: FormField) => [formFieldKey(field), field.label]),
          )
          const customTypes = new Map(
            (yield* run(
              db.query((d) =>
                d
                  .select({
                    id: schema.customFields.id,
                    type: schema.customFields.type,
                    name: schema.customFields.name,
                  })
                  .from(schema.customFields)
                  .where(and(eq(schema.customFields.teamId, teamId), eq(schema.customFields.recordType, "contact"))),
              ),
            )).map((field) => [field.id, field]),
          )
          /** A fixed value from `set` is text; custom fields take their own kind of value. */
          const customValue = (id: string, value: unknown) => {
            const type = customTypes.get(id)?.type
            return typeof value === "string" && type ? setValueOf(type as CustomField["type"], value) : value
          }

          return yield* run(
            db.transaction(
              Effect.gen(function* () {
                // One at a time per address: two submissions for the same new address at once would
                // both create the contact, and the second would hit its unique email.
                yield* db.query((d) =>
                  d.execute(
                    sql`select pg_advisory_xact_lock(hashtextextended(${`form-apply:${teamId}:${submission.email}`}, 0))`,
                  ),
                )
                // Claim it: a second click on the link, or two at once, finds it already confirmed.
                const claimed = yield* db.query((d) =>
                  d
                    .update(schema.formSubmissions)
                    .set({
                      status: "confirmed",
                      confirmedAt: sql`now()`,
                      confirmIp: visitor?.ip ?? null,
                      confirmUserAgent: visitor?.userAgent ?? null,
                    })
                    .where(
                      and(eq(schema.formSubmissions.id, submission.id), eq(schema.formSubmissions.status, "waiting")),
                    )
                    .returning({ id: schema.formSubmissions.id }),
                )
                if (claimed.length === 0) return "already" as const

                const existing = yield* contactByEmail(teamId, submission.email)
                const contactColumns: Record<string, unknown> = {}
                const custom: Record<string, unknown> = {}
                for (const [key, value] of Object.entries(answers)) {
                  if (key in COLUMNS) contactColumns[COLUMNS[key as keyof typeof COLUMNS]] = value
                  else if (key.startsWith("custom:")) {
                    const id = key.slice("custom:".length)
                    if (customTypes.has(id)) {
                      const converted = customValue(id, value)
                      if (!isEmpty(converted)) custom[id] = converted
                    }
                  }
                }
                const phone = typeof answers.phone === "string" ? answers.phone : undefined
                const companyName = typeof answers.company === "string" ? answers.company.trim() : ""
                const title = typeof answers.title === "string" ? answers.title.trim() : ""
                const filled: Array<string> = []
                const kept: Array<{ field: string; label: string; value: unknown }> = []
                let contactId: string
                let outcome: "created" | "updated"

                if (!existing) {
                  contactId = crypto.randomUUID()
                  outcome = "created"
                  yield* db.query((d) =>
                    d.insert(schema.contacts).values({
                      id: contactId,
                      teamId,
                      firstName: (contactColumns.firstName as string | undefined) ?? null,
                      lastName: (contactColumns.lastName as string | undefined) ?? null,
                      city: (contactColumns.city as string | undefined) ?? null,
                      region: (contactColumns.region as string | undefined) ?? null,
                      country: (contactColumns.country as string | undefined) ?? null,
                      custom,
                      subscriptionStatus: "subscribed",
                    }),
                  )
                  yield* db.query((d) =>
                    d.insert(schema.contactEmails).values({
                      id: crypto.randomUUID(),
                      teamId,
                      contactId,
                      address: submission.email,
                      isPrimary: true,
                      position: 0,
                    }),
                  )
                  if (phone) {
                    yield* db.query((d) =>
                      d
                        .insert(schema.contactPhones)
                        .values({ id: crypto.randomUUID(), teamId, contactId, number: phone, position: 0 }),
                    )
                  }
                  yield* db.query((d) =>
                    d
                      .insert(schema.activity)
                      .values(
                        activityRow(actor, { teamId, recordType: "contact", recordId: contactId, kind: "created" }),
                      ),
                  )
                  // What was written: answers to custom fields that no longer exist weren't.
                  filled.push(
                    ...Object.keys(contactColumns),
                    ...Object.keys(custom).map((id) => `custom:${id}`),
                    ...(phone ? ["phone"] : []),
                    ...(companyName ? ["company"] : []),
                    ...(companyName && title ? ["title"] : []),
                  )
                } else {
                  contactId = existing.id
                  outcome = "updated"
                  const [current] = yield* db.query((d) =>
                    d.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)),
                  )
                  const updates: Record<string, unknown> = {}
                  for (const [column, value] of Object.entries(contactColumns)) {
                    const now = current?.[column as keyof typeof current]
                    if (isEmpty(now)) {
                      updates[column] = value
                      filled.push(column)
                    } else if (!same(now, value)) {
                      kept.push({ field: column, label: labels.get(column) ?? column, value })
                    }
                  }
                  const currentCustom = (current?.custom ?? {}) as Record<string, unknown>
                  const nextCustom = { ...currentCustom }
                  for (const [id, value] of Object.entries(custom)) {
                    if (isEmpty(currentCustom[id])) {
                      nextCustom[id] = value
                      filled.push(`custom:${id}`)
                    } else if (!same(currentCustom[id], value)) {
                      kept.push({
                        field: `custom:${id}`,
                        label: labels.get(`custom:${id}`) ?? customTypes.get(id)?.name ?? id,
                        value,
                      })
                    }
                  }
                  if (Object.keys(nextCustom).length !== Object.keys(currentCustom).length) updates.custom = nextCustom
                  if (phone) {
                    const phones = yield* db.query((d) =>
                      d
                        .select({ number: schema.contactPhones.number })
                        .from(schema.contactPhones)
                        .where(eq(schema.contactPhones.contactId, contactId)),
                    )
                    if (phones.length === 0) {
                      yield* db.query((d) =>
                        d
                          .insert(schema.contactPhones)
                          .values({ id: crypto.randomUUID(), teamId, contactId, number: phone, position: 0 }),
                      )
                      filled.push("phone")
                    } else if (!phones.some((entry) => entry.number === phone)) {
                      kept.push({ field: "phone", label: labels.get("phone") ?? "Phone", value: phone })
                    }
                  }
                  if (Object.keys(updates).length > 0) {
                    yield* db.query((d) =>
                      d
                        .update(schema.contacts)
                        .set({ ...updates, updatedAt: sql`now()` })
                        .where(eq(schema.contacts.id, contactId)),
                    )
                  }
                }

                // A company joins the contact's companies (adding isn't overwriting).
                if (companyName) {
                  // As for addresses: two new contacts naming one new company make one company.
                  yield* db.query((d) =>
                    d.execute(
                      sql`select pg_advisory_xact_lock(hashtextextended(${`form-company:${teamId}:${companyName.toLowerCase()}`}, 0))`,
                    ),
                  )
                  const [company] = yield* db.query((d) =>
                    d
                      .select({ id: schema.companies.id, name: schema.companies.name })
                      .from(schema.companies)
                      .where(
                        and(
                          eq(schema.companies.teamId, teamId),
                          isNull(schema.companies.deletedAt),
                          sql`lower(${schema.companies.name}) = lower(${companyName})`,
                        ),
                      )
                      .limit(1),
                  )
                  const companyId = company?.id ?? crypto.randomUUID()
                  if (!company) {
                    yield* db.query((d) =>
                      d.insert(schema.companies).values({ id: companyId, teamId, name: companyName }),
                    )
                    yield* db.query((d) =>
                      d
                        .insert(schema.activity)
                        .values(
                          activityRow(actor, { teamId, recordType: "company", recordId: companyId, kind: "created" }),
                        ),
                    )
                  }
                  const added = yield* db.query((d) =>
                    d
                      .insert(schema.affiliations)
                      .values({ id: crypto.randomUUID(), teamId, contactId, companyId, title: title || null })
                      .onConflictDoNothing()
                      .returning({ id: schema.affiliations.id }),
                  )
                  if (added.length > 0) {
                    const contactName = submission.email
                    yield* db.query((d) =>
                      d.insert(schema.activity).values([
                        activityRow(actor, {
                          teamId,
                          recordType: "contact",
                          recordId: contactId,
                          kind: "affiliated",
                          related: { recordType: "company", id: companyId, name: company?.name ?? companyName },
                        }),
                        activityRow(actor, {
                          teamId,
                          recordType: "company",
                          recordId: companyId,
                          kind: "affiliated",
                          related: { recordType: "contact", id: contactId, name: contactName },
                        }),
                      ]),
                    )
                  }
                }

                // Consent (D149): ticked opt-in topics are joined; ticked opt-out topics rejoined.
                const ticked = consent.consents.filter((entry) => entry.ticked)
                if (ticked.length > 0) {
                  const topics = yield* db.query((d) =>
                    d
                      .select({ id: schema.topics.id, name: schema.topics.name, mode: schema.topics.mode })
                      .from(schema.topics)
                      .where(
                        and(
                          eq(schema.topics.teamId, teamId),
                          inArray(
                            schema.topics.id,
                            ticked.map((entry) => entry.topicId),
                          ),
                        ),
                      ),
                  )
                  for (const topic of topics) {
                    // Someone who left is back (confirming got them here: D145), and an opt-in
                    // topic's members are the ones who joined (D149).
                    const rejoined = yield* db.query((d) =>
                      d
                        .delete(schema.topicUnsubscribes)
                        .where(
                          and(
                            eq(schema.topicUnsubscribes.contactId, contactId),
                            eq(schema.topicUnsubscribes.topicId, topic.id),
                          ),
                        )
                        .returning({ topicId: schema.topicUnsubscribes.topicId }),
                    )
                    const joined =
                      topic.mode === "opt-in"
                        ? yield* db.query((d) =>
                            d
                              .insert(schema.topicMembers)
                              .values({ teamId, contactId, topicId: topic.id, submissionId: submission.id })
                              .onConflictDoNothing()
                              .returning({ topicId: schema.topicMembers.topicId }),
                          )
                        : rejoined
                    if (joined.length + rejoined.length > 0 && existing) {
                      yield* db.query((d) =>
                        d.insert(schema.activity).values(
                          activityRow(actor, {
                            teamId,
                            recordType: "contact",
                            recordId: contactId,
                            kind: "resubscribed",
                            topicName: topic.name,
                          }),
                        ),
                      )
                    }
                  }
                }

                // Someone who left all email is back only because they confirmed (D145). A bounce or
                // a spam report stays: a form can't vouch for an address that doesn't take mail.
                if (existing?.status === "unsubscribed") {
                  yield* db.query((d) =>
                    d
                      .update(schema.contacts)
                      .set({ subscriptionStatus: "subscribed", updatedAt: sql`now()` })
                      .where(eq(schema.contacts.id, contactId)),
                  )
                  yield* db.query((d) =>
                    d.insert(schema.activity).values(
                      activityRow(actor, {
                        teamId,
                        recordType: "contact",
                        recordId: contactId,
                        kind: "resubscribed",
                      }),
                    ),
                  )
                }

                if (content.segmentId) {
                  const [segment] = yield* db.query((d) =>
                    d
                      .select({ kind: schema.segments.kind })
                      .from(schema.segments)
                      .where(
                        and(eq(schema.segments.teamId, teamId), eq(schema.segments.id, content.segmentId as string)),
                      ),
                  )
                  if (segment?.kind === "fixed") {
                    yield* db.query((d) =>
                      d
                        .insert(schema.segmentContacts)
                        .values({ teamId, segmentId: content.segmentId as string, contactId })
                        .onConflictDoNothing(),
                    )
                  }
                }

                yield* db.query((d) =>
                  d.insert(schema.activity).values(
                    activityRow(actor, {
                      teamId,
                      recordType: "contact",
                      recordId: contactId,
                      kind: "submitted-form",
                      changedFields: filled,
                      related,
                      kept,
                      // Where the submission came from (D153), if the form recorded any of it.
                      tracking:
                        submission.page ||
                        Object.keys(submission.utm).length > 0 ||
                        Object.keys(submission.clickIds).length > 0
                          ? { page: submission.page, utm: submission.utm, clickIds: submission.clickIds }
                          : null,
                    }),
                  ),
                )
                yield* db.query((d) =>
                  d
                    .update(schema.formSubmissions)
                    .set({ contactId, outcome })
                    .where(eq(schema.formSubmissions.id, submission.id)),
                )
                if (!existing) {
                  // Domain matching, as for any new contact (D105).
                  const name =
                    [contactColumns.firstName, contactColumns.lastName].filter(Boolean).join(" ") || submission.email
                  yield* affiliations.matchContact(actor, teamId, { id: contactId, name }, [submission.email])
                }
                return "applied" as const
              }),
            ),
          )
        })

      return { accept, apply }
    }),
  )
}
