import { type AnyOperationError, detailsOf, ERROR_STATUS } from "@parley/api"
import {
  type AuthenticationFailure,
  Authenticator,
  classifyDecodeError,
  implementations,
  type OperationServices,
  type Principal,
} from "@parley/core"
import { type Operation, type OperationName, operations } from "@parley/domain"
import { defectPublicError, type PublicError, ReferenceId, toPublicError } from "@parley/errors"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { McpProtocol, McpSchema, McpServer } from "effect/ai"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

/** The principal behind the current MCP request. Request tier: provided per HTTP request, never stored. */
export class CurrentPrincipal extends Context.Service<CurrentPrincipal, Principal>()("@parley/mcp/CurrentPrincipal") {}

export const MCP_PATH = "/mcp"

/** MCP tool names allow [a-zA-Z0-9_-], so "contacts.update" becomes "contacts_update". */
export const toolName = (name: string) => name.replaceAll(".", "_")

/** MCP requires an object at the root of a tool's input schema, so a top-level $ref is inlined. */
const jsonSchemaOf = (schema: Schema.Top) => {
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "ignore" })
  const definitions: Record<string, unknown> = { ...document.definitions }
  let root = document.schema as Record<string, unknown>
  const ref = typeof root.$ref === "string" ? root.$ref.split("/").at(-1) : undefined
  if (ref && definitions[ref]) {
    root = definitions[ref] as Record<string, unknown>
    delete definitions[ref]
  }
  if (root.type === undefined) root = { type: "object", ...root }
  return Object.keys(definitions).length === 0 ? root : { ...root, $defs: definitions }
}

const result = (value: unknown, isError: boolean) =>
  new McpSchema.CallToolResult({
    isError,
    ...(isError ? {} : { structuredContent: value as Schema.Json }),
    content: [McpSchema.TextContent.make({ type: "text", text: JSON.stringify(value) })],
  })

/** A tool error carries the encoded PublicError and nothing else, so agents branch on data. */
const errorResult = (error: PublicError) => result(error, true)

const headersOf = (request: HttpServerRequest.HttpServerRequest) => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) headers.set(name, value)
  return headers
}

/** Registers one MCP tool per operation, derived from the registry (D16, D83). */
const ToolsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer
    const services = yield* Effect.context<OperationServices>()
    for (const name of Object.keys(operations) as Array<OperationName>) {
      const op = operations[name] as Operation
      const run = implementations[name] as (
        principal: Principal,
        input: unknown,
      ) => Effect.Effect<unknown, AnyOperationError, OperationServices>
      // Operation schemas are context-free; the registry's generic type just can't say so.
      const decode = Schema.decodeUnknownEffect(op.input) as (
        input: unknown,
        options: { readonly errors: "all" },
      ) => Effect.Effect<unknown, Schema.SchemaError>
      const encode = Schema.encodeUnknownEffect(op.output) as (
        output: unknown,
      ) => Effect.Effect<unknown, Schema.SchemaError>
      const inputSchema = yield* Schema.decodeUnknownEffect(McpSchema.ToolJson)(jsonSchemaOf(op.input)).pipe(
        Effect.orDie,
      )
      yield* server.addTool({
        tool: new McpSchema.Tool({
          name: toolName(op.name),
          description: op.description,
          inputSchema,
          annotations: {
            readOnlyHint: op.hints.readOnly,
            destructiveHint: op.hints.destructive,
            idempotentHint: op.hints.idempotent,
            openWorldHint: false,
          },
        }),
        annotations: Context.empty(),
        handle: (payload) =>
          Effect.gen(function* () {
            const principal = yield* Effect.serviceOption(CurrentPrincipal)
            if (Option.isNone(principal)) return yield* Effect.die("MCP tool called without an authenticated principal")
            const input = yield* decode(payload ?? {}, { errors: "all" }).pipe(
              Effect.mapError((error) => classifyDecodeError(error)),
            )
            const output = yield* run(principal.value, input)
            return result(yield* encode(output).pipe(Effect.orDie), false)
          }).pipe(
            Effect.catch((error: AnyOperationError) =>
              Effect.succeed(errorResult(toPublicError(error, detailsOf(error)))),
            ),
            Effect.catchCause((cause) => {
              const referenceId = ReferenceId.make()
              return Effect.logError("defect", { referenceId, tool: op.name }, cause).pipe(
                Effect.as(errorResult(defectPublicError(referenceId))),
              )
            }),
            Effect.provideContext(services),
          ),
      })
    }
  }),
)

/**
 * Authenticates every MCP request before the MCP server sees it. Agents send an API key
 * (x-api-key or Authorization: Bearer). Failures are plain HTTP errors with a PublicError body.
 */
const AuthenticateLive = HttpRouter.middleware<{ provides: CurrentPrincipal }>()(
  Effect.gen(function* () {
    const authenticator = yield* Authenticator
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* authenticator.authenticate(headersOf(request)).pipe(
          Effect.matchEffect({
            onFailure: (error: AuthenticationFailure) =>
              Effect.succeed(
                HttpServerResponse.jsonUnsafe({ error: toPublicError(error) }, { status: ERROR_STATUS[error._tag] }),
              ),
            onSuccess: (principal) => Effect.provideService(httpEffect, CurrentPrincipal, principal),
          }),
        )
      })
  }),
)

export const McpRoutesLive = ToolsLive.pipe(
  Layer.provideMerge(
    McpServer.layerHttp({
      name: "Parley",
      version: "0.1.0",
      description: "Parley CRM: contacts and companies for teams and their agents.",
      instructions:
        "Call teams_list first to find a teamId. Every other tool needs it. Errors come back as JSON with _tag, userMessage, isRetryable and sometimes details.",
      path: MCP_PATH,
      protocols: [McpProtocol.v2025_06_18, McpProtocol.v2025_11_25, McpProtocol.v2025_03_26],
    }),
  ),
  Layer.provide(AuthenticateLive.layer),
)
