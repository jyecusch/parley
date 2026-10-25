import { Database } from "@parley/db"
import { sql } from "drizzle-orm"
import { Context, Duration, Effect, Layer, Schedule } from "effect"
import { RESTORE_WINDOW_DAYS } from "./contacts.ts"

/** How many records were purged, by kind. A purged contact's form submissions go with it. */
export interface Purged {
  readonly contacts: number
  readonly companies: number
  /** Form submissions: spam past 30 days, deleted (D147); confirmation links past 7, expired (D146). */
  readonly spam: number
  readonly expired: number
}

/**
 * Purges records deleted more than 30 days ago (D30), with their notes and activity. Process tier:
 * it runs for every team, so it takes no team and needs no proof; it only ever removes what people
 * already deleted. Emails, phones, domains and affiliations go with their records by cascade.
 */
export class Purge extends Context.Service<Purge, { readonly run: Effect.Effect<Purged> }>()("@parley/core/Purge") {
  static readonly layer = Layer.effect(
    Purge,
    Effect.gen(function* () {
      const db = yield* Database
      const purgeTable = (table: "contacts" | "companies", recordType: "contact" | "company") =>
        db
          .transaction(
            Effect.gen(function* () {
              const expired = sql`select id from ${sql.raw(`"${table}"`)}
                where deleted_at is not null and deleted_at < now() - make_interval(days => ${RESTORE_WINDOW_DAYS})`
              yield* db.query((d) =>
                d.execute(sql`delete from "notes" where record_type = ${recordType} and record_id in (${expired})`),
              )
              yield* db.query((d) =>
                d.execute(sql`delete from "activity" where record_type = ${recordType} and record_id in (${expired})`),
              )
              // A purged contact's form submissions go too: their answers, address and consent records.
              if (table === "contacts") {
                yield* db.query((d) => d.execute(sql`delete from "form_submissions" where contact_id in (${expired})`))
              }
              const removed = yield* db.query((d) =>
                d.execute(sql`delete from ${sql.raw(`"${table}"`)} where id in (${expired}) returning id`),
              )
              return (
                (removed as unknown as { readonly rows?: ReadonlyArray<unknown> }).rows?.length ??
                (Array.isArray(removed) ? removed.length : 0)
              )
            }),
          )
          .pipe(Effect.orDie)
      const count = (result: unknown) =>
        (result as { readonly rows?: ReadonlyArray<unknown> }).rows?.length ??
        (Array.isArray(result) ? result.length : 0)
      const purgeForms = Effect.gen(function* () {
        const spam = yield* db.query((d) =>
          d.execute(sql`delete from "form_submissions"
            where status = 'spam' and created_at < now() - make_interval(days => 30) returning id`),
        )
        // Unconfirmed after the link's 7 days: never a contact, so their answers go too (D146).
        const expired = yield* db.query((d) =>
          d.execute(sql`update "form_submissions" set status = 'expired', values = '{}'::jsonb
            where status = 'waiting' and waiting_since < now() - make_interval(days => 7) returning id`),
        )
        yield* db.query((d) => d.execute(sql`delete from "form_token_uses" where expires_at < now()`))
        return { spam: count(spam), expired: count(expired) }
      }).pipe(Effect.orDie)
      const run = Effect.gen(function* () {
        const contacts = yield* purgeTable("contacts", "contact")
        const companies = yield* purgeTable("companies", "company")
        const { spam, expired } = yield* purgeForms
        if (contacts + companies > 0) yield* Effect.logInfo(`purged ${contacts} contacts and ${companies} companies`)
        if (spam + expired > 0) yield* Effect.logInfo(`purged ${spam} spam submissions; ${expired} expired`)
        return { contacts, companies, spam, expired }
      }).pipe(Effect.withSpan("Purge.run"))
      return { run }
    }),
  )

  /** Runs the purge hourly for as long as the server runs. A failed run is logged and retried next hour. */
  static readonly schedule = Layer.effectDiscard(
    Effect.gen(function* () {
      const purge = yield* Purge
      yield* Effect.forkScoped(
        purge.run.pipe(
          Effect.catchCause((cause) => Effect.logWarning("purge failed", cause)),
          Effect.repeat(Schedule.spaced(Duration.hours(1))),
        ),
      )
    }),
  )
}
