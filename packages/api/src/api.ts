import { type Operation, operations } from "@parley/domain"
import { Schema, type SchemaAST } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ErrorBodies } from "./errors.ts"

export const API_PREFIX = "/api/v1"

/** The `:name` segments of an operation's path. */
export const pathParamsOf = (path: string): ReadonlyArray<string> =>
  path
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1))

const pick = (fields: Schema.Struct.Fields, keys: ReadonlyArray<string>, keep: boolean): Schema.Struct.Fields =>
  Object.fromEntries(Object.entries(fields).filter(([key]) => keys.includes(key) === keep))

/** Whether a field holds an object or a list, perhaps optionally (an optional field is a union with undefined). */
const isStructured = (ast: SchemaAST.AST): boolean =>
  ast._tag === "Objects" || ast._tag === "Arrays" || (ast._tag === "Union" && ast.types.some(isStructured))

/**
 * A GET's query fields as a URL carries them (D142): strings, numbers and booleans as they are,
 * and objects and lists, such as a filter, as JSON in one parameter.
 */
const queryFields = (fields: Schema.Struct.Fields): Schema.Struct.Fields =>
  Object.fromEntries(
    Object.entries(fields).map(([key, field]) => {
      if (!isStructured(field.ast)) return [key, field]
      const inner = (field as unknown as { readonly schema?: Schema.Top }).schema
      return [key, inner ? Schema.optional(Schema.fromJsonString(inner)) : Schema.fromJsonString(field)]
    }),
  )

/**
 * One endpoint per operation, derived from its contract (D16). Path parameters come from the
 * path; the rest of the input is the query for GET and DELETE (objects as JSON), and the JSON body otherwise.
 */
const endpointFor = (op: Operation) => {
  const pathKeys = pathParamsOf(op.http.path)
  const params = pick(op.input.fields, pathKeys, true)
  const restFields = pick(op.input.fields, pathKeys, false)
  const rest = Schema.Struct(restFields)
  // An operation whose whole input is in the path takes no body, so agents can POST without one.
  const hasBody = (op.http.method === "POST" || op.http.method === "PATCH") && Object.keys(restFields).length > 0
  const make = HttpApiEndpoint.make(op.http.method)
  return make(op.name, `${API_PREFIX}${op.http.path}`, {
    params,
    ...(hasBody
      ? { payload: rest }
      : Object.keys(restFields).length > 0
        ? { query: Schema.Struct(queryFields(restFields)) }
        : {}),
    success: op.output,
    error: ErrorBodies,
  })
    .annotate(OpenApi.Summary, op.name)
    .annotate(OpenApi.Description, op.description)
}

const endpoints = Object.values(operations).map((op) => endpointFor(op as Operation))
const [first, ...others] = endpoints

/** The public HTTP API. Its OpenAPI document is served at /api/v1/openapi.json. */
export const ParleyApi = HttpApi.make("parley").add(
  // biome-ignore lint/style/noNonNullAssertion: the registry is never empty
  HttpApiGroup.make("v1").add(first!, ...others),
)
