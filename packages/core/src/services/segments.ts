import { Database, schema } from "@parley/db"
import {
  type DatabaseUnavailable,
  type Filter,
  InputRejected,
  type Segment,
  type SegmentId,
  SegmentLimitReached,
  type TeamId,
} from "@parley/domain"
import { userText } from "@parley/errors"
import { and, asc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { ContactsInTeam } from "../proofs/contact-in-team.ts"
import type { CanWriteEmail, MemberOf } from "../proofs/permissions.ts"
import type { SegmentInTeam, SegmentIsFixed } from "../proofs/segment-in-team.ts"
import type { ContactScope } from "./contacts.ts"
import { CustomFields } from "./custom-fields.ts"
import { checkFilter, filterSql } from "./filter-sql.ts"
import { classifySqlError } from "./sql-errors.ts"

const EMPTY: Filter = { match: "all", conditions: [] }

/** Every segment is counted whenever segments are listed, so a team can have only so many. */
const SEGMENT_LIMIT = 200

export interface SegmentInput {
  readonly name?: string | undefined
  readonly filter?: Filter | undefined
}

/** Who a campaign can go to: subscribed, with an email address that's in use. */
export const SENDABLE = sql`"contacts"."subscription_status" = 'subscribed' and exists (
  select 1 from "contact_emails" e where e.contact_id = "contacts"."id" and e.active)`

/**
 * Segments (D23): groups of contacts a campaign is sent to. Process tier. A dynamic segment's
 * contacts are its filter's matches at the moment of asking; a fixed one's are listed.
 */
export class Segments extends Context.Service<
  Segments,
  {
    readonly list: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<Segment>, DatabaseUnavailable>
    /** Used only by the SegmentInTeam prover. */
    readonly locate: (teamId: TeamId, id: SegmentId) => Effect.Effect<Segment | undefined, DatabaseUnavailable>
    /** Which contacts are in the segment, for Contacts.list and for sending. */
    readonly scope: <K, T>(target: SegmentInTeam<K, T>) => Effect.Effect<ContactScope, DatabaseUnavailable>
    readonly create: <P, T>(
      access: CanWriteEmail<P, T>,
      input: { readonly name: string; readonly kind: "dynamic" | "fixed"; readonly filter?: Filter | undefined },
    ) => Effect.Effect<Segment, InputRejected | SegmentLimitReached | DatabaseUnavailable>
    readonly update: <P, T, K>(
      target: SegmentInTeam<K, T>,
      input: SegmentInput,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Segment, InputRejected | DatabaseUnavailable>
    readonly delete: <P, T, K>(
      target: SegmentInTeam<K, T>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Segment, DatabaseUnavailable>
    readonly addContacts: <P, T, K>(
      target: SegmentInTeam<K, T>,
      fixed: SegmentIsFixed<K>,
      contacts: ContactsInTeam<T>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Segment, DatabaseUnavailable>
    readonly removeContacts: <P, T, K>(
      target: SegmentInTeam<K, T>,
      fixed: SegmentIsFixed<K>,
      contactIds: ReadonlyArray<string>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Segment, DatabaseUnavailable>
  }
>()("@parley/core/Segments") {
  static readonly layer = Layer.effect(
    Segments,
    Effect.gen(function* () {
      const db = yield* Database
      const customFields = yield* CustomFields
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      type Row = typeof schema.segments.$inferSelect

      /** The membership condition over "contacts" for a stored segment. */
      const whereOf = (row: Row) =>
        Effect.gen(function* () {
          if (row.kind === "fixed") {
            return sql`exists (select 1 from "segment_contacts" sc
              where sc.contact_id = "contacts"."id" and sc.segment_id = ${row.id})`
          }
          const filter = (row.filter as Filter | null) ?? EMPTY
          if (filter.conditions.length === 0) return sql`true`
          const custom = yield* customFields.ofTeam(row.teamId as TeamId, "contact")
          // A filter saved earlier can name a field deleted since: it then matches nobody.
          const checked = yield* Effect.option(checkFilter("contact", filter, custom))
          return checked._tag === "Some" ? (filterSql("contact", filter, checked.value) ?? sql`true`) : sql`false`
        })

      const counted = (row: Row) =>
        Effect.gen(function* () {
          const where = yield* whereOf(row)
          const [counts] = yield* run(
            db.query((d) =>
              d
                .select({
                  contacts: sql<number>`count(*)::int`,
                  sendable: sql<number>`count(*) filter (where ${SENDABLE})::int`,
                })
                .from(schema.contacts)
                .where(and(eq(schema.contacts.teamId, row.teamId), isNull(schema.contacts.deletedAt), where as SQL)),
            ),
          )
          const segment: Segment = {
            id: row.id as SegmentId,
            name: row.name,
            kind: row.kind,
            filter: row.kind === "dynamic" ? ((row.filter as Filter | null) ?? EMPTY) : null,
            contactCount: Number(counts?.contacts ?? 0),
            sendableCount: Number(counts?.sendable ?? 0),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }
          return segment
        })

      const rowOf = (teamId: string, id: string) =>
        run(
          db.query((d) =>
            d
              .select()
              .from(schema.segments)
              .where(and(eq(schema.segments.teamId, teamId), eq(schema.segments.id, id))),
          ),
        ).pipe(Effect.map(([row]) => row))

      const one = (teamId: string, id: string) =>
        Effect.flatMap(rowOf(teamId, id), (row) => (row ? counted(row) : Effect.die(new Error("segment vanished"))))

      const checked = (teamId: TeamId, filter: Filter) =>
        Effect.flatMap(customFields.ofTeam(teamId, "contact"), (custom) => checkFilter("contact", filter, custom))

      const fixedHasNoFilter = new InputRejected({
        problems: [
          {
            field: "filter",
            problem: "not-allowed",
            userMessage: userText`A fixed segment has no filter: its contacts are picked by hand. Create a dynamic segment to use a filter.`,
          },
        ],
      })

      return {
        list: (member) =>
          Effect.gen(function* () {
            const rows = yield* run(
              db.query((d) =>
                d
                  .select()
                  .from(schema.segments)
                  .where(eq(schema.segments.teamId, member.team.value))
                  .orderBy(asc(schema.segments.name)),
              ),
            )
            return yield* Effect.forEach(rows, counted, { concurrency: 4 })
          }),
        locate: (teamId, id) =>
          Effect.flatMap(rowOf(teamId, id), (row) => (row ? counted(row) : Effect.succeed(undefined))),
        scope: (target) =>
          Effect.gen(function* () {
            const row = yield* rowOf(target.team.value, target.segment.value)
            return { where: row ? yield* whereOf(row) : sql`false` }
          }),
        create: (access, input) =>
          Effect.gen(function* () {
            const teamId = access.member.team.value
            if (input.kind === "fixed" && input.filter && input.filter.conditions.length > 0) {
              return yield* Effect.fail(fixedHasNoFilter)
            }
            if (input.kind === "dynamic" && input.filter) yield* checked(teamId, input.filter)
            const [existing] = yield* run(
              db.query((d) =>
                d
                  .select({ count: sql<number>`count(*)::int` })
                  .from(schema.segments)
                  .where(eq(schema.segments.teamId, teamId)),
              ),
            )
            if (Number(existing?.count ?? 0) >= SEGMENT_LIMIT) {
              return yield* new SegmentLimitReached({ team: access.member.teamName, limit: SEGMENT_LIMIT })
            }
            const id = crypto.randomUUID()
            yield* run(
              db.query((d) =>
                d.insert(schema.segments).values({
                  id,
                  teamId,
                  name: input.name,
                  kind: input.kind,
                  filter: input.kind === "dynamic" ? (input.filter ?? EMPTY) : null,
                }),
              ),
            )
            return yield* one(teamId, id)
          }).pipe(Effect.withSpan("Segments.create")),
        update: (target, input) =>
          Effect.gen(function* () {
            const teamId = target.team.value
            if (input.filter && target.found.kind === "fixed") return yield* Effect.fail(fixedHasNoFilter)
            if (input.filter) yield* checked(teamId, input.filter)
            yield* run(
              db.query((d) =>
                d
                  .update(schema.segments)
                  .set({
                    ...(input.name !== undefined ? { name: input.name } : {}),
                    ...(input.filter !== undefined ? { filter: input.filter } : {}),
                    updatedAt: sql`now()`,
                  })
                  .where(and(eq(schema.segments.teamId, teamId), eq(schema.segments.id, target.segment.value))),
              ),
            )
            return yield* one(teamId, target.segment.value)
          }).pipe(Effect.withSpan("Segments.update")),
        delete: (target) =>
          Effect.gen(function* () {
            yield* run(
              db.query((d) =>
                d
                  .delete(schema.segments)
                  .where(
                    and(eq(schema.segments.teamId, target.team.value), eq(schema.segments.id, target.segment.value)),
                  ),
              ),
            )
            return target.found
          }).pipe(Effect.withSpan("Segments.delete")),
        addContacts: (target, _fixed, contacts) =>
          Effect.gen(function* () {
            const teamId = target.team.value
            if (contacts.contactIds.length > 0) {
              yield* run(
                db.query((d) =>
                  d
                    .insert(schema.segmentContacts)
                    .values(
                      contacts.contactIds.map((contactId) => ({ teamId, segmentId: target.segment.value, contactId })),
                    )
                    .onConflictDoNothing(),
                ),
              )
              yield* touch(teamId, target.segment.value)
            }
            return yield* one(teamId, target.segment.value)
          }).pipe(Effect.withSpan("Segments.addContacts")),
        removeContacts: (target, _fixed, contactIds) =>
          Effect.gen(function* () {
            const teamId = target.team.value
            yield* run(
              db.query((d) =>
                d
                  .delete(schema.segmentContacts)
                  .where(
                    and(
                      eq(schema.segmentContacts.teamId, teamId),
                      eq(schema.segmentContacts.segmentId, target.segment.value),
                      inArray(schema.segmentContacts.contactId, [...contactIds]),
                    ),
                  ),
              ),
            )
            yield* touch(teamId, target.segment.value)
            return yield* one(teamId, target.segment.value)
          }).pipe(Effect.withSpan("Segments.removeContacts")),
      }

      function touch(teamId: string, id: string) {
        return run(
          db.query((d) =>
            d
              .update(schema.segments)
              .set({ updatedAt: sql`now()` })
              .where(and(eq(schema.segments.teamId, teamId), eq(schema.segments.id, id))),
          ),
        )
      }
    }),
  )
}
