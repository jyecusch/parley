import {
  type Company,
  type CompanyFields,
  type CompanyId,
  type Contact,
  type ContactFields,
  type ContactId,
  type CustomField,
  type CustomValue,
  Domain,
  domainOfEmail,
  EmailAddress,
  type exportCompanies,
  type exportContacts,
  type FieldProblem,
  guessMapping,
  type ImportResult,
  InputRejected,
  type importCompanies,
  type importContacts,
  normalizeDomain,
  type OperationInput,
  PhoneNumber,
  parseCsv,
  type RecordType,
  SUBSCRIPTION_STATUS_LABELS,
  toCsv,
  Website,
} from "@parley/domain"
import { type UserText, userText } from "@parley/errors"
import { Effect, Schema } from "effect"
import type { Principal } from "../principal.ts"
import { proveCompanyInTeam } from "../proofs/company-in-team.ts"
import { proveContactInTeam } from "../proofs/contact-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { type CanReadRecords, proveCanReadRecords, proveCanWriteRecords } from "../proofs/permissions.ts"
import { type Named, named } from "../proofs/proof.ts"
import { Affiliations } from "../services/affiliations.ts"
import { Companies } from "../services/companies.ts"
import { Contacts } from "../services/contacts.ts"
import { CustomFields } from "../services/custom-fields.ts"

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

export const exportContactsCsv = (principal: Principal, input: OperationInput<typeof exportContacts>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const customFields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const fields = yield* customFields.list(team, "contact", canRead)
      const items: Array<Contact> = []
      let cursor: string | undefined
      for (let page = 0; page < 200; page++) {
        const result = yield* contacts.list(
          team,
          { limit: 200, ...(input.filter ? { filter: input.filter } : {}), ...(cursor ? { cursor } : {}) },
          canRead,
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
        "Subscription status",
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
            SUBSCRIPTION_STATUS_LABELS[contact.subscriptionStatus],
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

export const importContactsCsv = (principal: Principal, input: OperationInput<typeof importContacts>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const companies = yield* Companies
      const affiliations = yield* Affiliations
      const customFields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const fields = yield* customFields.list(team, "contact", canRead)
      const parsed = yield* parse(input.csv, input.mapping, "contact", fields)

      // Rows match existing contacts by email, and companies by name.
      const byEmail = new Map<string, ContactId>()
      for (const contact of yield* allContacts(team, canRead)) {
        for (const email of contact.emails) byEmail.set(email.address, contact.id)
      }
      const companyByName = new Map<string, CompanyId>()
      for (const company of yield* allCompanies(team, canRead))
        companyByName.set(company.name.toLowerCase(), company.id)

      const result: { created: number; updated: number; failed: Array<ImportResult["failed"][number]> } = {
        created: 0,
        updated: 0,
        failed: [],
      }
      for (const [index, row] of parsed.rows.entries()) {
        const line = index + 2
        const cells = cellsOf(parsed, row)
        const problems: Array<FieldProblem> = []
        const custom = customOf(cells, fields, problems)
        const [first, ...rest] = (cells.name ?? "").split(/\s+/).filter(Boolean)
        const emails = [...split(cells.email), ...split(cells.emails)].map((email) => email.toLowerCase())
        const phones = split(cells.phone).map((phone) => phone.replace(/[\s().-]/g, ""))
        // Rows skip the request's schema, so each cell is checked here as an operation's input would be.
        if (emails.some((email) => !Schema.is(EmailAddress)(email))) {
          problems.push({
            field: "email",
            problem: "invalid-format",
            userMessage: userText`This isn't a full email address.`,
          })
        }
        if (phones.some((phone) => !Schema.is(PhoneNumber)(phone))) {
          problems.push({
            field: "phone",
            problem: "invalid-format",
            userMessage: userText`Phone numbers need their country code, like +61 400 812 337.`,
          })
        }
        const subscription = subscriptionOf(cells.subscriptionStatus)
        if (subscription === "invalid") {
          problems.push({
            field: "subscriptionStatus",
            problem: "invalid-format",
            userMessage: userText`Subscription status should be Subscribed or Unsubscribed (or yes or no).`,
          })
        }
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
          ...(Object.keys(custom).length > 0 ? { custom } : {}),
          ...(subscription && subscription !== "invalid" ? { subscriptionStatus: subscription } : {}),
        }
        const existing = emails.map((email) => byEmail.get(email)).find(Boolean)
        const outcome = yield* Effect.matchEffect(
          Effect.gen(function* () {
            let contactId: ContactId
            if (existing) {
              // Updating keeps the contact's other emails, adding any new ones from the row.
              const target = yield* named(existing, (contact) =>
                Effect.gen(function* () {
                  const proof = yield* proveContactInTeam(team, contact, canRead)
                  const current = yield* contacts.get(proof)
                  const known = new Set(current.emails.map((email) => email.address as string))
                  const added = emails.filter((email) => !known.has(email))
                  const updated = yield* contacts.update(
                    proof,
                    {
                      ...fieldsForRow,
                      ...(added.length > 0
                        ? { emails: [...current.emails, ...added.map((address) => ({ address: address as never }))] }
                        : {}),
                    },
                    canWrite,
                  )
                  return updated.id
                }),
              )
              contactId = target
              result.updated++
            } else {
              const created = yield* contacts.create(
                team,
                {
                  ...fieldsForRow,
                  ...(emails.length > 0 ? { emails: emails.map((address) => ({ address: address as never })) } : {}),
                },
                canWrite,
              )
              contactId = created.id
              for (const email of emails) byEmail.set(email, created.id)
              result.created++
            }
            const companyName = cells.company?.split(";")[0]?.trim()
            if (companyName) {
              let companyId = companyByName.get(companyName.toLowerCase())
              if (!companyId) {
                const company = yield* companies.create(team, { name: companyName }, canWrite)
                companyId = company.id
                companyByName.set(companyName.toLowerCase(), companyId)
              }
              const title = cells.title?.trim() || undefined
              yield* named(contactId, companyId, (contact, company) =>
                Effect.gen(function* () {
                  const contactProof = yield* proveContactInTeam(team, contact, canRead)
                  const companyProof = yield* proveCompanyInTeam(team, company, canRead)
                  yield* affiliations.create(contactProof, companyProof, title, canWrite)
                }),
              )
            }
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
        void outcome
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

      // Rows match existing companies by domain, then by exact name.
      const byDomain = new Map<string, CompanyId>()
      const byName = new Map<string, CompanyId>()
      for (const company of yield* allCompanies(team, canRead)) {
        for (const entry of company.domains) byDomain.set(entry.domain, company.id)
        byName.set(company.name.toLowerCase(), company.id)
      }

      const result: { created: number; updated: number; failed: Array<ImportResult["failed"][number]> } = {
        created: 0,
        updated: 0,
        failed: [],
      }
      for (const [index, row] of parsed.rows.entries()) {
        const line = index + 2
        const cells = cellsOf(parsed, row)
        const problems: Array<FieldProblem> = []
        const custom = customOf(cells, fields, problems)
        // A "domain" may come as a website or an email address; keep just the domain.
        const domains = split(cells.domains).map((value) =>
          normalizeDomain(
            value.includes("@") ? domainOfEmail(value) : (value.replace(/^https?:\/\//i, "").split("/")[0] ?? ""),
          ),
        )
        const name = cells.name?.trim()
        const country = cells.country?.trim().toUpperCase()
        if (country && !/^[A-Z]{2}$/.test(country)) {
          problems.push({
            field: "address.country",
            problem: "invalid-format",
            userMessage: userText`Countries need their two-letter code, like AU or US.`,
          })
        }
        if (problems.length > 0) {
          result.failed.push({ line, problems })
          continue
        }
        const address = {
          line1: cells.line1 ?? null,
          line2: cells.line2 ?? null,
          city: cells.city ?? null,
          region: cells.region ?? null,
          postcode: cells.postcode ?? null,
          country: country ?? null,
        }
        const hasAddress = Object.values(address).some(Boolean)
        const website = cells.website
          ? /^https?:\/\//i.test(cells.website)
            ? cells.website
            : `https://${cells.website}`
          : undefined
        const phone = cells.phone?.replace(/[\s().-]/g, "")
        if (phone && !Schema.is(PhoneNumber)(phone)) {
          problems.push({
            field: "phone",
            problem: "invalid-format",
            userMessage: userText`Phone numbers need their country code, like +61 2 9000 1234.`,
          })
        }
        if (website && !Schema.is(Website)(website)) {
          problems.push({
            field: "website",
            problem: "invalid-format",
            userMessage: userText`This isn't a web address.`,
          })
        }
        if (domains.some((domain) => !Schema.is(Domain)(domain))) {
          problems.push({
            field: "domains",
            problem: "invalid-format",
            userMessage: userText`This isn't a domain, like acme.com.`,
          })
        }
        if (problems.length > 0) {
          result.failed.push({ line, problems })
          continue
        }
        const fieldsForRow: CompanyFields = {
          ...(website ? { website: website as never } : {}),
          ...(phone ? { phone: phone as never } : {}),
          ...(hasAddress ? { address } : {}),
          ...(Object.keys(custom).length > 0 ? { custom } : {}),
        }
        const existing =
          domains.map((domain) => byDomain.get(domain)).find(Boolean) ??
          (name ? byName.get(name.toLowerCase()) : undefined)
        yield* Effect.matchEffect(
          Effect.gen(function* () {
            if (existing) {
              yield* named(existing, (company) =>
                Effect.gen(function* () {
                  const proof = yield* proveCompanyInTeam(team, company, canRead)
                  const current = yield* companies.get(proof)
                  const known = new Set(current.domains.map((entry) => entry.domain as string))
                  const added = domains.filter((domain) => !known.has(domain))
                  yield* companies.update(
                    proof,
                    {
                      ...fieldsForRow,
                      ...(name ? { name } : {}),
                      ...(added.length > 0
                        ? { domains: [...current.domains, ...added.map((domain) => ({ domain: domain as never }))] }
                        : {}),
                    },
                    canWrite,
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
              )
              for (const domain of domains) byDomain.set(domain, created.id)
              byName.set(name.toLowerCase(), created.id)
              result.created++
            }
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
