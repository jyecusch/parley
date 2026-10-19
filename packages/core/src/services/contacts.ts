import { Database, schema } from "@parley/db"
import {
  type ActivityEntry,
  type Contact,
  ContactEmailTaken,
  type ContactFields,
  type ContactId,
  type ContactPage,
  type DatabaseUnavailable,
  type FieldProblem,
  type Filter,
  filterFields,
  InputRejected,
  type Sort,
  type TeamId,
} from "@parley/domain"
import { DisplayName, EchoedInput, userText } from "@parley/errors"
import { and, asc, desc, eq, exists, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { Principal } from "../principal.ts"
import type { ContactInTeam, ContactRestorable } from "../proofs/contact-in-team.ts"
import type { CanDeleteRecords, CanReadRecords, CanWriteRecords } from "../proofs/permissions.ts"
import type { Named } from "../proofs/proof.ts"
import { activityRow, toActivityEntry } from "./activity.ts"
import { Affiliations } from "./affiliations.ts"
import { CustomFields } from "./custom-fields.ts"
import { FileStore, fileUrl } from "./file-store.ts"
import { checkFilter, filterSql, sortSql } from "./filter-sql.ts"
import { classifySqlError, isUniqueViolation } from "./sql-errors.ts"

/** Deleted contacts can be restored for this long, then they're purged (D30). */
export const RESTORE_WINDOW_DAYS = 30

export interface ContactQuery {
  readonly search?: string | undefined
  readonly filter?: Filter | undefined
  readonly sort?: Sort | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  readonly deleted?: boolean | undefined
}

/** Which contacts a lookup may find: live ones, or deleted ones still inside the restore window. */
export type ContactState = "live" | "restorable"

/** A contact the ContactInTeam prover found. Only provers turn this into a proof. */
export interface LocatedContact {
  readonly id: ContactId
  readonly deleted: boolean
}

const EMAILS_KEY = "contact_emails_team_id_address_key"

const displayNameOf = (firstName: string | null, lastName: string | null, primaryEmail: string | undefined) =>
  [firstName, lastName].filter(Boolean).join(" ") || primaryEmail || "Unnamed contact"

const encodeCursor = (updatedAt: Date, id: string) => btoa(`${updatedAt.toISOString()}|${id}`)
/** With a custom sort, pages are by position: "o:<offset>". */
const encodeOffset = (offset: number) => btoa(`o:${offset}`)
const decodeOffset = (cursor: string | undefined): number => {
  if (!cursor) return 0
  try {
    const text = atob(cursor)
    const offset = text.startsWith("o:") ? Number(text.slice(2)) : 0
    return Number.isInteger(offset) && offset > 0 ? offset : 0
  } catch {
    return 0
  }
}
const decodeCursor = (cursor: string): { readonly updatedAt: Date; readonly id: string } | undefined => {
  try {
    const [iso, id] = atob(cursor).split("|")
    const updatedAt = new Date(iso ?? "")
    return id && !Number.isNaN(updatedAt.getTime()) ? { updatedAt, id } : undefined
  } catch {
    return undefined
  }
}

interface NormalizedFields {
  readonly firstName?: string | null
  readonly lastName?: string | null
  readonly emails?: ReadonlyArray<{ readonly address: string; readonly isPrimary: boolean }>
  readonly phones?: ReadonlyArray<{ readonly number: string; readonly label: string | null }>
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
  })
}

export class Contacts extends Context.Service<
  Contacts,
  {
    readonly list: <P, T>(
      team: Named<T, TeamId>,
      query: ContactQuery,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<ContactPage, InputRejected | DatabaseUnavailable>
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
    ) => Effect.Effect<Contact, InputRejected | ContactEmailTaken | DatabaseUnavailable>
    readonly update: <P, T, C>(
      target: ContactInTeam<C, T>,
      fields: ContactFields,
      access: CanWriteRecords<P, T>,
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
                  .select()
                  .from(schema.contacts)
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
          const byId = new Map(rows.map((row) => [row.id, row]))
          return ids.flatMap((id): Array<Contact> => {
            const row = byId.get(id)
            if (!row) return []
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
                avatarUrl: fileUrl(row.avatarKey),
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
      ) =>
        db.query((d) =>
          d
            .insert(schema.activity)
            .values(
              activityRow(principal, { teamId, recordType: "contact", recordId: contactId, kind, changedFields }),
            ),
        )

      const list = <P, T>(team: Named<T, TeamId>, query: ContactQuery, _access: CanReadRecords<P, T>) =>
        Effect.gen(function* () {
          const limit = query.limit ?? 50
          const custom =
            query.filter || query.sort?.field.startsWith("custom:")
              ? yield* customFields.ofTeam(team.value, "contact")
              : []
          const fields = query.filter
            ? yield* checkFilter("contact", query.filter, custom)
            : filterFields("contact", custom)
          const filtered = query.filter ? filterSql("contact", query.filter, fields) : undefined
          // A custom sort pages by position; the default sort pages by (updated, id).
          const offset = query.sort ? decodeOffset(query.cursor) : 0
          const cursor = !query.sort && query.cursor ? decodeCursor(query.cursor) : undefined
          const search = query.search?.trim()
          const pattern = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined
          const rows = yield* run(
            db.query((d) =>
              d
                .select({ id: schema.contacts.id, updatedAt: schema.contacts.updatedAt })
                .from(schema.contacts)
                .where(
                  and(
                    eq(schema.contacts.teamId, team.value),
                    filtered,
                    query.deleted
                      ? and(
                          isNotNull(schema.contacts.deletedAt),
                          sql`${schema.contacts.deletedAt} > now() - make_interval(days => ${RESTORE_WINDOW_DAYS})`,
                        )
                      : isNull(schema.contacts.deletedAt),
                    cursor
                      ? sql`(${schema.contacts.updatedAt}, ${schema.contacts.id}) < (${cursor.updatedAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
                      : undefined,
                    pattern
                      ? or(
                          ilike(
                            sql`coalesce(${schema.contacts.firstName}, '') || ' ' || coalesce(${schema.contacts.lastName}, '')`,
                            pattern,
                          ),
                          exists(
                            d
                              .select({ one: sql`1` })
                              .from(schema.contactEmails)
                              .where(
                                and(
                                  eq(schema.contactEmails.contactId, schema.contacts.id),
                                  ilike(schema.contactEmails.address, pattern),
                                ),
                              ),
                          ),
                        )
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
              ? query.sort
                ? encodeOffset(offset + limit)
                : encodeCursor(last.updatedAt, last.id)
              : null,
          }
        })

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

      const create = <P, T>(team: Named<T, TeamId>, fields: ContactFields, access: CanWriteRecords<P, T>) =>
        Effect.gen(function* () {
          const normalized = yield* normalize(fields, true)
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
                }),
              )
              yield* replaceEmails(team.value, id, normalized.emails)
              yield* replacePhones(team.value, id, normalized.phones)
              const principal = access.member.principal.value
              yield* recordActivity(principal, team.value, id, "created", [
                ...Object.keys(normalized),
                ...custom.changed,
              ])
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

      const update = <P, T, C>(target: ContactInTeam<C, T>, fields: ContactFields, access: CanWriteRecords<P, T>) =>
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
          const changed = [...Object.keys(normalized), ...(custom?.changed ?? [])]
          if (changed.length > 0) {
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
                      updatedAt: sql`now()`,
                    })
                    .where(and(eq(schema.contacts.teamId, teamId), eq(schema.contacts.id, id))),
                )
                yield* replaceEmails(teamId, id, normalized.emails)
                yield* replacePhones(teamId, id, normalized.phones)
                yield* recordActivity(principal, teamId, id, "updated", changed)
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

      return { list, locate, get, create, update, delete: remove, restore, activity, setAvatar }
    }),
  )
}
