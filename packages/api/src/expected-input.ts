import { type Operation, type OperationName, operations } from "@parley/domain"
import { Schema } from "effect"
import { API_PREFIX, pathParamsOf } from "./api.ts"

/**
 * What an operation takes over HTTP (D143): its method and path, and JSON Schemas for its query or
 * body. Generated from the operation's input schema, as the OpenAPI document is, so it's always
 * the contract the API checks against. Sent with every InputRejected, so a caller can get the next
 * request right without looking anything up.
 */
export interface ExpectedInput {
  readonly operation: OperationName
  readonly description: string
  readonly method: string
  /** With `{name}` for each path parameter, OpenAPI style. */
  readonly path: string
  readonly pathParameters: ReadonlyArray<string>
  /** For GET and DELETE. Objects and lists go as JSON in one parameter (D142). */
  readonly query?: unknown
  /** For POST and PATCH, as JSON with content-type: application/json. */
  readonly body?: unknown
}

/**
 * Tidies generated JSON Schema for reading: an optional field that's also nullable comes out as an
 * anyOf inside an anyOf, each with a null. Flattens those and drops the repeats.
 */
const tidy = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(tidy)
  if (value === null || typeof value !== "object") return value
  const entries = Object.entries(value).map(([key, child]) => [key, tidy(child)] as const)
  const node = Object.fromEntries(entries) as Record<string, unknown>
  if (!Array.isArray(node.anyOf)) return node
  const seen = new Set<string>()
  const options = (node.anyOf as Array<unknown>)
    .flatMap((option) => {
      const only = option as Record<string, unknown>
      return Array.isArray(only.anyOf) && Object.keys(only).length === 1 ? (only.anyOf as Array<unknown>) : [option]
    })
    .filter((option) => {
      const key = JSON.stringify(option)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  const { anyOf: _, ...rest } = node
  return options.length === 1 && Object.keys(rest).length === 0 ? options[0] : { ...rest, anyOf: options }
}

const schemaOf = (fields: Schema.Struct.Fields) => {
  const document = Schema.toJsonSchemaDocument(Schema.Struct(fields))
  const definitions = document.definitions ?? {}
  return tidy(Object.keys(definitions).length > 0 ? { ...document.schema, $defs: definitions } : document.schema)
}

const build = (name: OperationName): ExpectedInput => {
  const op = operations[name] as Operation
  const pathParameters = pathParamsOf(op.http.path)
  const rest = Object.fromEntries(Object.entries(op.input.fields).filter(([key]) => !pathParameters.includes(key)))
  const hasBody = op.http.method === "POST" || op.http.method === "PATCH"
  return {
    operation: name,
    description: op.description,
    method: op.http.method,
    path: `${API_PREFIX}${op.http.path.replace(/:([^/]+)/g, "{$1}")}`,
    pathParameters,
    ...(Object.keys(rest).length === 0 ? {} : hasBody ? { body: schemaOf(rest) } : { query: schemaOf(rest) }),
  }
}

const cache = new Map<OperationName, ExpectedInput>()

/** An operation's expected input, generated once. */
export const expectedInputOf = (name: OperationName): ExpectedInput => {
  let found = cache.get(name)
  if (!found) {
    found = build(name)
    cache.set(name, found)
  }
  return found
}

const routes = Object.values(operations).map((op) => ({
  name: op.name as OperationName,
  method: op.http.method as string,
  pattern: new RegExp(`^${API_PREFIX}${op.http.path.replace(/:[^/]+/g, "[^/]+")}/?$`),
}))

/** The operations a path under /api/v1 belongs to, whatever the method. */
export const operationsAt = (pathname: string) => routes.filter((route) => route.pattern.test(pathname))

/** The operation a request is for, if any. */
export const operationFor = (method: string, pathname: string): OperationName | undefined =>
  operationsAt(pathname).find((route) => route.method === method)?.name
