/** CSV (RFC 4180) for import and export (D62). Browser-safe, so the web app can preview a file. */

/** Parses CSV text into rows of cells. Handles quotes, escaped quotes, CRLF and a byte-order mark. */
export const parseCsv = (text: string): Array<Array<string>> => {
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let cell = ""
  let quoted = false
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ",") {
      row.push(cell)
      cell = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else cell += c
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""))
}

const cellOf = (value: string) => {
  // A leading =, +, - or @ would run as a formula in a spreadsheet; a quote mark keeps it as text.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Writes rows as CSV, with CRLF line ends. */
export const toCsv = (rows: ReadonlyArray<ReadonlyArray<string>>): string =>
  `${rows.map((cells) => cells.map(cellOf).join(",")).join("\r\n")}\r\n`

/** The fields a CSV column can map to when importing, by record type. Custom fields are "custom:<id>". */
/** Address columns, the same for contacts (D128) and companies; aliases include HubSpot's headers. */
const ADDRESS_FIELDS = [
  { field: "line1", label: "Street", aliases: ["street", "address", "address line 1", "street address"] },
  { field: "line2", label: "Street, line 2", aliases: ["address line 2", "street 2", "street address 2"] },
  { field: "city", label: "City", aliases: ["city", "town", "suburb"] },
  { field: "region", label: "State or region", aliases: ["region", "state", "province", "county", "state/region"] },
  { field: "postcode", label: "Postcode", aliases: ["postcode", "zip", "zip code", "postal code"] },
  { field: "country", label: "Country", aliases: ["country", "country code", "country/region"] },
] as const

/** A record's original created date (D129), applied to records the import creates. */
const CREATED_FIELD = {
  field: "createdAt",
  label: "Created",
  aliases: ["created", "created at", "create date", "date created"],
} as const

export const IMPORT_FIELDS = {
  contact: [
    { field: "firstName", label: "First name", aliases: ["first name", "first", "given name", "firstname"] },
    { field: "lastName", label: "Last name", aliases: ["last name", "last", "surname", "family name", "lastname"] },
    { field: "name", label: "Full name", aliases: ["name", "full name", "fullname"] },
    { field: "email", label: "Email", aliases: ["email", "e-mail", "email address", "primary email"] },
    { field: "emails", label: "Other emails", aliases: ["other emails", "emails", "additional email addresses"] },
    {
      field: "phone",
      label: "Phone",
      aliases: ["phone", "phone number", "mobile", "phones", "mobile phone number", "mobile phone"],
    },
    {
      field: "company",
      label: "Company",
      aliases: ["company", "organization", "organisation", "companies", "company name"],
    },
    { field: "title", label: "Title", aliases: ["title", "job title", "position", "role"] },
    ...ADDRESS_FIELDS,
    {
      field: "subscriptionStatus",
      label: "Subscription status",
      aliases: ["subscription status", "subscription", "subscribed", "marketing email", "email consent"],
    },
    {
      field: "unsubscribed",
      label: "Unsubscribed (true or false)",
      aliases: ["unsubscribed", "unsubscribed from all email", "opted out of email: marketing emails", "opted out"],
    },
    {
      field: "bounced",
      label: "Bounced (true, or a reason)",
      aliases: [
        "bounced",
        "hard bounced",
        "email hard bounce reason",
        "invalid email address",
        "email address quarantined",
      ],
    },
    { field: "owner", label: "Contact owner", aliases: ["contact owner", "owner", "record owner", "account owner"] },
    CREATED_FIELD,
  ],
  company: [
    { field: "name", label: "Name", aliases: ["name", "company", "company name"] },
    {
      field: "domains",
      label: "Domains",
      aliases: ["domain", "domains", "email domain", "company domain name", "additional domains"],
    },
    { field: "website", label: "Website", aliases: ["website", "url", "web", "website url"] },
    { field: "phone", label: "Phone", aliases: ["phone", "phone number"] },
    ...ADDRESS_FIELDS,
    { field: "owner", label: "Company owner", aliases: ["company owner", "owner", "record owner", "account owner"] },
    CREATED_FIELD,
  ],
} as const

/**
 * Fields several columns may fill at once, their values combined: lists (emails, phones, domains)
 * and flags any of several columns can raise (HubSpot keeps consent in more than one).
 */
const COMBINED_FIELDS: ReadonlySet<string> = new Set(["emails", "phone", "domains", "unsubscribed", "bounced"])

/**
 * Guesses which field each column holds from its header: built-in aliases first, then custom
 * field names. Columns it can't place are left out ("skip").
 */
export const guessMapping = (
  headers: ReadonlyArray<string>,
  recordType: "contact" | "company",
  custom: ReadonlyArray<{ readonly id: string; readonly name: string; readonly recordType: string }>,
): Record<string, string> => {
  const mapping: Record<string, string> = {}
  const used = new Set<string>()
  for (const header of headers) {
    const key = header.trim().toLowerCase()
    const builtIn = IMPORT_FIELDS[recordType].find(
      (entry) =>
        (!used.has(entry.field) || COMBINED_FIELDS.has(entry.field)) &&
        (entry.aliases as ReadonlyArray<string>).includes(key),
    )
    const customField = custom.find(
      (field) => field.recordType === recordType && field.name.toLowerCase() === key && !used.has(`custom:${field.id}`),
    )
    const field = builtIn?.field ?? (customField ? `custom:${customField.id}` : undefined)
    if (field) {
      mapping[header] = field
      used.add(field)
    }
  }
  return mapping
}
