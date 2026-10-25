import { Database, schema } from "@parley/db"
import {
  type ActivityEntry,
  type Contact,
  ContactEmailTaken,
  type ContactFields,
  type ContactId,
  type ContactPage,
  type CustomValues,
  type CustomValuesPatch,
  type DatabaseUnavailable,
  type FieldProblem,
  type Filter,
  filterFields,
  InputRejected,
  isUuid,
  type Matching,
  type PostalAddress,
  type Selection,
  type Sort,
  type TeamId,
  type UserId,
} from "@parley/domain"
import { DisplayName, EchoedInput, userText } from "@parley/errors"
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { Principal } from "../principal.ts"
import type { ContactInTeam, ContactRestorable, ContactsInTeam } from "../proofs/contact-in-team.ts"
import type { CanDeleteRecords, CanManageEmail, CanReadRecords, CanWriteRecords } from "../proofs/permissions.ts"
import type { Named } from "../proofs/proof.ts"
import type { RecordOwnerChange } from "../proofs/record-owner.ts"
import { activityRow, toActivityEntry } from "./activity.ts"
import { addressColumns, addressOfRow, normalizeAddress } from "./addresses.ts"
import { Affiliations } from "./affiliations.ts"
import { decodeCursor, decodeOffset, encodeCursor, encodeOffset, MAX_OFFSET } from "./cursors.ts"
import { CustomFields } from "./custom-fields.ts"
import { FileStore, fileUrl } from "./file-store.ts"
import { checkFilter, filterSql, sortSql } from "./filter-sql.ts"
import { uniqueProfiles } from "./social-profiles.ts"
import { classifySqlError, isUniqueViolation } from "./sql-errors.ts"

/** Deleted contacts can be restored for this long, then they're purged (D30). */
export const RESTORE_WINDOW_DAYS = 30

export interface ContactQuery {
  readonly search?: string | undefined
  readonly filter?: Filter | undefined
  readonly sort?: Sort | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  /** A position in the sorted list to start at, instead of a cursor (D136). */
  readonly offset?: number | undefined
  readonly deleted?: boolean | undefined
}

/** Narrows a list to a group of contacts, such as a segment's. Made by the service that owns the group. */
export interface ContactScope {
  readonly where: SQL
}

/**
 * The live contacts in team T a selection covers (D137), as a condition. Made by `selection`;
 * read a chunk at a time with `selectChunk`.
 */
export interface ContactSelection<T> {
  readonly team: Named<T, TeamId>
  readonly where: SQL
}

/** How many records an action on a selection handles at once (D137). */
export const SELECTION_CHUNK = 1000

/** Which contacts a lookup may find: live ones, or deleted ones still inside the restore window. */
export type ContactState = "live" | "restorable"

/** A contact the ContactInTeam prover found. Only provers turn this into a proof. */
export interface LocatedContact {
  readonly id: ContactId
  readonly deleted: boolean
}

const EMAILS_KEY = "contact_emails_team_id_address_key"

/** Contacts whose name or any email contains the search, case-insensitively. Undefined for no search. */
const searchSql = (search: string | undefined): SQL | undefined => {
  const trimmed = search?.trim()
  if (!trimmed) return undefined
  const pattern = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return or(
    ilike(sql`coalesce(${schema.contacts.firstName}, '') || ' ' || coalesce(${schema.contacts.lastName}, '')`, pattern),
    sql`exists (select 1 from ${schema.contactEmails} where ${schema.contactEmails.contactId} = ${schema.contacts.id} and ${schema.contactEmails.address} ilike ${pattern})`,
  )
}

/** Deleted contacts that can still be restored. */
const restorableSql = and(
  isNotNull(schema.contacts.deletedAt),
  sql`${schema.contacts.deletedAt} > now() - make_interval(days => ${RESTORE_WINDOW_DAYS})`,
)

const displayNameOf = (firstName: string | null, lastName: string | null, primaryEmail: string | undefined) =>
  [firstName, lastName].filter(Boolean).join(" ") || primaryEmail || "Unnamed contact"

interface NormalizedFields {
  readonly firstName?: string | null
  readonly lastName?: string | null
  readonly emails?: ReadonlyArray<{ readonly address: string; readonly isPrimary: boolean }>
  readonly phones?: ReadonlyArray<{ readonly number: string; readonly label: string | null }>
  readonly address?: PostalAddress | null
  readonly socialProfiles?: ReadonlyArray<string>
}

/**
 * What only an import may set (D125, D129): a new record's original created date, and a
 * subscription status a CRM export reports. Never used to subscribe someone again.
 */
export interface ImportedContact {
  readonly createdAt?: Date | undefined
  readonly status?: "unsubscribed" | "bounced" | undefined
}

/** Rules that span fields. Each problem names its field and never echoes the value (D26). */
const normalize = (fields: ContactFields, creating: boolean): Effect.Effect<NormalizedFields, InputRejected> => {
  const problems: Array<FieldProblem> = []
  let emails: NormalizedFields["emails"]
  if (fields.emails !== undefined) {
    const seen = new Set<string>()
    const lowered = fields.emails.map((email, index) => {
      const address = email.address.toLowerCase()
      if (seen.has(address)) {
        problems.push({
          field: `emails.${index}.address`,
          problem: "conflict",
          userMessage: userText`This email is listed twice. List each email once.`,
        })
      }
      seen.add(address)
      return { address, isPrimary: email.isPrimary === true }
    })
    const primaries = lowered.filter((email) => email.isPrimary).length
    if (primaries > 1) {
      problems.push({
        field: "emails",
        problem: "conflict",
        userMessage: userText`Only one email can be primary.`,
      })
    }
    emails = primaries === 0 ? lowered.map((email, index) => ({ ...email, isPrimary: index === 0 })) : lowered
  }
  if (creating) {
    const hasName = Boolean(fields.firstName || fields.lastName)
    const hasEmail = (fields.emails?.length ?? 0) > 0
    if (!hasName && !hasEmail) {
      problems.push({
        field: "firstName",
        problem: "missing",
        userMessage: userText`Add a name or an email so you can find this contact again.`,
      })
    }
  }
  if (problems.length > 0) return Effect.fail(new InputRejected({ problems }))
  return Effect.succeed({
    ...(fields.firstName !== undefined ? { firstName: fields.firstName } : {}),
    ...(fields.lastName !== undefined ? { lastName: fields.lastName } : {}),
    ...(emails !== undefined ? { emails } : {}),
    ...(fields.phones !== undefined
      ? { phones: fields.phones.map((phone) => ({ number: phone.number, label: phone.label ?? null })) }
      : {}),
    ...(fields.address !== undefined ? { address: normalizeAddress(fields.address) } : {}),
    ...(fields.socialProfiles !== undefined ? { socialProfiles: uniqueProfiles(fields.socialProfiles) } : {}),
  })
}

export class Contacts extends Context.Service<
  Contacts,
  {
    readonly list: <P, T>(
      team: Named<T, TeamId>,
      query: ContactQuery,
      access: CanReadRecords<P, T>,
      within?: ContactScope,
    ) => Effect.Effect<ContactPage, InputRejected | DatabaseUnavailable>
    /** The contacts a selection covers (D137). Fails on a filter the list would refuse. */
    readonly selection: <P, T>(
      team: Named<T, TeamId>,
      selection: Selection,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<ContactSelection<T>, InputRejected | DatabaseUnavailable>
    /** Used only by the ContactsInTeam prover: the next ids of a selection, in id order, after `after`. */
    readonly selectChunk: <T>(
      selection: ContactSelection<T>,
      after: ContactId | undefined,
    ) => Effect.Effect<ReadonlyArray<ContactId>, DatabaseUnavailable>
    /**
     * Sets custom field values (as a patch, like update) and the record owner on many contacts.
     * Returns how many live contacts it looked at.
     */
    readonly updateMany: <P, T>(
      contacts: ContactsInTeam<T>,
      change: { readonly custom?: CustomValuesPatch | undefined; readonly owner?: RecordOwnerChange<T> },
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<number, InputRejected | DatabaseUnavailable>
    /** Deletes many contacts with one shared `deletedAt`, so restoreMany can bring back exactly those. */
    readonly deleteMany: <P, T>(
      contacts: ContactsInTeam<T>,
      deletedAt: Date,
      access: CanDeleteRecords<P, T>,
    ) => Effect.Effect<number, DatabaseUnavailable>
    /** Restores the contacts deleted at `deletedAt` that can be; returns how many. */
    readonly restoreMany: <P, T>(
      team: Named<T, TeamId>,
      deletedAt: Date,
      access: CanDeleteRecords<P, T>,
    ) => Effect.Effect<number, DatabaseUnavailable>
    /** Used only by the ContactsInTeam prover: which of these ids are live contacts in the team. */
    readonly locateMany: <P, T>(
      team: Named<T, TeamId>,
      contactIds: ReadonlyArray<ContactId>,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<ReadonlySet<string>, DatabaseUnavailable>
    /** For imports: the live contact each of these addresses (lower-case) belongs to, if any. */
    readonly matchEmails: <P, T>(
      team: Named<T, TeamId>,
      addresses: ReadonlyArray<string>,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<ReadonlyMap<string, ContactId>, DatabaseUnavailable>
    /** Used only by the ContactInTeam and ContactRestorable provers. */
    readonly locate: <P, T>(
      team: Named<T, TeamId>,
      contactId: ContactId,
      state: ContactState,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<LocatedContact | undefined, DatabaseUnavailable>
    readonly get: <C, T>(target: ContactInTeam<C, T>) => Effect.Effect<Contact, DatabaseUnavailable>
    readonly create: <P, T>(
      team: Named<T, TeamId>,
      fields: ContactFields,
      access: CanWriteRecords<P, T>,
      /** The record owner (D123), already proven a member; undefined leaves none. `fields.ownerId` is ignored. */
      owner?: RecordOwnerChange<T>,
      imported?: ImportedContact,
    ) => Effect.Effect<Contact, InputRejected | ContactEmailTaken | DatabaseUnavailable>
    /**
     * Subscribing someone again who unsubscribed, bounced or marked mail as spam also takes
     * `resubscribe`: email:manage, not just records:write (opt-outs are a legal matter).
     */
    readonly update: <P, T, C>(
      target: ContactInTeam<C, T>,
      fields: ContactFields,
      access: CanWriteRecords<P, T>,
      resubscribe?: CanManageEmail<P, T>,
      /** Undefined leaves the record owner as it is, null clears it (D123). `fields.ownerId` is ignored. */
      owner?: RecordOwnerChange<T>,
      /** Only for imports: a status from a CRM export (D125). Its createdAt is ignored here. */
      imported?: ImportedContact,
    ) => Effect.Effect<Contact, InputRejected | ContactEmailTaken | DatabaseUnavailable>
    readonly delete: <P, T, C>(
      target: ContactInTeam<C, T>,
      access: CanDeleteRecords<P, T>,
    ) => Effect.Effect<Contact, DatabaseUnavailable>
    readonly restore: <P, T, C>(
      target: ContactRestorable<C, T>,
      access: CanDeleteRecords<P, T>,
    ) => Effect.Effect<Contact, ContactEmailTaken | DatabaseUnavailable>
    readonly activity: <C, T>(
      target: ContactInTeam<C, T>,
    ) => Effect.Effect<ReadonlyArray<ActivityEntry>, DatabaseUnavailable>
    /** Stores a normalized avatar (D75, D76), or removes it with null. */
    readonly setAvatar: <P, T, C>(
      target: ContactInTeam<C, T>,
      image: Uint8Array | null,
      access: CanWriteRecords<P, T>,
    ) => Effect.Effect<Contact, DatabaseUnavailable>
  }
>()("@parley/core/Contacts") {
  static readonly layer = Layer.effect(
    Contacts,
    Effect.gen(function* () {
      const db = yield* Database
      const affiliations = yield* Affiliations
      const customFields = yield* CustomFields
      const files = yield* FileStore
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      /** Loads full contacts, with emails, phones and companies, in the order of `ids`. */
      const load = (teamId: TeamId, ids: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (ids.length === 0) return []
          const [rows, emails, phones, companies] = yield* Effect.all([
            run(
              db.query((d) =>
                d
                  .select({ contact: schema.contacts, ownerName: schema.user.name })
                  .from(schema.contacts)
                  .leftJoin(schema.user, eq(schema.user.id, schema.contacts.ownerId))
                  .where(and(eq(schema.contacts.teamId, teamId), inArray(schema.contacts.id, [...ids]))),
              ),
            ),
            run(
              db.query((d) =>
                d
                  .select()
                  .from(schema.contactEmails)
                  .where(
                    and(eq(schema.contactEmails.teamId, teamId), inArray(schema.contactEmails.contactId, [...ids])),
                  )
                  .orderBy(asc(schema.contactEmails.position)),
              ),
            ),
            run(
              db.query((d) =>
                d
                  .select()
                  .from(schema.contactPhones)
                  .where(
                    and(eq(schema.contactPhones.teamId, teamId), inArray(schema.contactPhones.contactId, [...ids])),
                  )
                  .orderBy(asc(schema.contactPhones.position)),
              ),
            ),
            affiliations.forContacts(teamId, ids),
          ])
          const byId = new Map(rows.map((row) => [row.contact.id, row]))
          return ids.flatMap((id): Array<Contact> => {
            const found = byId.get(id)
            if (!found) return []
            const row = found.contact
            const contactEmails = emails.filter((email) => email.contactId === id)
            const primary = contactEmails.find((email) => email.isPrimary)?.address ?? contactEmails[0]?.address
            return [
              {
                id: row.id as ContactId,
                teamId: row.teamId as TeamId,
                firstName: row.firstName,
                lastName: row.lastName,
                displayName: displayNameOf(row.firstName, row.lastName, primary),
                emails: contactEmails.map((email) => ({
                  address: email.address as Contact["emails"][number]["address"],
                  isPrimary: email.isPrimary,
                })),
                phones: phones
                  .filter((phone) => phone.contactId === id)
                  .map((phone) => ({
                    number: phone.number as Contact["phones"][number]["number"],
                    label: phone.label,
                  })),
                affiliations: companies.get(id) ?? [],
                custom: row.custom as Contact["custom"],
                address: addressOfRow(row),
                socialProfiles: row.socialProfiles,
                avatarUrl: fileUrl(row.avatarKey),
                subscriptionStatus: row.subscriptionStatus,
                ownerId: row.ownerId as UserId | null,
                ownerName: row.ownerId ? found.ownerName : null,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
                deletedAt: row.deletedAt?.toISOString() ?? null,
              },
            ]
          })
        })

      const loadOne = (teamId: TeamId, id: ContactId) =>
        Effect.flatMap(load(teamId, [id]), ([contact]) =>
          contact ? Effect.succeed(contact) : Effect.die(`contact ${id} vanished inside a proven operation`),
        )

      /** Finds a contact (other than `except`) already using one of `addresses`. */
      const findEmailOwner = (teamId: TeamId, addresses: ReadonlyArray<string>, except: string | undefined) =>
        run(
          db.query((d) =>
            d
              .select({
                address: schema.contactEmails.address,
                contactId: schema.contactEmails.contactId,
                firstName: schema.contacts.firstName,
                lastName: schema.contacts.lastName,
              })
              .from(schema.contactEmails)
              .innerJoin(schema.contacts, eq(schema.contacts.id, schema.contactEmails.contactId))
              .where(
                and(
                  eq(schema.contactEmails.teamId, teamId),
                  eq(schema.contactEmails.active, true),
                  inArray(schema.contactEmails.address, [...addresses]),
                  except ? ne(schema.contactEmails.contactId, except) : undefined,
                ),
              )
              .limit(1),
          ),
        )

      const emailTaken = (teamName: DisplayName, teamId: TeamId, addresses: ReadonlyArray<string>, except?: string) =>
        Effect.flatMap(findEmailOwner(teamId, addresses, except), ([owner]) =>
          owner
            ? Effect.fail(
                new ContactEmailTaken({
                  team: teamName,
                  email: EchoedInput.fromRequest(owner.address),
                  existing: owner.contactId as ContactId,
                  existingName: DisplayName.fromRecord(displayNameOf(owner.firstName, owner.lastName, owner.address)),
                }),
              )
            : Effect.void,
        )

      /** Runs a write; a unique-email race that slipped past the pre-check is reported the same way. */
      const write = <A>(
        teamName: DisplayName,
        teamId: TeamId,
        addresses: ReadonlyArray<string>,
        except: string | undefined,
        effect: Effect.Effect<A, SqlError.SqlError>,
      ) =>
        db
          .transaction(effect)
          .pipe(
            Effect.catchTag("SqlError", (error) =>
              isUniqueViolation(error, EMAILS_KEY)
                ? Effect.flatMap(emailTaken(teamName, teamId, addresses, except), () => Effect.die(error))
                : classifySqlError(error),
            ),
          )

      const replaceEmails = (teamId: TeamId, contactId: string, emails: NormalizedFields["emails"]) =>
        emails === undefined
          ? Effect.void
          : Effect.gen(function* () {
              yield* db.query((d) =>
                d.delete(schema.contactEmails).where(eq(schema.contactEmails.contactId, contactId)),
              )
              if (emails.length === 0) return
              yield* db.query((d) =>
                d.insert(schema.contactEmails).values(
                  emails.map((email, position) => ({
                    id: crypto.randomUUID(),
                    teamId,
                    contactId,
                    address: email.address,
                    isPrimary: email.isPrimary,
                    position,
                  })),
                ),
              )
            })

      const replacePhones = (teamId: TeamId, contactId: string, phones: NormalizedFields["phones"]) =>
        phones === undefined
          ? Effect.void
          : Effect.gen(function* () {
              yield* db.query((d) =>
                d.delete(schema.contactPhones).where(eq(schema.contactPhones.contactId, contactId)),
              )
              if (phones.length === 0) return
              yield* db.query((d) =>
                d.insert(schema.contactPhones).values(
                  phones.map((phone, position) => ({
                    id: crypto.randomUUID(),
                    teamId,
                    contactId,
                    number: phone.number,
                    label: phone.label,
                    position,
                  })),
                ),
              )
            })

      const recordActivity = (
        principal: Principal,
        teamId: TeamId,
        contactId: string,
        kind: ActivityEntry["kind"],
        changedFields: ReadonlyArray<string>,
        /** When it happened, if not now: an imported record's original created date (D129). */
        at?: Date,
      ) =>
        db.query((d) =>
          d.insert(schema.activity).values({
            ...activityRow(principal, { teamId, recordType: "contact", recordId: contactId, kind, changedFields }),
            ...(at ? { at } : {}),
          }),
        )

      const list = <P, T>(
        team: Named<T, TeamId>,
        query: ContactQuery,
        _access: CanReadRecords<P, T>,
        within?: ContactScope,
      ) =>
        Effect.gen(function* () {
          const limit = query.limit ?? 50
          const custom =
            query.filter || query.sort?.field.startsWith("custom:")
              ? yield* customFields.ofTeam(team.value, "contact")
              : []
          const fields = query.filter
            ? yield* checkFilter("contact", query.filter, custom)
            : filterFields("contact", custom)
          const matching = and(
            eq(schema.contacts.teamId, team.value),
            query.filter ? filterSql("contact", query.filter, fields) : undefined,
            within?.where,
            query.deleted ? restorableSql : isNull(schema.contacts.deletedAt),
            searchSql(query.search),
          )
          // An offset, or a custom sort's cursor, pages by position; otherwise pages go by (updated, id).
          const byPosition = query.offset !== undefined || Boolean(query.sort)
          const offset = query.offset !== undefined ? Math.min(query.offset, MAX_OFFSET) : decodeOffset(query.cursor)
          const cursor = !byPosition && query.cursor ? decodeCursor(query.cursor) : undefined
          const [rows, total] = yield* Effect.all(
            [
              run(
                db.query((d) =>
                  d
                    .select({ id: schema.contacts.id, updatedAt: schema.contacts.updatedAt })
                    .from(schema.contacts)
                    .where(
                      and(
                        matching,
                        cursor
                          ? sql`(${schema.contacts.updatedAt}, ${schema.contacts.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
                          : undefined,
                      ),
                    )
                    .orderBy(
                      ...(query.sort
                        ? [sortSql("contact", query.sort, fields)]
                        : [desc(schema.contacts.updatedAt), desc(schema.contacts.id)]),
                    )
                    .limit(limit + 1)
                    .offset(offset),
                ),
              ),
              // Only the first page counts (D136): later pages would count the same again.
              query.cursor ? Effect.succeed(null) : count(matching),
            ],
            { concurrency: 2 },
          )
          const page = rows.slice(0, limit)
          const last = page[page.length - 1]
          const items = yield* load(
            team.value,
            page.map((row) => row.id),
          )
          const more = rows.length > limit && last !== undefined
          return {
            items,
            nextCursor: more
              ? byPosition
                ? encodeOffset(offset + limit)
                : encodeCursor(last.updatedAt, last.id)
              : null,
            total,
          }
        })

      const count = (where: SQL | undefined) =>
        Effect.map(
          run(db.query((d) => d.select({ count: sql<number>`count(*)::int` }).from(schema.contacts).where(where))),
          ([row]) => row?.count ?? 0,
        )

      /** Live contacts matching a search and filter, as the list would find them (D137). */
      const matchingWhere = (teamId: TeamId, matching: Matching) =>
        Effect.gen(function* () {
          const filter = matching.filter
          const filtered = filter
            ? filterSql(
                "contact",
                filter,
                yield* checkFilter("contact", filter, yield* customFields.ofTeam(teamId, "contact")),
              )
            : undefined
          return (
            and(
              eq(schema.contacts.teamId, teamId),
              isNull(schema.contacts.deletedAt),
              filtered,
              searchSql(matching.search),
            ) ?? sql`false`
          )
        })

      const selection = <P, T>(team: Named<T, TeamId>, selected: Selection, _access: CanReadRecords<P, T>) => {
        if (!("ids" in selected)) {
          return Effect.map(
            matchingWhere(team.value, selected.matching),
            (where): ContactSelection<T> => ({ team, where }),
          )
        }
        // Ids that aren't uuids can't be contacts; leaving them out keeps them away from the query.
        const ids = selected.ids.filter((id) => isUuid(id))
        const where =
          ids.length === 0
            ? sql`false`
            : (and(
                eq(schema.contacts.teamId, team.value),
                isNull(schema.contacts.deletedAt),
                inArray(schema.contacts.id, ids),
              ) ?? sql`false`)
        return Effect.succeed<ContactSelection<T>>({ team, where })
      }

      const selectChunk = <T>(selected: ContactSelection<T>, after: ContactId | undefined) =>
        Effect.map(
          run(
            db.query((d) =>
              d
                .select({ id: schema.contacts.id })
                .from(schema.contacts)
                .where(and(selected.where, after ? sql`${schema.contacts.id} > ${after}::uuid` : undefined))
                .orderBy(asc(schema.contacts.id))
                .limit(SELECTION_CHUNK),
            ),
          ),
          (rows) => rows.map((row) => row.id as ContactId),
        )

      const updateMany = <P, T>(
        chunk: ContactsInTeam<T>,
        change: { readonly custom?: CustomValuesPatch | undefined; readonly owner?: RecordOwnerChange<T> },
        access: CanWriteRecords<P, T>,
      ) =>
        Effect.gen(function* () {
          const teamId = chunk.team.value
          if (chunk.contactIds.length === 0) return 0
          const patch = change.custom ?? {}
          const patched = Object.keys(patch)
          // Checks the values as contacts.update would; `values` then holds the ones being set.
          const applied = yield* customFields.apply(teamId, "contact", {}, patch)
          const cleared = patched.filter((fieldId) => !(fieldId in applied.values))
          const nameOf = new Map(
            patched.length > 0
              ? (yield* customFields.ofTeam(teamId, "contact")).map((field) => [field.id as string, field.name])
              : [],
          )
          const ownerId = change.owner === undefined ? undefined : (change.owner?.userId ?? null)
          const rows = yield* run(
            db.query((d) =>
              d
                .select({ id: schema.contacts.id, custom: schema.contacts.custom, ownerId: schema.contacts.ownerId })
                .from(schema.contacts)
                .where(
                  and(
                    eq(schema.contacts.teamId, teamId),
                    inArray(schema.contacts.id, [...chunk.contactIds]),
                    isNull(schema.contacts.deletedAt),
                  ),
                ),
            ),
          )
          const changes = rows.flatMap((row) => {
            const current = row.custom as CustomValues
            const changed = [
              ...patched
                .filter((fieldId) =>
                  fieldId in applied.values
                    ? JSON.stringify(current[fieldId]) !== JSON.stringify(applied.values[fieldId])
                    : fieldId in current,
                )
                .map((fieldId) => nameOf.get(fieldId) ?? fieldId),
              ...(ownerId !== undefined && ownerId !== row.ownerId ? ["ownerId"] : []),
            ]
            return changed.length > 0 ? [{ id: row.id, changed }] : []
          })
          if (changes.length === 0) return rows.length
          const principal = access.member.principal.value
          const kept =
            cleared.length > 0
              ? sql`(${schema.contacts.custom} - array[${sql.join(
                  cleared.map((fieldId) => sql`${fieldId}`),
                  sql`, `,
                )}]::text[])`
              : sql`${schema.contacts.custom}`
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .update(schema.contacts)
                    .set({
                      ...(patched.length > 0
                        ? { custom: sql`${kept} || ${JSON.stringify(applied.values)}::jsonb` }
                        : {}),
                      ...(ownerId !== undefined ? { ownerId } : {}),
                      updatedAt: sql`now()`,
                    })
                    .where(
                      and(
                        eq(schema.contacts.teamId, teamId),
                        inArray(
                          schema.contacts.id,
                          changes.map((entry) => entry.id),
                        ),
                      ),
                    ),
                )
                yield* db.query((d) =>
                  d.insert(schema.activity).values(
                    changes.map((entry) =>
                      activityRow(principal, {
                        teamId,
                        recordType: "contact",
                        recordId: entry.id,
                        kind: "updated",
                        changedFields: entry.changed,
                      }),
                    ),
                  ),
                )
              }),
            ),
          )
          return rows.length
        }).pipe(Effect.withSpan("Contacts.updateMany"))

      const deleteMany = <P, T>(chunk: ContactsInTeam<T>, deletedAt: Date, access: CanDeleteRecords<P, T>) =>
        Effect.gen(function* () {
          const teamId = chunk.team.value
          if (chunk.contactIds.length === 0) return 0
          const principal = access.member.principal.value
          return yield* run(
            db.transaction(
              Effect.gen(function* () {
                const deleted = yield* db.query((d) =>
                  d
                    .update(schema.contacts)
                    .set({ deletedAt, updatedAt: sql`now()` })
                    .where(
                      and(
                        eq(schema.contacts.teamId, teamId),
                        inArray(schema.contacts.id, [...chunk.contactIds]),
                        isNull(schema.contacts.deletedAt),
                      ),
                    )
                    .returning({ id: schema.contacts.id }),
                )
                if (deleted.length === 0) return 0
                const ids = deleted.map((row) => row.id)
                yield* db.query((d) =>
                  d
                    .update(schema.contactEmails)
                    .set({ active: false })
                    .where(inArray(schema.contactEmails.contactId, ids)),
                )
                yield* db.query((d) =>
                  d.insert(schema.activity).values(
                    ids.map((id) =>
                      activityRow(principal, {
                        teamId,
                        recordType: "contact",
                        recordId: id,
                        kind: "deleted",
                        changedFields: [],
                      }),
                    ),
                  ),
                )
                return deleted.length
              }),
            ),
          )
        }).pipe(Effect.withSpan("Contacts.deleteMany"))

      const restoreMany = <P, T>(team: Named<T, TeamId>, deletedAt: Date, access: CanDeleteRecords<P, T>) =>
        Effect.gen(function* () {
          const teamId = team.value
          const principal = access.member.principal.value
          let restored = 0
          let after: string | undefined
          for (;;) {
            const chunk = yield* run(
              db.query((d) =>
                d
                  .select({ id: schema.contacts.id })
                  .from(schema.contacts)
                  .where(
                    and(
                      eq(schema.contacts.teamId, teamId),
                      eq(schema.contacts.deletedAt, deletedAt),
                      restorableSql,
                      after ? sql`${schema.contacts.id} > ${after}::uuid` : undefined,
                    ),
                  )
                  .orderBy(asc(schema.contacts.id))
                  .limit(SELECTION_CHUNK),
              ),
            )
            const last = chunk[chunk.length - 1]
            if (!last) return restored
            after = last.id
            const ids = chunk.map((row) => row.id)
            // A contact whose email another contact has taken since stays deleted, as contacts.restore refuses it.
            const blocked = yield* run(
              db.query((d) =>
                d
                  .selectDistinct({ contactId: schema.contactEmails.contactId })
                  .from(schema.contactEmails)
                  .where(
                    and(
                      inArray(schema.contactEmails.contactId, ids),
                      sql`exists (select 1 from ${schema.contactEmails} taken where taken.team_id = ${teamId} and taken.active and taken.address = ${schema.contactEmails.address})`,
                    ),
                  ),
              ),
            )
            const skip = new Set(blocked.map((row) => row.contactId))
            const restorable = ids.filter((id) => !skip.has(id))
            if (restorable.length > 0) {
              yield* run(
                db.transaction(
                  Effect.gen(function* () {
                    yield* db.query((d) =>
                      d
                        .update(schema.contacts)
                        .set({ deletedAt: null, updatedAt: sql`now()` })
                        .where(and(eq(schema.contacts.teamId, teamId), inArray(schema.contacts.id, restorable))),
                    )
                    yield* db.query((d) =>
                      d
                        .update(schema.contactEmails)
                        .set({ active: true })
                        .where(inArray(schema.contactEmails.contactId, restorable)),
                    )
                    yield* db.query((d) =>
                      d.insert(schema.activity).values(
                        restorable.map((id) =>
                          activityRow(principal, {
                            teamId,
                            recordType: "contact",
                            recordId: id,
                            kind: "restored",
                            changedFields: [],
                          }),
                        ),
                      ),
                    )
                  }),
                ),
              )
            }
            restored += restorable.length
            if (chunk.length < SELECTION_CHUNK) return restored
          }
        }).pipe(Effect.withSpan("Contacts.restoreMany"))

      const locate = <P, T>(
        team: Named<T, TeamId>,
        contactId: ContactId,
        state: ContactState,
        _access: CanReadRecords<P, T>,
      ) =>
        Effect.map(
          run(
            db.query((d) =>
              d
                .select({ id: schema.contacts.id, deletedAt: schema.contacts.deletedAt })
                .from(schema.contacts)
                .where(
                  and(
                    eq(schema.contacts.teamId, team.value),
                    sql`${schema.contacts.id}::text = ${contactId}`,
                    state === "live"
                      ? isNull(schema.contacts.deletedAt)
                      : or(
                          isNull(schema.contacts.deletedAt),
                          sql`${schema.contacts.deletedAt} > now() - make_interval(days => ${RESTORE_WINDOW_DAYS})`,
                        ),
                  ),
                )
                .limit(1),
            ),
          ),
          ([row]): LocatedContact | undefined =>
            row ? { id: row.id as ContactId, deleted: row.deletedAt !== null } : undefined,
        )

      const get = <C, T>(target: ContactInTeam<C, T>) => loadOne(target.team.value, target.contact.value)

      const create = <P, T>(
        team: Named<T, TeamId>,
        fields: ContactFields,
        access: CanWriteRecords<P, T>,
        owner?: RecordOwnerChange<T>,
        imported?: ImportedContact,
      ) =>
        Effect.gen(function* () {
          const normalized = yield* normalize(fields, true)
          const createdAt = imported?.createdAt
          const custom = fields.custom
            ? yield* customFields.apply(team.value, "contact", {}, fields.custom)
            : { values: {}, changed: [] }
          const addresses = normalized.emails?.map((email) => email.address) ?? []
          if (addresses.length > 0) yield* emailTaken(access.member.teamName, team.value, addresses)
          const id = crypto.randomUUID()
          yield* write(
            access.member.teamName,
            team.value,
            addresses,
            id,
            Effect.gen(function* () {
              yield* db.query((d) =>
                d.insert(schema.contacts).values({
                  id,
                  teamId: team.value,
                  firstName: normalized.firstName ?? null,
                  lastName: normalized.lastName ?? null,
                  custom: custom.values,
                  ...addressColumns(normalized.address ?? null),
                  ...(normalized.socialProfiles ? { socialProfiles: [...normalized.socialProfiles] } : {}),
                  ...(imported?.status
                    ? { subscriptionStatus: imported.status }
                    : fields.subscriptionStatus
                      ? { subscriptionStatus: fields.subscriptionStatus }
                      : {}),
                  ...(owner ? { ownerId: owner.userId } : {}),
                  ...(createdAt ? { createdAt } : {}),
                }),
              )
              yield* replaceEmails(team.value, id, normalized.emails)
              yield* replacePhones(team.value, id, normalized.phones)
              const principal = access.member.principal.value
              yield* recordActivity(
                principal,
                team.value,
                id,
                "created",
                [...Object.keys(normalized), ...custom.changed, ...(owner ? ["ownerId"] : [])],
                createdAt,
              )
              const name = displayNameOf(
                normalized.firstName ?? null,
                normalized.lastName ?? null,
                normalized.emails?.find((email) => email.isPrimary)?.address,
              )
              yield* affiliations.matchContact(principal, team.value, { id, name }, addresses)
            }),
          )
          return yield* loadOne(team.value, id as ContactId)
        }).pipe(Effect.withSpan("Contacts.create"))

      const update = <P, T, C>(
        target: ContactInTeam<C, T>,
        fields: ContactFields,
        access: CanWriteRecords<P, T>,
        resubscribe?: CanManageEmail<P, T>,
        owner?: RecordOwnerChange<T>,
        imported?: ImportedContact,
      ) =>
        Effect.gen(function* () {
          const normalized = yield* normalize(fields, false)
          const teamId = target.team.value
          const id = target.contact.value
          const addresses = normalized.emails?.map((email) => email.address) ?? []
          if (addresses.length > 0) yield* emailTaken(target.teamName, teamId, addresses, id)
          const current = yield* loadOne(teamId, id)
          const custom = fields.custom
            ? yield* customFields.apply(teamId, "contact", current.custom, fields.custom)
            : undefined
          const ownerId = owner === undefined ? undefined : (owner?.userId ?? null)
          const ownerChanged = ownerId !== undefined && ownerId !== current.ownerId
          const changed = [...Object.keys(normalized), ...(custom?.changed ?? []), ...(ownerChanged ? ["ownerId"] : [])]
          // An import may report a contact as unsubscribed or bounced (D125); it never subscribes anyone.
          const wanted = imported?.status ?? fields.subscriptionStatus
          const status = wanted !== undefined && wanted !== current.subscriptionStatus ? wanted : undefined
          if (status === "subscribed" && !resubscribe) {
            return yield* Effect.die(new Error("resubscribing a contact needs email:manage, proven by the caller"))
          }
          if (changed.length > 0 || status) {
            const before = new Set(current.emails.map((email) => email.address as string))
            const added = addresses.filter((address) => !before.has(address))
            const principal = access.member.principal.value
            const name = displayNameOf(
              normalized.firstName !== undefined ? normalized.firstName : current.firstName,
              normalized.lastName !== undefined ? normalized.lastName : current.lastName,
              (normalized.emails ?? current.emails).find((email) => email.isPrimary)?.address,
            )
            yield* write(
              target.teamName,
              teamId,
              addresses,
              id,
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .update(schema.contacts)
                    .set({
                      ...("firstName" in normalized ? { firstName: normalized.firstName ?? null } : {}),
                      ...("lastName" in normalized ? { lastName: normalized.lastName ?? null } : {}),
                      ...(custom ? { custom: custom.values } : {}),
                      ...("address" in normalized ? addressColumns(normalized.address ?? null) : {}),
                      ...(normalized.socialProfiles ? { socialProfiles: [...normalized.socialProfiles] } : {}),
                      ...(status ? { subscriptionStatus: status } : {}),
                      ...(ownerChanged ? { ownerId } : {}),
                      updatedAt: sql`now()`,
                    })
                    .where(and(eq(schema.contacts.teamId, teamId), eq(schema.contacts.id, id))),
                )
                yield* replaceEmails(teamId, id, normalized.emails)
                yield* replacePhones(teamId, id, normalized.phones)
                if (changed.length > 0) yield* recordActivity(principal, teamId, id, "updated", changed)
                // A change of subscription status is its own event, so it reads plainly in activity (R49).
                if (status) {
                  yield* recordActivity(
                    principal,
                    teamId,
                    id,
                    status === "subscribed" ? "resubscribed" : status === "bounced" ? "bounced" : "unsubscribed",
                    [],
                  )
                }
                // Only newly added emails match; removed affiliations stay removed (D107).
                yield* affiliations.matchContact(principal, teamId, { id, name }, added)
              }),
            )
          }
          return yield* loadOne(teamId, id)
        }).pipe(Effect.withSpan("Contacts.update"))

      const remove = <P, T, C>(target: ContactInTeam<C, T>, access: CanDeleteRecords<P, T>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const id = target.contact.value
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .update(schema.contacts)
                    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
                    .where(and(eq(schema.contacts.teamId, teamId), eq(schema.contacts.id, id))),
                )
                yield* db.query((d) =>
                  d.update(schema.contactEmails).set({ active: false }).where(eq(schema.contactEmails.contactId, id)),
                )
                yield* recordActivity(access.member.principal.value, teamId, id, "deleted", [])
              }),
            ),
          )
          return yield* loadOne(teamId, id)
        }).pipe(Effect.withSpan("Contacts.delete"))

      const restore = <P, T, C>(target: ContactRestorable<C, T>, access: CanDeleteRecords<P, T>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const id = target.contact.value
          const current = yield* loadOne(teamId, id)
          if (current.deletedAt === null) return current
          const addresses = current.emails.map((email) => email.address)
          if (addresses.length > 0) yield* emailTaken(target.teamName, teamId, addresses, id)
          yield* write(
            target.teamName,
            teamId,
            addresses,
            id,
            Effect.gen(function* () {
              yield* db.query((d) =>
                d
                  .update(schema.contacts)
                  .set({ deletedAt: null, updatedAt: sql`now()` })
                  .where(and(eq(schema.contacts.teamId, teamId), eq(schema.contacts.id, id))),
              )
              yield* db.query((d) =>
                d.update(schema.contactEmails).set({ active: true }).where(eq(schema.contactEmails.contactId, id)),
              )
              yield* recordActivity(access.member.principal.value, teamId, id, "restored", [])
            }),
          )
          return yield* loadOne(teamId, id)
        }).pipe(Effect.withSpan("Contacts.restore"))

      const activity = <C, T>(target: ContactInTeam<C, T>) =>
        Effect.map(
          run(
            db.query((d) =>
              d
                .select()
                .from(schema.activity)
                .where(
                  and(
                    eq(schema.activity.teamId, target.team.value),
                    eq(schema.activity.recordType, "contact"),
                    eq(schema.activity.recordId, target.contact.value),
                  ),
                )
                .orderBy(asc(schema.activity.at)),
            ),
          ),
          (rows) => rows.map(toActivityEntry),
        )

      const setAvatar = <P, T, C>(
        target: ContactInTeam<C, T>,
        image: Uint8Array | null,
        access: CanWriteRecords<P, T>,
      ) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const id = target.contact.value
          const current = yield* loadOne(teamId, id)
          // A new key each time, so browsers never show a cached old avatar.
          const key = image ? `${teamId}/avatars/${id}-${crypto.randomUUID().slice(0, 8)}.webp` : null
          if (image && key) yield* files.put(teamId, key, { bytes: image, contentType: "image/webp" })
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .update(schema.contacts)
                    .set({ avatarKey: key, updatedAt: sql`now()` })
                    .where(and(eq(schema.contacts.teamId, teamId), eq(schema.contacts.id, id))),
                )
                yield* recordActivity(access.member.principal.value, teamId, id, "updated", ["avatar"])
              }),
            ),
          )
          const previous = current.avatarUrl?.replace("/api/files/", "")
          if (previous) yield* files.remove(previous)
          return yield* loadOne(teamId, id)
        }).pipe(Effect.withSpan("Contacts.setAvatar"))

      const locateMany = <P, T>(
        team: Named<T, TeamId>,
        contactIds: ReadonlyArray<ContactId>,
        _access: CanReadRecords<P, T>,
      ) =>
        contactIds.length === 0
          ? Effect.succeed(new Set<string>())
          : run(
              db.query((d) =>
                d
                  .select({ id: schema.contacts.id })
                  .from(schema.contacts)
                  .where(
                    and(
                      eq(schema.contacts.teamId, team.value),
                      inArray(schema.contacts.id, [...contactIds]),
                      isNull(schema.contacts.deletedAt),
                    ),
                  ),
              ),
            ).pipe(Effect.map((rows) => new Set(rows.map((row) => row.id))))

      const matchEmails = <P, T>(
        team: Named<T, TeamId>,
        addresses: ReadonlyArray<string>,
        _access: CanReadRecords<P, T>,
      ) =>
        addresses.length === 0
          ? Effect.succeed(new Map<string, ContactId>())
          : run(
              db.query((d) =>
                d
                  .select({ address: schema.contactEmails.address, contactId: schema.contactEmails.contactId })
                  .from(schema.contactEmails)
                  .where(
                    and(
                      eq(schema.contactEmails.teamId, team.value),
                      inArray(schema.contactEmails.address, [...addresses]),
                      eq(schema.contactEmails.active, true),
                    ),
                  ),
              ),
            ).pipe(Effect.map((rows) => new Map(rows.map((row) => [row.address, row.contactId as ContactId]))))

      return {
        list,
        selection,
        selectChunk,
        updateMany,
        deleteMany,
        restoreMany,
        locateMany,
        matchEmails,
        locate,
        get,
        create,
        update,
        delete: remove,
        restore,
        activity,
        setAvatar,
      }
    }),
  )
}
