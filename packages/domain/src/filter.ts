import { Schema } from "effect"
import type { CustomField, CustomValue } from "./custom-field.ts"
import type { RecordType } from "./record-type.ts"

/**
 * Filters over contacts and companies (D59). One model for index views, saved views, exports and
 * dynamic segments (D2), so a segment is just a saved filter. Browser-safe: the web app evaluates
 * the same filters locally that the server compiles to SQL.
 */

/** The built-in fields a filter can use, by record type. Custom fields are "custom:<field id>". */
export const BUILT_IN_FILTER_FIELDS: Readonly<
  Record<
    RecordType,
    ReadonlyArray<{
      readonly field: string
      readonly label: string
      readonly kind: FilterKind
      readonly options?: ReadonlyArray<FilterOption>
    }>
  >
> = {
  contact: [
    { field: "name", label: "Name", kind: "text" },
    { field: "email", label: "Email", kind: "text" },
    { field: "phone", label: "Phone", kind: "text" },
    { field: "company", label: "Company", kind: "company" },
    { field: "owner", label: "Contact owner", kind: "member" },
    {
      field: "subscriptionStatus",
      label: "Subscription status",
      kind: "select",
      options: [
        { id: "subscribed", label: "Subscribed" },
        { id: "unsubscribed", label: "Unsubscribed" },
        { id: "bounced", label: "Bounced" },
        { id: "marked-as-spam", label: "Marked as spam" },
      ],
    },
    { field: "createdAt", label: "Created", kind: "date" },
    { field: "updatedAt", label: "Updated", kind: "date" },
  ],
  company: [
    { field: "name", label: "Name", kind: "text" },
    { field: "domain", label: "Domain", kind: "text" },
    { field: "website", label: "Website", kind: "text" },
    { field: "country", label: "Country", kind: "text" },
    { field: "contactCount", label: "Contacts", kind: "number" },
    { field: "owner", label: "Company owner", kind: "member" },
    { field: "createdAt", label: "Created", kind: "date" },
    { field: "updatedAt", label: "Updated", kind: "date" },
  ],
}

/** A choice for a select field. */
export interface FilterOption {
  readonly id: string
  readonly label: string
}

/** What sort of value a field holds, which decides its operators. */
/** "member": one of the team's members, by user id, such as a record owner (D123). */
export type FilterKind = "text" | "number" | "date" | "checkbox" | "select" | "multi" | "company" | "member"

export const FilterOperator = Schema.Literals([
  // text
  "contains",
  "does-not-contain",
  "is",
  "is-not",
  "starts-with",
  // number
  "equals",
  "greater-than",
  "less-than",
  // date
  "before",
  "after",
  "in-last-days",
  // checkbox
  "is-checked",
  "is-not-checked",
  // single select, company
  "is-any-of",
  "is-none-of",
  // multi select
  "has-any-of",
  "has-all-of",
  "has-none-of",
  // any kind
  "is-empty",
  "is-not-empty",
])
export type FilterOperator = typeof FilterOperator.Type

export const OPERATORS_BY_KIND: Readonly<Record<FilterKind, ReadonlyArray<FilterOperator>>> = {
  text: ["contains", "does-not-contain", "is", "is-not", "starts-with", "is-empty", "is-not-empty"],
  number: ["equals", "greater-than", "less-than", "is-empty", "is-not-empty"],
  date: ["before", "after", "in-last-days", "is-empty", "is-not-empty"],
  checkbox: ["is-checked", "is-not-checked"],
  select: ["is-any-of", "is-none-of", "is-empty", "is-not-empty"],
  multi: ["has-any-of", "has-all-of", "has-none-of", "is-empty", "is-not-empty"],
  company: ["is-any-of", "is-none-of", "is-empty", "is-not-empty"],
  member: ["is-any-of", "is-none-of", "is-empty", "is-not-empty"],
}

export const OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  contains: "contains",
  "does-not-contain": "doesn't contain",
  is: "is",
  "is-not": "isn't",
  "starts-with": "starts with",
  equals: "is",
  "greater-than": "is more than",
  "less-than": "is less than",
  before: "is before",
  after: "is after",
  "in-last-days": "is in the last",
  "is-checked": "is checked",
  "is-not-checked": "isn't checked",
  "is-any-of": "is any of",
  "is-none-of": "is none of",
  "has-any-of": "has any of",
  "has-all-of": "has all of",
  "has-none-of": "has none of",
  "is-empty": "is empty",
  "is-not-empty": "isn't empty",
}

/** Operators that need no value. */
export const VALUELESS: ReadonlySet<FilterOperator> = new Set([
  "is-empty",
  "is-not-empty",
  "is-checked",
  "is-not-checked",
])

export const FilterValue = Schema.Union([
  Schema.String.check(Schema.isMaxLength(500)),
  Schema.Number,
  Schema.Array(Schema.String.check(Schema.isMaxLength(100))).check(Schema.isMaxLength(200)),
])
export type FilterValue = typeof FilterValue.Type

export const FilterCondition = Schema.Struct({
  /** A built-in field ("email", "createdAt") or a custom field ("custom:<field id>"). */
  field: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  operator: FilterOperator,
  /** Text, a number, a date (YYYY-MM-DD), a number of days, or a list of option or company ids. */
  value: Schema.optional(FilterValue),
})
export type FilterCondition = typeof FilterCondition.Type

export const Filter = Schema.Struct({
  match: Schema.Literals(["all", "any"]),
  conditions: Schema.Array(FilterCondition).check(Schema.isMaxLength(30)),
}).annotate({
  title: "Filter",
  description:
    'Conditions on fields, all or any of which must hold. Example: {"match":"all","conditions":[{"field":"email","operator":"contains","value":"@acme.com"}]}. Custom fields are "custom:<field id>" from fields.list.',
})
export type Filter = typeof Filter.Type

export const Sort = Schema.Struct({
  field: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  direction: Schema.Literals(["asc", "desc"]),
}).annotate({
  title: "Sort",
  description: 'A built-in field or "custom:<field id>". Defaults to most recently updated.',
})
export type Sort = typeof Sort.Type

/** What a filter field is: its kind, label, and the custom field behind it if any. */
export interface FilterFieldInfo {
  readonly field: string
  readonly label: string
  readonly kind: FilterKind
  readonly custom: CustomField | undefined
  /** The choices of a select field, built-in or custom. */
  readonly options?: ReadonlyArray<FilterOption>
}

const kindOfCustom = (field: CustomField): FilterKind => {
  switch (field.type) {
    case "number":
      return "number"
    case "date":
      return "date"
    case "checkbox":
      return "checkbox"
    case "single-select":
      return "select"
    case "multi-select":
      return "multi"
    default:
      return "text"
  }
}

/** Every field a record type can be filtered or sorted by, built-in first. */
export const filterFields = (
  recordType: RecordType,
  custom: ReadonlyArray<CustomField>,
): ReadonlyArray<FilterFieldInfo> => [
  ...BUILT_IN_FILTER_FIELDS[recordType].map((entry) => ({ ...entry, custom: undefined })),
  ...custom
    .filter((field) => field.recordType === recordType)
    .map((field) => ({
      field: `custom:${field.id}`,
      label: field.name,
      kind: kindOfCustom(field),
      custom: field,
      ...(field.options.length > 0 ? { options: field.options } : {}),
    })),
]

/** Why a condition can't be used, or undefined if it can. Shared so the web app catches it early. */
export const checkCondition = (
  condition: FilterCondition,
  fields: ReadonlyArray<FilterFieldInfo>,
): "unknown-field" | "wrong-operator" | "missing-value" | "wrong-value" | undefined => {
  const info = fields.find((entry) => entry.field === condition.field)
  if (!info) return "unknown-field"
  if (!OPERATORS_BY_KIND[info.kind].includes(condition.operator)) return "wrong-operator"
  if (VALUELESS.has(condition.operator)) return undefined
  const value = condition.value
  if (value === undefined) return "missing-value"
  switch (info.kind) {
    case "number":
      return typeof value === "number" ? undefined : "wrong-value"
    case "date":
      if (condition.operator === "in-last-days")
        return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 36_500
          ? undefined
          : "wrong-value"
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : "wrong-value"
    case "select":
    case "multi":
    case "company":
    case "member":
      return Array.isArray(value) && value.length > 0 ? undefined : "wrong-value"
    default:
      return typeof value === "string" ? undefined : "wrong-value"
  }
}

/**
 * The values a record has for a filter field, as the evaluator sees them. The web app supplies these
 * from its loaded records; the server computes the same thing in SQL.
 */
export type FieldValue = string | number | boolean | ReadonlyArray<string> | null

const lower = (value: FieldValue): string => (typeof value === "string" ? value.toLowerCase() : "")
const isEmpty = (value: FieldValue) => value === null || value === "" || (Array.isArray(value) && value.length === 0)

const dayOf = (value: FieldValue) => (typeof value === "string" ? value.slice(0, 10) : "")

/** Whether one record matches a filter, given a way to read its field values. */
export const matchesFilter = (filter: Filter, read: (field: string) => FieldValue, now: Date = new Date()): boolean => {
  if (filter.conditions.length === 0) return true
  const test = (condition: FilterCondition): boolean => {
    const actual = read(condition.field)
    const value = condition.value
    switch (condition.operator) {
      case "is-empty":
        return isEmpty(actual)
      case "is-not-empty":
        return !isEmpty(actual)
      case "is-checked":
        return actual === true
      case "is-not-checked":
        return actual !== true
      case "contains":
        return Array.isArray(actual)
          ? actual.some((item) => item.toLowerCase().includes(String(value).toLowerCase()))
          : lower(actual).includes(String(value).toLowerCase())
      case "does-not-contain":
        return Array.isArray(actual)
          ? !actual.some((item) => item.toLowerCase().includes(String(value).toLowerCase()))
          : !lower(actual).includes(String(value).toLowerCase())
      case "is":
        return Array.isArray(actual)
          ? actual.some((item) => item.toLowerCase() === String(value).toLowerCase())
          : lower(actual) === String(value).toLowerCase()
      case "is-not":
        return Array.isArray(actual)
          ? !actual.some((item) => item.toLowerCase() === String(value).toLowerCase())
          : lower(actual) !== String(value).toLowerCase()
      case "starts-with":
        return Array.isArray(actual)
          ? actual.some((item) => item.toLowerCase().startsWith(String(value).toLowerCase()))
          : lower(actual).startsWith(String(value).toLowerCase())
      case "equals":
        return typeof actual === "number" && actual === value
      case "greater-than":
        return typeof actual === "number" && typeof value === "number" && actual > value
      case "less-than":
        return typeof actual === "number" && typeof value === "number" && actual < value
      case "before":
        return !isEmpty(actual) && dayOf(actual) < String(value)
      case "after":
        return !isEmpty(actual) && dayOf(actual) > String(value)
      case "in-last-days": {
        if (isEmpty(actual) || typeof value !== "number") return false
        const since = new Date(now.getTime() - value * 86_400_000).toISOString().slice(0, 10)
        return dayOf(actual) >= since
      }
      case "is-any-of":
      case "has-any-of": {
        const wanted = new Set(Array.isArray(value) ? value : [])
        return Array.isArray(actual) ? actual.some((item) => wanted.has(item)) : wanted.has(String(actual))
      }
      case "is-none-of":
      case "has-none-of": {
        const unwanted = new Set(Array.isArray(value) ? value : [])
        return Array.isArray(actual) ? !actual.some((item) => unwanted.has(item)) : !unwanted.has(String(actual))
      }
      case "has-all-of": {
        const have = new Set(Array.isArray(actual) ? actual : [])
        return (Array.isArray(value) ? value : []).every((item) => have.has(item))
      }
    }
  }
  return filter.match === "all" ? filter.conditions.every(test) : filter.conditions.some(test)
}

/** A custom value as the evaluator reads it. */
export const customFieldValue = (value: CustomValue | undefined): FieldValue =>
  value === undefined ? null : Array.isArray(value) ? value : (value as string | number | boolean)
