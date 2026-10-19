import { Database } from "@parley/db"
import { sql } from "drizzle-orm"
import { Context, Duration, Effect, Layer, Schedule } from "effect"
import { RESTORE_WINDOW_DAYS } from "./contacts.ts"

/** How many records were purged, by kind. */
export interface Purged {
  readonly contacts: number
  readonly companies: number
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
      const run = Effect.gen(function* () {
        const contacts = yield* purgeTable("contacts", "contact")
        const companies = yield* purgeTable("companies", "company")
        if (contacts + companies > 0) yield* Effect.logInfo(`purged ${contacts} contacts and ${companies} companies`)
        return { contacts, companies }
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
