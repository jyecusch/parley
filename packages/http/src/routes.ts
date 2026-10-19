import { type AnyOperationError, ERROR_STATUS, ParleyApi } from "@parley/api"
import {
  Authenticator,
  BetterAuth,
  type FileStore,
  implementations,
  type Members,
  type OperationServices,
  readFile,
} from "@parley/core"
import { type FileNotFound, type OperationName, operations } from "@parley/domain"
import { toPublicError } from "@parley/errors"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { errorBody } from "./respond.ts"

interface DecodedRequest {
  readonly params?: object
  readonly query?: object
  readonly payload?: object
  readonly request: HttpServerRequest.HttpServerRequest
}

type Handler = (request: DecodedRequest) => Effect.Effect<unknown, unknown, Authenticator | OperationServices>

/** The shape of HttpApi's handler builder, seen through the registry rather than per endpoint. */
interface RegistryHandlers {
  readonly handle: (name: string, handler: Handler) => RegistryHandlers
}

const headersOf = (request: HttpServerRequest.HttpServerRequest) => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) headers.set(name, value)
  return headers
}

/** The entire HTTP entrypoint for an operation: authenticate, merge the decoded input, run. */
const handlerFor =
  (name: OperationName): Handler =>
  ({ params, query, payload, request }) =>
    Effect.gen(function* () {
      const authenticator = yield* Authenticator
      const principal = yield* authenticator.authenticate(headersOf(request), "http")
      const input = { ...params, ...query, ...payload }
      const run = implementations[name] as (
        principal: unknown,
        input: unknown,
      ) => Effect.Effect<unknown, AnyOperationError, OperationServices>
      return yield* run(principal, input)
    }).pipe(Effect.mapError((error: AnyOperationError) => errorBody(error)))

/**
 * Every operation, served under /api/v1, derived from the registry (D16). The builder can't see
 * that a loop handles every endpoint, so this is cast; `implementations` is what guarantees
 * every operation has a handler.
 */
export const ApiHandlersLive = HttpApiBuilder.group(ParleyApi, "v1", (handlers) => {
  let registry = handlers as unknown as RegistryHandlers
  for (const name of Object.keys(operations) as Array<OperationName>) {
    registry = registry.handle(name, handlerFor(name))
  }
  return registry as never
})

export const ApiRoutesLive = HttpApiBuilder.layer(ParleyApi, { openapiPath: "/api/v1/openapi.json" }).pipe(
  Layer.provide(ApiHandlersLive),
)

/** Better-Auth's own routes (sign-in, sessions). Its team and API key mutations are disabled (D17). */
export const AuthRoutesLive = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* BetterAuth
    const handle = (request: HttpServerRequest.HttpServerRequest) =>
      Effect.flatMap(HttpServerRequest.toWeb(request), (web) =>
        Effect.callback<HttpServerResponse.HttpServerResponse>((resume) => {
          auth.handler(web).then(
            (response) => resume(Effect.succeed(HttpServerResponse.fromWeb(response))),
            (cause) => resume(Effect.die(cause)),
          )
        }),
      ).pipe(Effect.orDie)
    yield* router.add("*", "/api/auth/*", handle)
    // OAuth discovery for agents (D89). The protected-resource metadata is answered by Better-Auth's
    // MCP plugin; the authorization server's lives under its base path, so it is re-served here.
    yield* router.add("GET", "/.well-known/oauth-protected-resource/*", handle)
    const metadata = (load: (request: Request) => Promise<unknown>) => (request: HttpServerRequest.HttpServerRequest) =>
      Effect.flatMap(HttpServerRequest.toWeb(request), (web) =>
        Effect.callback<HttpServerResponse.HttpServerResponse>((resume) => {
          load(web).then(
            (body) =>
              resume(
                Effect.succeed(
                  HttpServerResponse.jsonUnsafe(body, { headers: { "cache-control": "public, max-age=3600" } }),
                ),
              ),
            (cause) => resume(Effect.die(cause)),
          )
        }),
      ).pipe(Effect.orDie)
    yield* router.add(
      "GET",
      "/.well-known/oauth-authorization-server/*",
      metadata((request) => auth.api.getOAuthServerConfig({ request, asResponse: false })),
    )
    yield* router.add(
      "GET",
      "/.well-known/openid-configuration/*",
      metadata((request) => auth.api.getOpenIdConfig({ request, asResponse: false })),
    )
  }),
)

/**
 * Avatars and logos (D76), under the same authentication as the API. Keys are unguessable and
 * change on every upload, so a file can be cached for good.
 */
export const FileRoutesLive = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<Authenticator | Members | FileStore>()
    yield* router.add("GET", "/api/files/*", (request) =>
      Effect.gen(function* () {
        const authenticator = yield* Authenticator
        const principal = yield* authenticator.authenticate(headersOf(request), "http")
        const key = decodeURIComponent(new URL(request.url, "http://parley").pathname.replace(/^\/api\/files\//, ""))
        const file = yield* readFile(principal, key)
        return HttpServerResponse.uint8Array(file.bytes, {
          contentType: file.contentType,
          headers: {
            "cache-control": "private, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'",
          },
        })
      }).pipe(
        Effect.catchTag("FileNotFound", (error: FileNotFound) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe({ _tag: "NotFound", error: toPublicError(error, {}) }, { status: 404 }),
          ),
        ),
        Effect.catch((error: AnyOperationError) =>
          Effect.succeed(HttpServerResponse.jsonUnsafe(errorBody(error), { status: ERROR_STATUS[error._tag] })),
        ),
        Effect.provide(services),
      ),
    )
  }),
)
