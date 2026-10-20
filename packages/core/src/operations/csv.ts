import {
  type Company,
  type CompanyFields,
  type CompanyId,
  type Contact,
  type ContactFields,
  type ContactId,
  type CustomField,
  type CustomValue,
  countryCodeOf,
  Domain,
  domainOfEmail,
  EmailAddress,
  type exportCompanies,
  type exportContacts,
  type FieldProblem,
  guessMapping,
  IMPORT_FIELDS,
  type ImportResult,
  InputRejected,
  type importCompanies,
  type importContacts,
  normalizeDomain,
  type OperationInput,
  PhoneNumber,
  type PostalAddress,
  parseCsv,
  type RecordType,
  type SegmentId,
  SUBSCRIPTION_STATUS_LABELS,
  type TopicId,
  toCsv,
  type UserId,
  Website,
} from "@parley/domain"
import { type UserText, userText } from "@parley/errors"
import { Effect, Schema } from "effect"
import type { Principal } from "../principal.ts"
import { proveCompanyInTeam } from "../proofs/company-in-team.ts"
import { proveContactInTeam } from "../proofs/contact-in-team.ts"
import { type MemberOf, proveMemberOf } from "../proofs/member-of.ts"
import { type CanReadRecords, proveCanReadRecords, proveCanWriteRecords } from "../proofs/permissions.ts"
import { type Named, named } from "../proofs/proof.ts"
import { proveRecordOwner, type RecordOwner } from "../proofs/record-owner.ts"
import { proveSegmentInTeam } from "../proofs/segment-in-team.ts"
import { proveTopicsInTeam } from "../proofs/topic-in-team.ts"
import { Affiliations } from "../services/affiliations.ts"
import { Companies } from "../services/companies.ts"
import { Contacts } from "../services/contacts.ts"
import { CustomFields } from "../services/custom-fields.ts"
import { Members } from "../services/members.ts"
import { Segments } from "../services/segments.ts"
import { Subscriptions } from "../services/subscriptions.ts"

/**
 * CSV import and export (D62), composed from the proven record services: every row goes through the
 * same create and update as anything else, with the same checks and activity.
 */

const MAX_ROWS = 5000

const isoDay = (iso: string) => iso.slice(0, 10)

/** A custom value as text in a cell: option labels, not ids. */
const cellOfCustom = (field: CustomField, value: CustomValue | undefined): string => {
  if (value === undefined) return ""
  if (field.type === "single-select") return field.options.find((option) => option.id === value)?.label ?? ""
  if (field.type === "multi-select" && Array.isArray(value)) {
    return value.map((id) => field.options.find((option) => option.id === id)?.label ?? "").join("; ")
  }
  if (field.type === "checkbox") return value === true ? "Yes" : "No"
  return String(value)
}

const optionFor = (field: CustomField, label: string) =>
  field.options.find((option) => option.label.toLowerCase() === label.trim().toLowerCase())?.id

/** A cell as a custom value, or why it can't be one. Labels become option ids. */
const customFromCell = (field: CustomField, cell: string): { value: CustomValue | null } | { problem: UserText } => {
  const text = cell.trim()
  if (text === "") return { value: null }
  switch (field.type) {
    case "number": {
      const value = Number(text.replace(/,/g, ""))
      return Number.isFinite(value) ? { value } : { problem: userText`This isn't a number.` }
    }
    case "checkbox":
      return { value: /^(yes|y|true|1|x|✓)$/i.test(text) }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? { value: text }
        : { problem: userText`Dates need to look like 2026-12-31.` }
    case "single-select": {
      const id = optionFor(field, text)
      return id ? { value: id } : { problem: userText`This isn't one of the field's options.` }
    }
    case "multi-select": {
      const labels = text
        .split(/[;|]/)
        .map((label) => label.trim())
        .filter(Boolean)
      const ids = labels.map((label) => optionFor(field, label))
      return ids.every((id) => id !== undefined)
        ? { value: ids as Array<string> }
        : { problem: userText`One of these isn't one of the field's options.` }
    }
    case "phone":
      return { value: text.replace(/[\s().-]/g, "") }
    case "url":
      return { value: /^https?:\/\//i.test(text) ? text : `https://${text}` }
    default:
      return { value: text }
  }
}

/** Every live record of a type, page by page, for export and for matching rows on import. */
const allContacts = <P, T>(team: Named<T, Parameters<typeof proveMemberOf>[1]["value"]>, read: CanReadRecords<P, T>) =>
  Effect.gen(function* () {
    const contacts = yield* Contacts
    const items: Array<Contact> = []
    let cursor: string | undefined
    for (let page = 0; page < 200; page++) {
      const result = yield* contacts.list(team, { limit: 200, ...(cursor ? { cursor } : {}) }, read)
      items.push(...result.items)
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }
    return items
  })

const allCompanies = <P, T>(team: Named<T, Parameters<typeof proveMemberOf>[1]["value"]>, read: CanReadRecords<P, T>) =>
  Effect.gen(function* () {
    const companies = yield* Companies
    const items: Array<Company> = []
    let cursor: string | undefined
    for (let page = 0; page < 200; page++) {
      const result = yield* companies.list(team, { limit: 200, ...(cursor ? { cursor } : {}) }, read)
      items.push(...result.items)
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }
    return items
  })

/** A segment's contacts, as the scope contacts.list narrows to; none when no segment is asked for. */
const segmentScope = <P, T>(member: MemberOf<P, T>, segmentId: SegmentId | undefined) =>
  segmentId === undefined
    ? Effect.succeed(undefined)
    : named(segmentId, (segment) =>
        Effect.gen(function* () {
          const segments = yield* Segments
          const target = yield* proveSegmentInTeam(member, segment)
          return yield* segments.scope(target)
        }),
      )

export const exportContactsCsv = (principal: Principal, input: OperationInput<typeof exportContacts>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const customFields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const scope = yield* segmentScope(member, input.segmentId)
      const fields = yield* customFields.list(team, "contact", canRead)
      const items: Array<Contact> = []
      let cursor: string | undefined
      for (let page = 0; page < 200; page++) {
        const result = yield* contacts.list(
          team,
          { limit: 200, ...(input.filter ? { filter: input.filter } : {}), ...(cursor ? { cursor } : {}) },
          canRead,
          scope,
        )
        items.push(...result.items)
        if (!result.nextCursor) break
        cursor = result.nextCursor
      }
      const only = input.ids ? new Set(input.ids) : undefined
      const rows = items.filter((contact) => !only || only.has(contact.id))
      const header = [
        "First name",
        "Last name",
        "Email",
        "Other emails",
        "Phones",
        "Companies",
        "Street",
        "Street, line 2",
        "City",
        "State or region",
        "Postcode",
        "Country",
        "Subscription status",
        "Contact owner",
        "Created",
        "Updated",
        ...fields.map((field) => field.name),
      ]
      const csv = toCsv([
        header,
        ...rows.map((contact) => {
          const primary = contact.emails.find((email) => email.isPrimary) ?? contact.emails[0]
          return [
            contact.firstName ?? "",
            contact.lastName ?? "",
            primary?.address ?? "",
            contact.emails
              .filter((email) => email !== primary)
              .map((email) => email.address)
              .join("; "),
            contact.phones.map((phone) => phone.number).join("; "),
            contact.affiliations
              .map((affiliation) =>
                affiliation.title ? `${affiliation.companyName} (${affiliation.title})` : affiliation.companyName,
              )
              .join("; "),
            contact.address?.line1 ?? "",
            contact.address?.line2 ?? "",
            contact.address?.city ?? "",
            contact.address?.region ?? "",
            contact.address?.postcode ?? "",
            contact.address?.country ?? "",
            SUBSCRIPTION_STATUS_LABELS[contact.subscriptionStatus],
            contact.ownerName ?? "",
            isoDay(contact.createdAt),
            isoDay(contact.updatedAt),
            ...fields.map((field) => cellOfCustom(field, contact.custom[field.id])),
          ]
        }),
      ])
      return { csv, count: rows.length }
    }),
  )

export const exportCompaniesCsv = (principal: Principal, input: OperationInput<typeof exportCompanies>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const customFields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const fields = yield* customFields.list(team, "company", canRead)
      const items: Array<Company> = []
      let cursor: string | undefined
      for (let page = 0; page < 200; page++) {
        const result = yield* companies.list(
          team,
          { limit: 200, ...(input.filter ? { filter: input.filter } : {}), ...(cursor ? { cursor } : {}) },
          canRead,
        )
        items.push(...result.items)
        if (!result.nextCursor) break
        cursor = result.nextCursor
      }
      const only = input.ids ? new Set(input.ids) : undefined
      const rows = items.filter((company) => !only || only.has(company.id))
      const header = [
        "Name",
        "Domains",
        "Website",
        "Phone",
        "Street",
        "Street, line 2",
        "City",
        "Region",
        "Postcode",
        "Country",
        "Contacts",
        "Company owner",
        "Created",
        "Updated",
        ...fields.map((field) => field.name),
      ]
      const csv = toCsv([
        header,
        ...rows.map((company) => [
          company.name,
          company.domains.map((entry) => entry.domain).join("; "),
          company.website ?? "",
          company.phone ?? "",
          company.address?.line1 ?? "",
          company.address?.line2 ?? "",
          company.address?.city ?? "",
          company.address?.region ?? "",
          company.address?.postcode ?? "",
          company.address?.country ?? "",
          String(company.contactCount),
          company.ownerName ?? "",
          isoDay(company.createdAt),
          isoDay(company.updatedAt),
          ...fields.map((field) => cellOfCustom(field, company.custom[field.id])),
        ]),
      ])
      return { csv, count: rows.length }
    }),
  )

interface Parsed {
  readonly headers: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ReadonlyArray<string>>
  readonly mapping: Readonly<Record<string, string>>
}

const parse = (
  csv: string,
  mapping: Readonly<Record<string, string>> | undefined,
  recordType: RecordType,
  fields: ReadonlyArray<CustomField>,
) =>
  Effect.gen(function* () {
    const [headers = [], ...rows] = parseCsv(csv)
    if (headers.length === 0) {
      return yield* new InputRejected({
        problems: [
          {
            field: "csv",
            problem: "missing",
            userMessage: userText`This file is empty. Add a header row and some rows.`,
          },
        ],
      })
    }
    if (rows.length > MAX_ROWS) {
      return yield* new InputRejected({
        problems: [
          {
            field: "csv",
            problem: "too-long",
            userMessage: userText`Import up to ${MAX_ROWS} rows at a time. Split the file and import each part.`,
          },
        ],
      })
    }
    return { headers, rows, mapping: mapping ?? guessMapping(headers, recordType, fields) } satisfies Parsed
  })

/** What each row's mapped cells say, keyed by field. */
const cellsOf = (parsed: Parsed, row: ReadonlyArray<string>) => {
  const cells: Record<string, string> = {}
  parsed.headers.forEach((header, index) => {
    const field = parsed.mapping[header]
    const value = row[index]?.trim() ?? ""
    if (field && value !== "") cells[field] = cells[field] ? `${cells[field]}; ${value}` : value
  })
  return cells
}

const customOf = (cells: Record<string, string>, fields: ReadonlyArray<CustomField>, problems: Array<FieldProblem>) => {
  const custom: Record<string, CustomValue> = {}
  for (const field of fields) {
    const cell = cells[`custom:${field.id}`]
    if (cell === undefined) continue
    const result = customFromCell(field, cell)
    if ("problem" in result)
      problems.push({ field: `custom.${field.id}`, problem: "invalid-format", userMessage: result.problem })
    else if (result.value !== null) custom[field.id] = result.value
  }
  return custom
}

/**
 * Checks the values to set on every row (D124) before any row is imported: each must name a field
 * that exists and be a value it takes, or the whole import is refused.
 */
const checkSet = (
  set: Readonly<Record<string, string>> | undefined,
  recordType: RecordType,
  fields: ReadonlyArray<CustomField>,
) =>
  Effect.gen(function* () {
    const problems: Array<FieldProblem> = []
    for (const [target, text] of Object.entries(set ?? {})) {
      if (target.startsWith("custom:")) {
        const field = fields.find((entry) => `custom:${entry.id}` === target)
        const result = field ? customFromCell(field, text) : undefined
        if (!field || !result) {
          problems.push({
            field: `set.${target}`,
            problem: "invalid-format",
            userMessage: userText`There's no field like that to set.`,
          })
        } else if ("problem" in result) {
          problems.push({ field: `set.${target}`, problem: "invalid-format", userMessage: result.problem })
        }
      } else if (!IMPORT_FIELDS[recordType].some((entry) => entry.field === target)) {
        problems.push({
          field: `set.${target}`,
          problem: "invalid-format",
          userMessage: userText`There's no field like that to set.`,
        })
      }
    }
    if (problems.length > 0) return yield* new InputRejected({ problems })
  })

/** A row's cells with the values set on every row: the row's own value wins, multi-select values combine. */
const withSet = (
  cells: Record<string, string>,
  set: Readonly<Record<string, string>> | undefined,
  fields: ReadonlyArray<CustomField>,
) => {
  const out = { ...cells }
  for (const [target, text] of Object.entries(set ?? {})) {
    if (text.trim() === "") continue
    const multi = fields.some((field) => `custom:${field.id}` === target && field.type === "multi-select")
    const own = out[target]
    out[target] = own === undefined ? text : multi ? `${own}; ${text}` : own
  }
  return out
}

/**
 * The custom values to write to an existing record. Multi-select values are added to what it has
 * unless the import replaces them (D124), so importing several sources merges rather than overwrites.
 */
const mergeCustom = (
  incoming: Readonly<Record<string, CustomValue | null>>,
  current: Readonly<Record<string, CustomValue | null>>,
  fields: ReadonlyArray<CustomField>,
  mode: "add" | "replace",
) => {
  if (mode === "replace") return incoming
  const merged: Record<string, CustomValue | null> = { ...incoming }
  for (const field of fields) {
    const next = incoming[field.id]
    const had = current[field.id]
    if (field.type === "multi-select" && Array.isArray(next) && Array.isArray(had)) {
      merged[field.id] = [...new Set([...(had as ReadonlyArray<string>), ...(next as ReadonlyArray<string>)])]
    }
  }
  return merged
}

const split = (cell: string | undefined) =>
  (cell ?? "")
    .split(/[;|]/)
    .map((value) => value.trim())
    .filter(Boolean)

/** Turns a row's failure into its problems; a database outage stops the whole import instead. */
const rowProblems = (error: { readonly _tag: string; readonly userMessage: UserText }): ReadonlyArray<FieldProblem> =>
  error._tag === "InputRejected"
    ? (error as InputRejected).problems
    : [{ field: "row", problem: "conflict", userMessage: error.userMessage }]

/** A Subscription status cell: our own labels, or yes and no. Empty leaves it as it is. */
const subscriptionOf = (cell: string | undefined): "subscribed" | "unsubscribed" | "invalid" | undefined => {
  const value = cell?.trim().toLowerCase()
  if (!value) return undefined
  if (["subscribed", "yes", "y", "true", "1"].includes(value)) return "subscribed"
  if (["unsubscribed", "no", "n", "false", "0"].includes(value)) return "unsubscribed"
  return "invalid"
}

/**
 * Matches a record-owner cell (D123) to a member of the team: by email, or by name when only one
 * member has it. Proofs are made once per member and reused across rows.
 */
const ownerMatcher = <P, T>(member: MemberOf<P, T>) =>
  Effect.gen(function* () {
    const members = yield* Members
    const everyone = yield* members.everyone(member.team.value)
    const byEmail = new Map(everyone.map((entry) => [entry.email.toLowerCase(), entry.userId]))
    const byNameAll = new Map<string, Array<UserId>>()
    for (const entry of everyone) {
      const key = entry.name.trim().toLowerCase()
      byNameAll.set(key, [...(byNameAll.get(key) ?? []), entry.userId])
    }
    const proofs = new Map<UserId, RecordOwner<T>>()
    /** The owner for a cell: undefined when empty, "unknown" when no member matches. */
    const match = (cell: string | undefined): UserId | "unknown" | undefined => {
      const key = cell?.trim().toLowerCase()
      if (!key) return undefined
      const byName = byNameAll.get(key)
      return byEmail.get(key) ?? (byName?.length === 1 ? byName[0] : undefined) ?? "unknown"
    }
    const prove = (userId: UserId | undefined) =>
      Effect.gen(function* () {
        if (userId === undefined) return undefined
        const cached = proofs.get(userId)
        if (cached) return cached
        const proof = yield* proveRecordOwner(member, userId)
        proofs.set(userId, proof)
        return proof
      })
    return { match, prove }
  })

const unknownOwner = (): FieldProblem => ({
  field: "owner",
  problem: "invalid-format",
  userMessage: userText`No one in the team has this name or email, so this row has no owner. Choose who it is when you import.`,
})

const TRUE = new Set(["true", "yes", "y", "1"])
const FALSE = new Set(["", "false", "no", "n", "0", "0.0"])

/** An "Unsubscribed" cell (D125): true when any of its parts says so. Several columns may feed it. */
const unsubscribedOf = (cell: string | undefined) => split(cell).some((part) => TRUE.has(part.toLowerCase()))

/** A "Bounced" cell (D125): true, or any reason (HubSpot's hard bounce reason), means bounced. */
const bouncedOf = (cell: string | undefined) => split(cell).some((part) => !FALSE.has(part.toLowerCase()))

/** A topic column (D127): true means the contact left that topic. */
const leftTopic = (cell: string | undefined) => unsubscribedOf(cell)

const SIMPLE_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/

/**
 * A "Created" cell (D129): 2021-06-15, 2021-06-15 14:50 or ISO 8601. Dates without a time zone are
 * read as UTC; HubSpot writes them in the portal's time zone, so they may be off by those hours.
 */
const createdAtOf = (cell: string | undefined): Date | "invalid" | undefined => {
  const text = cell?.trim()
  if (!text) return undefined
  const simple = SIMPLE_DATE.exec(text)
  const date = simple
    ? new Date(
        Date.UTC(
          Number(simple[1]),
          Number(simple[2]) - 1,
          Number(simple[3]),
          Number(simple[4] ?? 0),
          Number(simple[5] ?? 0),
          Number(simple[6] ?? 0),
        ),
      )
    : ISO_WITH_ZONE.test(text)
      ? new Date(text)
      : undefined
  if (!date || Number.isNaN(date.getTime())) return "invalid"
  // A date in the future, or before there was email, is a mistake in the file.
  if (date.getTime() > Date.now() + 86_400_000 || date.getUTCFullYear() < 1971) return "invalid"
  return date
}

const badCreatedAt = (): FieldProblem => ({
  field: "createdAt",
  problem: "invalid-format",
  userMessage: userText`This created date isn't a date like 2021-06-15, so the record gets today's date.`,
})

/** A row's address, with the country as a code from a code or a name (D128). Unknown countries are left out. */
const addressOfCells = (cells: Record<string, string>, warnings: Array<FieldProblem>): PostalAddress | undefined => {
  const text = (value: string | undefined) => {
    const trimmed = value?.trim()
    return trimmed ? trimmed.slice(0, 200) : null
  }
  let country: string | null = null
  const countryCell = cells.country?.split(";")[0]?.trim()
  if (countryCell) {
    country = countryCodeOf(countryCell) ?? null
    if (!country) {
      warnings.push({
        field: "address.country",
        problem: "invalid-format",
        userMessage: userText`Parley doesn't know this country, so it was left out. Use a country's name or two-letter code, like Australia or AU.`,
      })
    }
  }
  const address = {
    line1: text(cells.line1),
    line2: text(cells.line2),
    city: text(cells.city),
    region: text(cells.region),
    postcode: text(cells.postcode)?.slice(0, 20) ?? null,
    country,
  }
  return Object.values(address).some(Boolean) ? address : undefined
}

/**
 * Who each owner cell means (D127): the import's own choices first, each proven a member up front,
 * then the usual match by email or unique name. Unknown names are imported without an owner (D126).
 */
const ownerResolver = <P, T>(member: MemberOf<P, T>, chosen: Readonly<Record<string, UserId | null>> | undefined) =>
  Effect.gen(function* () {
    const matcher = yield* ownerMatcher(member)
    const choices = new Map<string, UserId | null>()
    for (const [cell, userId] of Object.entries(chosen ?? {})) {
      if (userId !== null) {
        yield* matcher.prove(userId).pipe(
          Effect.catchTag("MemberNotFound", () =>
            Effect.fail(
              new InputRejected({
                problems: [
                  {
                    field: "owners",
                    problem: "invalid-format",
                    userMessage: userText`One of the people chosen as an owner isn't a member of this team any more. Choose someone else.`,
                  },
                ],
              }),
            ),
          ),
        )
      }
      choices.set(cell.trim().toLowerCase(), userId)
    }
    /** null clears the owner, undefined leaves it, "unknown" is a name no one has. */
    const resolve = (cell: string | undefined): UserId | null | "unknown" | undefined => {
      const key = cell?.trim().toLowerCase()
      if (!key) return undefined
      if (choices.has(key)) return choices.get(key) ?? null
      return matcher.match(cell)
    }
    const prove = (resolved: UserId | null | "unknown" | undefined) =>
      resolved === null ? Effect.succeed(null) : matcher.prove(resolved === "unknown" ? undefined : resolved)
    return { resolve, prove }
  })

/** The topic columns of a mapping (D127), each proven to be one of the team's topics before any row. */
const topicColumns = <P, T>(member: MemberOf<P, T>, mapping: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const ids = [
      ...new Set(
        Object.values(mapping)
          .filter((target) => target.startsWith("topic:"))
          .map((target) => target.slice(6) as TopicId),
      ),
    ]
    if (ids.length === 0) return undefined
    return yield* proveTopicsInTeam(member, ids).pipe(
      Effect.catchTag("TopicNotFound", () =>
        Effect.fail(
          new InputRejected({
            problems: [
              {
                field: "mapping",
                problem: "invalid-format",
                userMessage: userText`A column is matched to a topic that doesn't exist. Create the topic, or skip the column.`,
              },
            ],
          }),
        ),
      ),
    )
  })

type Outcome = {
  created: number
  updated: number
  failed: Array<ImportResult["failed"][number]>
  warnings: Array<ImportResult["warnings"][number]>
}

export const importContactsCsv = (principal: Principal, input: OperationInput<typeof importContacts>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const companies = yield* Companies
      const affiliations = yield* Affiliations
      const customFields = yield* CustomFields
      const subscriptions = yield* Subscriptions
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const fields = yield* customFields.list(team, "contact", canRead)
      const parsed = yield* parse(input.csv, input.mapping, "contact", fields)
      yield* checkSet(input.set, "contact", fields)
      const owners = yield* ownerResolver(member, input.owners)
      const topics = yield* topicColumns(member, parsed.mapping)

      // Rows match existing contacts by email, and companies by name.
      const byEmail = new Map<string, ContactId>()
      for (const contact of yield* allContacts(team, canRead)) {
        for (const email of contact.emails) byEmail.set(email.address, contact.id)
      }
      const companyByName = new Map<string, CompanyId>()
      for (const company of yield* allCompanies(team, canRead))
        companyByName.set(company.name.toLowerCase(), company.id)

      const result: Outcome = { created: 0, updated: 0, failed: [], warnings: [] }
      for (const [index, row] of parsed.rows.entries()) {
        const line = index + 2
        const cells = withSet(cellsOf(parsed, row), input.set, fields)
        const problems: Array<FieldProblem> = []
        // Values that can't be used are left out and the row is still imported (D126).
        const warnings: Array<FieldProblem> = []
        const custom = customOf(cells, fields, warnings)
        const [first, ...rest] = (cells.name ?? "").split(/\s+/).filter(Boolean)
        const emails = [...new Set([...split(cells.email), ...split(cells.emails)].map((email) => email.toLowerCase()))]
        const allPhones = split(cells.phone).map((phone) => phone.replace(/[\s().-]/g, ""))
        const phones = [...new Set(allPhones.filter((phone) => Schema.is(PhoneNumber)(phone)))]
        // Rows skip the request's schema, so each cell is checked here as an operation's input would be.
        if (emails.some((email) => !Schema.is(EmailAddress)(email))) {
          problems.push({
            field: "email",
            problem: "invalid-format",
            userMessage: userText`This isn't a full email address.`,
          })
        }
        if (phones.length < allPhones.length) {
          warnings.push({
            field: "phone",
            problem: "invalid-format",
            userMessage: userText`A phone number without its country code was left out. Numbers need it, like +61 400 812 337.`,
          })
        }
        const owner = owners.resolve(cells.owner)
        if (owner === "unknown") warnings.push(unknownOwner())
        const subscription = subscriptionOf(cells.subscriptionStatus)
        if (subscription === "invalid") {
          warnings.push({
            field: "subscriptionStatus",
            problem: "invalid-format",
            userMessage: userText`Subscription status should be Subscribed or Unsubscribed (or yes or no), so it was left as it was.`,
          })
        }
        // Bounced beats unsubscribed beats a subscription status column (D125).
        const reported = bouncedOf(cells.bounced)
          ? "bounced"
          : unsubscribedOf(cells.unsubscribed)
            ? "unsubscribed"
            : undefined
        const createdAt = createdAtOf(cells.createdAt)
        if (createdAt === "invalid") warnings.push(badCreatedAt())
        const address = addressOfCells(cells, warnings)
        if (problems.length > 0) {
          result.failed.push({ line, problems })
          continue
        }
        const fieldsForRow: ContactFields = {
          ...((cells.firstName ?? first) ? { firstName: cells.firstName ?? first ?? null } : {}),
          ...((cells.lastName ?? (rest.length > 0 ? rest.join(" ") : undefined))
            ? { lastName: cells.lastName ?? rest.join(" ") }
            : {}),
          ...(phones.length > 0 ? { phones: phones.map((number) => ({ number: number as never })) } : {}),
          ...(address ? { address } : {}),
          ...(Object.keys(custom).length > 0 ? { custom } : {}),
          ...(subscription && subscription !== "invalid" ? { subscriptionStatus: subscription } : {}),
        }
        const leftTopics = new Map<TopicId, boolean>()
        for (const [header, target] of Object.entries(parsed.mapping)) {
          if (!target.startsWith("topic:")) continue
          const cell = row[parsed.headers.indexOf(header)]
          if (leftTopic(cell)) leftTopics.set(target.slice(6) as TopicId, false)
        }
        const existing = emails.map((email) => byEmail.get(email)).find(Boolean)
        yield* Effect.matchEffect(
          Effect.gen(function* () {
            // An empty owner cell leaves a contact's owner as it is.
            const ownerChange = yield* owners.prove(owner)
            let contactId: ContactId
            if (existing) {
              // Updating keeps the contact's other emails, adding any new ones from the row.
              contactId = yield* named(existing, (contact) =>
                Effect.gen(function* () {
                  const proof = yield* proveContactInTeam(team, contact, canRead)
                  const current = yield* contacts.get(proof)
                  const known = new Set(current.emails.map((email) => email.address as string))
                  const added = emails.filter((email) => !known.has(email))
                  // An import never subscribes someone again who opted out: that takes a person
                  // with email:manage, one contact at a time. It may report them unsubscribed or bounced.
                  const { subscriptionStatus, custom: rowCustom, ...otherFields } = fieldsForRow
                  const custom = rowCustom
                    ? mergeCustom(rowCustom, current.custom, fields, input.multiSelect ?? "add")
                    : undefined
                  const keepStatus =
                    subscriptionStatus === "unsubscribed" || current.subscriptionStatus === "subscribed"
                  const downgrade =
                    reported === "bounced"
                      ? current.subscriptionStatus === "bounced"
                        ? undefined
                        : "bounced"
                      : reported === "unsubscribed" && current.subscriptionStatus === "subscribed"
                        ? "unsubscribed"
                        : undefined
                  const updated = yield* contacts.update(
                    proof,
                    {
                      ...otherFields,
                      ...(custom ? { custom } : {}),
                      ...(subscriptionStatus && keepStatus && !reported ? { subscriptionStatus } : {}),
                      ...(added.length > 0
                        ? { emails: [...current.emails, ...added.map((address) => ({ address: address as never }))] }
                        : {}),
                    },
                    canWrite,
                    undefined,
                    ownerChange,
                    downgrade ? { status: downgrade } : undefined,
                  )
                  return updated.id
                }),
              )
              result.updated++
            } else {
              const created = yield* contacts.create(
                team,
                {
                  ...fieldsForRow,
                  ...(emails.length > 0 ? { emails: emails.map((address) => ({ address: address as never })) } : {}),
                },
                canWrite,
                ownerChange ?? undefined,
                {
                  ...(createdAt instanceof Date ? { createdAt } : {}),
                  ...(reported ? { status: reported } : {}),
                },
              )
              contactId = created.id
              for (const email of emails) byEmail.set(email, created.id)
              result.created++
            }
            if (topics && leftTopics.size > 0) {
              yield* named(contactId, (contact) =>
                Effect.gen(function* () {
                  const proof = yield* proveContactInTeam(team, contact, canRead)
                  yield* subscriptions.updateTopics(proof, topics, leftTopics, canWrite)
                }),
              )
            }
            const companyName = cells.company?.split(";")[0]?.trim()
            if (companyName) {
              let companyId = companyByName.get(companyName.toLowerCase())
              if (!companyId) {
                const company = yield* companies.create(team, { name: companyName.slice(0, 200) }, canWrite)
                companyId = company.id
                companyByName.set(companyName.toLowerCase(), companyId)
              }
              const title = cells.title?.trim().slice(0, 100) || undefined
              yield* named(contactId, companyId, (contact, company) =>
                Effect.gen(function* () {
                  const contactProof = yield* proveContactInTeam(team, contact, canRead)
                  const companyProof = yield* proveCompanyInTeam(team, company, canRead)
                  yield* affiliations.create(contactProof, companyProof, title, canWrite)
                }),
              )
            }
            if (warnings.length > 0) result.warnings.push({ line, problems: warnings })
          }),
          {
            onSuccess: () => Effect.void,
            onFailure: (error) =>
              error._tag === "DatabaseUnavailable"
                ? Effect.fail(error)
                : Effect.sync(() => {
                    result.failed.push({ line, problems: rowProblems(error) })
                  }),
          },
        )
      }
      return result
    }),
  )

export const importCompaniesCsv = (principal: Principal, input: OperationInput<typeof importCompanies>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const customFields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const fields = yield* customFields.list(team, "company", canRead)
      const parsed = yield* parse(input.csv, input.mapping, "company", fields)
      yield* checkSet(input.set, "company", fields)
      const owners = yield* ownerResolver(member, input.owners)

      // Rows match existing companies by domain, then by exact name.
      const byDomain = new Map<string, CompanyId>()
      const byName = new Map<string, CompanyId>()
      for (const company of yield* allCompanies(team, canRead)) {
        for (const entry of company.domains) byDomain.set(entry.domain, company.id)
        byName.set(company.name.toLowerCase(), company.id)
      }

      const result: Outcome = { created: 0, updated: 0, failed: [], warnings: [] }
      for (const [index, row] of parsed.rows.entries()) {
        const line = index + 2
        const cells = withSet(cellsOf(parsed, row), input.set, fields)
        // Values that can't be used are left out and the row is still imported (D126).
        const warnings: Array<FieldProblem> = []
        const custom = customOf(cells, fields, warnings)
        // A "domain" may come as a website or an email address; keep just the domain.
        const allDomains = split(cells.domains).map((value) =>
          normalizeDomain(
            value.includes("@") ? domainOfEmail(value) : (value.replace(/^https?:\/\//i, "").split("/")[0] ?? ""),
          ),
        )
        const domains = [...new Set(allDomains.filter((domain) => Schema.is(Domain)(domain)))]
        if (domains.length < allDomains.length) {
          warnings.push({
            field: "domains",
            problem: "invalid-format",
            userMessage: userText`Something that isn't a domain, like acme.com, was left out.`,
          })
        }
        const name = cells.name?.trim().slice(0, 200)
        const address = addressOfCells(cells, warnings)
        const websiteCell = cells.website?.split(";")[0]?.trim()
        const website = websiteCell
          ? /^https?:\/\//i.test(websiteCell)
            ? websiteCell
            : `https://${websiteCell}`
          : undefined
        const phoneCell = cells.phone?.split(";")[0]?.replace(/[\s().-]/g, "")
        const phone = phoneCell && Schema.is(PhoneNumber)(phoneCell) ? phoneCell : undefined
        if (phoneCell && !phone) {
          warnings.push({
            field: "phone",
            problem: "invalid-format",
            userMessage: userText`A phone number without its country code was left out. Numbers need it, like +61 2 9000 1234.`,
          })
        }
        const goodWebsite = website && Schema.is(Website)(website) ? website : undefined
        if (website && !goodWebsite) {
          warnings.push({
            field: "website",
            problem: "invalid-format",
            userMessage: userText`This isn't a web address, so it was left out.`,
          })
        }
        const owner = owners.resolve(cells.owner)
        if (owner === "unknown") warnings.push(unknownOwner())
        const createdAt = createdAtOf(cells.createdAt)
        if (createdAt === "invalid") warnings.push(badCreatedAt())
        const fieldsForRow: CompanyFields = {
          ...(goodWebsite ? { website: goodWebsite as never } : {}),
          ...(phone ? { phone: phone as never } : {}),
          ...(address ? { address } : {}),
          ...(Object.keys(custom).length > 0 ? { custom } : {}),
        }
        const existing =
          domains.map((domain) => byDomain.get(domain)).find(Boolean) ??
          (name ? byName.get(name.toLowerCase()) : undefined)
        yield* Effect.matchEffect(
          Effect.gen(function* () {
            // An empty owner cell leaves a company's owner as it is.
            const ownerChange = yield* owners.prove(owner)
            if (existing) {
              yield* named(existing, (company) =>
                Effect.gen(function* () {
                  const proof = yield* proveCompanyInTeam(team, company, canRead)
                  const current = yield* companies.get(proof)
                  const known = new Set(current.domains.map((entry) => entry.domain as string))
                  const added = domains.filter((domain) => !known.has(domain))
                  const { custom: rowCustom, ...otherFields } = fieldsForRow
                  const custom = rowCustom
                    ? mergeCustom(rowCustom, current.custom, fields, input.multiSelect ?? "add")
                    : undefined
                  yield* companies.update(
                    proof,
                    {
                      ...otherFields,
                      ...(custom ? { custom } : {}),
                      ...(name ? { name } : {}),
                      ...(added.length > 0
                        ? { domains: [...current.domains, ...added.map((domain) => ({ domain: domain as never }))] }
                        : {}),
                    },
                    canWrite,
                    ownerChange,
                  )
                }),
              )
              result.updated++
            } else {
              if (!name) {
                return yield* new InputRejected({
                  problems: [
                    { field: "name", problem: "missing", userMessage: userText`Each new company needs a name.` },
                  ],
                })
              }
              const created = yield* companies.create(
                team,
                {
                  ...fieldsForRow,
                  name,
                  ...(domains.length > 0 ? { domains: domains.map((domain) => ({ domain: domain as never })) } : {}),
                },
                canWrite,
                ownerChange ?? undefined,
                createdAt instanceof Date ? { createdAt } : undefined,
              )
              for (const domain of domains) byDomain.set(domain, created.id)
              byName.set(name.toLowerCase(), created.id)
              result.created++
            }
            if (warnings.length > 0) result.warnings.push({ line, problems: warnings })
          }),
          {
            onSuccess: () => Effect.void,
            onFailure: (error) =>
              error._tag === "DatabaseUnavailable"
                ? Effect.fail(error)
                : Effect.sync(() => {
                    result.failed.push({ line, problems: rowProblems(error) })
                  }),
          },
        )
      }
      return result
    }),
  )
