import { type AnyOperationError, ERROR_STATUS, ParleyApi } from "@parley/api"
import {
  Authenticator,
  BetterAuth,
  type DeliveryEvents,
  type FileStore,
  implementations,
  type Members,
  type OperationServices,
  readFile,
  receiveDeliveryEvent,
  type Subscriptions,
  type UnsubscribeLinks,
  unsubscribeApply,
  unsubscribePage,
} from "@parley/core"
import {
  type DatabaseUnavailable,
  type FileNotFound,
  type OperationName,
  operations,
  UnsubscribeChange,
  type UnsubscribeLinkInvalid,
  type UnsubscribePage,
} from "@parley/domain"
import { toPublicError } from "@parley/errors"
import { Effect, Layer, Schema } from "effect"
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

/** The Better-Auth endpoints the web app and agents' OAuth clients call. */
const AUTH_PATHS: ReadonlySet<string> = new Set([
  "/ok",
  "/error",
  "/get-session",
  "/sign-in/email",
  "/sign-up/email",
  "/sign-out",
  "/send-verification-email",
  "/verify-email",
  "/jwks",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
  "/oauth2/authorize",
  "/oauth2/token",
  "/oauth2/register",
  "/oauth2/consent",
  "/oauth2/continue",
  "/oauth2/public-client",
  "/oauth2/public-client-prelogin",
  "/oauth2/userinfo",
  "/oauth2/revoke",
  "/oauth2/introspect",
  "/oauth2/end-session",
  "/oauth2/end-session/confirm",
])

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
    // Only the Better-Auth endpoints Parley uses are reachable. Everything else it ships (team and
    // member reads, account changes, client management) is answered as not found, so a new
    // Better-Auth feature is never exposed by accident.
    yield* router.add("*", "/api/auth/*", (request) => {
      const path = new URL(request.url, "http://parley").pathname.replace(/^\/api\/auth/, "")
      return AUTH_PATHS.has(path) ? handle(request) : Effect.succeed(HttpServerResponse.empty({ status: 404 }))
    })
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
        // Not URL-decoded: a key never contains anything that needs it, so an encoded "/" or "." is refused.
        const key = new URL(request.url, "http://parley").pathname.replace(/^\/api\/files\//, "")
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

const decodeChange = Schema.decodeUnknownOption(UnsubscribeChange)

/**
 * The unsubscribe page's data and changes (R39), with no sign-in: the signed link is the authority.
 * A POST with no JSON body is RFC 8058's one-click unsubscribe, sent by mail apps.
 */
export const UnsubscribeRoutesLive = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<Subscriptions | UnsubscribeLinks>()
    const tokenOf = (request: HttpServerRequest.HttpServerRequest) =>
      // Tokens are base64url and a dot, so they're never URL-encoded; a malformed % is just an invalid token.
      new URL(request.url, "http://parley").pathname.replace(/^\/api\/unsubscribe\//, "")
    const answer = (
      effect: Effect.Effect<
        UnsubscribePage,
        UnsubscribeLinkInvalid | DatabaseUnavailable,
        Subscriptions | UnsubscribeLinks
      >,
    ): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
      effect.pipe(
        Effect.map((page) =>
          HttpServerResponse.jsonUnsafe(page, {
            headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
          }),
        ),
        Effect.catchTag("UnsubscribeLinkInvalid", (error: UnsubscribeLinkInvalid) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe({ _tag: "NotFound", error: toPublicError(error, {}) }, { status: 404 }),
          ),
        ),
        Effect.catchTag("DatabaseUnavailable", (error: DatabaseUnavailable) =>
          Effect.succeed(HttpServerResponse.jsonUnsafe(errorBody(error), { status: ERROR_STATUS[error._tag] })),
        ),
        Effect.provide(services),
      )
    yield* router.add("GET", "/api/unsubscribe/*", (request) => answer(unsubscribePage(tokenOf(request))))
    yield* router.add("POST", "/api/unsubscribe/*", (request) =>
      Effect.gen(function* () {
        const type = request.headers["content-type"] ?? ""
        const body: unknown = type.includes("application/json")
          ? yield* request.json.pipe(Effect.orElseSucceed(() => null))
          : null
        const change = body === null ? undefined : decodeChange(body)
        return yield* answer(
          unsubscribeApply(tokenOf(request), change && change._tag === "Some" ? change.value : { kind: "one-click" }),
        )
      }),
    )
  }),
)

/** Resend's webhook (R46): deliveries, bounces and spam reports, checked by signature. */
export const WebhookRoutesLive = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<DeliveryEvents>()
    yield* router.add("POST", "/api/webhooks/resend", (request) =>
      Effect.gen(function* () {
        const body = yield* request.text.pipe(Effect.orElseSucceed(() => ""))
        const outcome = yield* receiveDeliveryEvent(headersOf(request), body)
        return outcome === "accepted"
          ? HttpServerResponse.empty({ status: 204 })
          : HttpServerResponse.empty({ status: 401 })
      }).pipe(
        Effect.catchTag("DatabaseUnavailable", () => Effect.succeed(HttpServerResponse.empty({ status: 503 }))),
        Effect.provide(services),
      ),
    )
  }),
)
