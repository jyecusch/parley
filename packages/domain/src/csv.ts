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
export const IMPORT_FIELDS = {
  contact: [
    { field: "firstName", label: "First name", aliases: ["first name", "first", "given name", "firstname"] },
    { field: "lastName", label: "Last name", aliases: ["last name", "last", "surname", "family name", "lastname"] },
    { field: "name", label: "Full name", aliases: ["name", "full name", "fullname"] },
    { field: "email", label: "Email", aliases: ["email", "e-mail", "email address", "primary email"] },
    { field: "emails", label: "Other emails", aliases: ["other emails", "emails"] },
    { field: "phone", label: "Phone", aliases: ["phone", "phone number", "mobile", "phones"] },
    { field: "company", label: "Company", aliases: ["company", "organization", "organisation", "companies"] },
    { field: "title", label: "Title", aliases: ["title", "job title", "position", "role"] },
  ],
  company: [
    { field: "name", label: "Name", aliases: ["name", "company", "company name"] },
    { field: "domains", label: "Domains", aliases: ["domain", "domains", "email domain"] },
    { field: "website", label: "Website", aliases: ["website", "url", "web"] },
    { field: "phone", label: "Phone", aliases: ["phone", "phone number"] },
    { field: "line1", label: "Street", aliases: ["street", "address", "address line 1", "street address"] },
    { field: "line2", label: "Street, line 2", aliases: ["address line 2", "street 2"] },
    { field: "city", label: "City", aliases: ["city", "town", "suburb"] },
    { field: "region", label: "Region", aliases: ["region", "state", "province", "county"] },
    { field: "postcode", label: "Postcode", aliases: ["postcode", "zip", "zip code", "postal code"] },
    { field: "country", label: "Country", aliases: ["country", "country code"] },
  ],
} as const

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
      (entry) => !used.has(entry.field) && (entry.aliases as ReadonlyArray<string>).includes(key),
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
