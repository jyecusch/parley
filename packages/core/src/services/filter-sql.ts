import {
  type CustomField,
  checkCondition,
  type FieldProblem,
  type Filter,
  type FilterCondition,
  type FilterFieldInfo,
  filterFields,
  InputRejected,
  type RecordType,
  type Sort,
} from "@parley/domain"
import { userText } from "@parley/errors"
import { type SQL, sql } from "drizzle-orm"
import { Effect } from "effect"

/**
 * Compiles filters (D59) to SQL for contacts and companies. It mirrors `matchesFilter` in the domain
 * package, which the web app runs on loaded records; the filter tests run both on the same cases.
 * Every value is a bound parameter; only fixed column names are written into the SQL.
 */

const problems = {
  "unknown-field": userText`There's no such field to filter by. Use a built-in field or a custom field from fields.list.`,
  "wrong-operator": userText`This comparison doesn't work for this kind of field.`,
  "missing-value": userText`This condition needs a value to compare with.`,
  "wrong-value": userText`This value doesn't suit this field. Check it and try again.`,
}

/** Checks a filter against the record type's fields, reporting every bad condition at once (D26). */
export const checkFilter = (
  recordType: RecordType,
  filter: Filter,
  custom: ReadonlyArray<CustomField>,
): Effect.Effect<ReadonlyArray<FilterFieldInfo>, InputRejected> => {
  const fields = filterFields(recordType, custom)
  const found: Array<FieldProblem> = []
  filter.conditions.forEach((condition, index) => {
    const problem = checkCondition(condition, fields)
    if (problem) {
      found.push({
        field: `filter.conditions.${index}`,
        problem:
          problem === "missing-value" ? "missing" : problem === "unknown-field" ? "not-allowed" : "invalid-format",
        userMessage: problems[problem],
      })
    }
  })
  return found.length > 0 ? Effect.fail(new InputRejected({ problems: found })) : Effect.succeed(fields)
}

const like = (value: unknown) => `%${String(value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`
const prefix = (value: unknown) => `${String(value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`
const textArray = (value: unknown) =>
  sql`array[${sql.join(
    (Array.isArray(value) ? value : []).map((item) => sql`${String(item)}`),
    sql`, `,
  )}]::text[]`

/** A text operator applied to a single text expression. */
const textCondition = (expr: SQL, condition: FilterCondition): SQL => {
  const value = condition.value
  switch (condition.operator) {
    case "contains":
      return sql`coalesce(${expr}, '') ilike ${like(value)}`
    case "does-not-contain":
      return sql`coalesce(${expr}, '') not ilike ${like(value)}`
    case "is":
      return sql`lower(coalesce(${expr}, '')) = lower(${String(value)})`
    case "is-not":
      return sql`lower(coalesce(${expr}, '')) <> lower(${String(value)})`
    case "starts-with":
      return sql`coalesce(${expr}, '') ilike ${prefix(value)}`
    case "is-empty":
      return sql`coalesce(${expr}, '') = ''`
    case "is-not-empty":
      return sql`coalesce(${expr}, '') <> ''`
    default:
      return sql`false`
  }
}

/**
 * A text operator over a set of values (a contact's emails, a company's domains): "contains" means
 * any value contains it, and the negative forms mean none does, like the evaluator.
 */
const textSetCondition = (from: SQL, column: SQL, condition: FilterCondition): SQL => {
  const any = (predicate: SQL) => sql`exists (select 1 from ${from} and ${predicate})`
  const value = condition.value
  switch (condition.operator) {
    case "contains":
      return any(sql`${column} ilike ${like(value)}`)
    case "does-not-contain":
      return sql`not ${any(sql`${column} ilike ${like(value)}`)}`
    case "is":
      return any(sql`lower(${column}) = lower(${String(value)})`)
    case "is-not":
      return sql`not ${any(sql`lower(${column}) = lower(${String(value)})`)}`
    case "starts-with":
      return any(sql`${column} ilike ${prefix(value)}`)
    case "is-empty":
      return sql`not ${any(sql`true`)}`
    case "is-not-empty":
      return any(sql`true`)
    default:
      return sql`false`
  }
}

const numberCondition = (expr: SQL, condition: FilterCondition): SQL => {
  const value = Number(condition.value)
  switch (condition.operator) {
    case "equals":
      return sql`${expr} = ${value}`
    case "greater-than":
      return sql`${expr} > ${value}`
    case "less-than":
      return sql`${expr} < ${value}`
    case "is-empty":
      return sql`${expr} is null`
    case "is-not-empty":
      return sql`${expr} is not null`
    default:
      return sql`false`
  }
}

/** Dates compare as UTC calendar days, like the evaluator. `day` is a YYYY-MM-DD text expression. */
const dateCondition = (day: SQL, condition: FilterCondition): SQL => {
  switch (condition.operator) {
    case "before":
      return sql`${day} < ${String(condition.value)}`
    case "after":
      return sql`${day} > ${String(condition.value)}`
    case "in-last-days":
      return sql`${day} >= to_char((now() at time zone 'UTC') - make_interval(days => ${Number(condition.value)}), 'YYYY-MM-DD')`
    case "is-empty":
      return sql`${day} is null`
    case "is-not-empty":
      return sql`${day} is not null`
    default:
      return sql`false`
  }
}

const timestampDay = (column: SQL) => sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`

const customCondition = (field: CustomField, condition: FilterCondition): SQL => {
  const id = field.id as string
  const json = sql`custom->${id}::text`
  const text = sql`(custom->>${id}::text)`
  switch (field.type) {
    case "number":
      return numberCondition(sql`(case when jsonb_typeof(${json}) = 'number' then (${text})::numeric end)`, condition)
    case "date":
      return dateCondition(text, condition)
    case "checkbox":
      return condition.operator === "is-checked"
        ? sql`${json} = 'true'::jsonb`
        : sql`coalesce(${json} <> 'true'::jsonb, true)`
    case "single-select":
      switch (condition.operator) {
        case "is-any-of":
          return sql`${text} = any(${textArray(condition.value)})`
        case "is-none-of":
          return sql`coalesce(not (${text} = any(${textArray(condition.value)})), true)`
        case "is-empty":
          return sql`${text} is null`
        case "is-not-empty":
          return sql`${text} is not null`
        default:
          return sql`false`
      }
    case "multi-select":
      switch (condition.operator) {
        case "has-any-of":
          return sql`coalesce(${json} ?| ${textArray(condition.value)}, false)`
        case "has-all-of":
          return sql`coalesce(${json} ?& ${textArray(condition.value)}, false)`
        case "has-none-of":
          return sql`not coalesce(${json} ?| ${textArray(condition.value)}, false)`
        case "is-empty":
          return sql`coalesce(jsonb_array_length(case when jsonb_typeof(${json}) = 'array' then ${json} end), 0) = 0`
        case "is-not-empty":
          return sql`coalesce(jsonb_array_length(case when jsonb_typeof(${json}) = 'array' then ${json} end), 0) > 0`
        default:
          return sql`false`
      }
    default:
      return textCondition(text, condition)
  }
}

/**
 * A record owner (D123): a nullable user id. Like the evaluator, "none of" includes records with no
 * owner, and "any of" never matches them.
 */
const ownerCondition = (column: SQL, condition: FilterCondition): SQL => {
  switch (condition.operator) {
    case "is-any-of":
      return sql`${column} = any(${textArray(condition.value)})`
    case "is-none-of":
      return sql`coalesce(not (${column} = any(${textArray(condition.value)})), true)`
    case "is-empty":
      return sql`${column} is null`
    case "is-not-empty":
      return sql`${column} is not null`
    default:
      return sql`false`
  }
}

const contactCondition = (condition: FilterCondition, info: FilterFieldInfo): SQL => {
  if (info.custom) return customCondition(info.custom, condition)
  switch (condition.field) {
    case "name":
      return textCondition(sql`trim(concat_ws(' ', "contacts"."first_name", "contacts"."last_name"))`, condition)
    case "email":
      return textSetCondition(sql`"contact_emails" e where e.contact_id = "contacts"."id"`, sql`e.address`, condition)
    case "phone":
      return textSetCondition(sql`"contact_phones" p where p.contact_id = "contacts"."id"`, sql`p.number`, condition)
    case "city":
      return textCondition(sql`"contacts"."city"`, condition)
    case "country":
      return textCondition(sql`"contacts"."country"`, condition)
    case "company": {
      const live = (extra: SQL) =>
        sql`exists (select 1 from "affiliations" a join "companies" co on co.id = a.company_id
          where a.contact_id = "contacts"."id" and co.deleted_at is null and ${extra})`
      switch (condition.operator) {
        case "is-any-of":
          return live(sql`a.company_id::text = any(${textArray(condition.value)})`)
        case "is-none-of":
          return sql`not ${live(sql`a.company_id::text = any(${textArray(condition.value)})`)}`
        case "is-empty":
          return sql`not ${live(sql`true`)}`
        case "is-not-empty":
          return live(sql`true`)
        default:
          return sql`false`
      }
    }
    case "subscriptionStatus":
      switch (condition.operator) {
        case "is-any-of":
          return sql`"contacts"."subscription_status" = any(${textArray(condition.value)})`
        case "is-none-of":
          return sql`not ("contacts"."subscription_status" = any(${textArray(condition.value)}))`
        case "is-empty":
          return sql`false`
        case "is-not-empty":
          return sql`true`
        default:
          return sql`false`
      }
    case "owner":
      return ownerCondition(sql`"contacts"."owner_id"`, condition)
    case "createdAt":
      return dateCondition(timestampDay(sql`"contacts"."created_at"`), condition)
    case "updatedAt":
      return dateCondition(timestampDay(sql`"contacts"."updated_at"`), condition)
    default:
      return sql`false`
  }
}

const companyCondition = (condition: FilterCondition, info: FilterFieldInfo): SQL => {
  if (info.custom) return customCondition(info.custom, condition)
  switch (condition.field) {
    case "name":
      return textCondition(sql`"companies"."name"`, condition)
    case "domain":
      return textSetCondition(sql`"company_domains" d where d.company_id = "companies"."id"`, sql`d.domain`, condition)
    case "website":
      return textCondition(sql`"companies"."website"`, condition)
    case "country":
      return textCondition(sql`"companies"."country"`, condition)
    case "contactCount":
      return numberCondition(
        sql`(select count(*)::int from "affiliations" a join "contacts" c on c.id = a.contact_id
          where a.company_id = "companies"."id" and c.deleted_at is null)`,
        condition,
      )
    case "owner":
      return ownerCondition(sql`"companies"."owner_id"`, condition)
    case "createdAt":
      return dateCondition(timestampDay(sql`"companies"."created_at"`), condition)
    case "updatedAt":
      return dateCondition(timestampDay(sql`"companies"."updated_at"`), condition)
    default:
      return sql`false`
  }
}

/** The WHERE clause for a checked filter, or undefined when it has no conditions. */
export const filterSql = (
  recordType: RecordType,
  filter: Filter,
  fields: ReadonlyArray<FilterFieldInfo>,
): SQL | undefined => {
  if (filter.conditions.length === 0) return undefined
  const parts = filter.conditions.map((condition) => {
    const info = fields.find((entry) => entry.field === condition.field)
    if (!info) return sql`false`
    return sql`(${recordType === "contact" ? contactCondition(condition, info) : companyCondition(condition, info)})`
  })
  return sql`(${sql.join(parts, filter.match === "all" ? sql` and ` : sql` or `)})`
}

/** The ORDER BY expression for a sort, with id as a tiebreaker so pages are stable. */
export const sortSql = (recordType: RecordType, sort: Sort, fields: ReadonlyArray<FilterFieldInfo>): SQL => {
  const table = recordType === "contact" ? sql`"contacts"` : sql`"companies"`
  const direction = sort.direction === "asc" ? sql`asc` : sql`desc`
  const info = fields.find((entry) => entry.field === sort.field)
  let expr: SQL
  if (info?.custom) {
    const id = info.custom.id as string
    expr =
      info.custom.type === "number"
        ? sql`(case when jsonb_typeof(custom->${id}::text) = 'number' then (custom->>${id}::text)::numeric end)`
        : sql`lower(custom->>${id}::text)`
  } else if (sort.field === "owner") {
    // By the owner's name; records without one sort last.
    expr = sql`lower((select u.name from "user" u where u.id = ${table}."owner_id"))`
  } else if (sort.field === "city" || sort.field === "country") {
    expr = sql`lower(${table}.${sql.identifier(sort.field)})`
  } else if (sort.field === "createdAt") {
    expr = sql`${table}."created_at"`
  } else if (sort.field === "name") {
    expr =
      recordType === "contact"
        ? sql`lower(nullif(trim(concat_ws(' ', "contacts"."first_name", "contacts"."last_name")), ''))`
        : sql`lower("companies"."name")`
  } else {
    expr = sql`${table}."updated_at"`
  }
  return sql`${expr} ${direction} nulls last, ${table}."id" ${direction}`
}
