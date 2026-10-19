import { type AnyOperationError, ParleyApi } from "@parley/api"
import { Authenticator, BetterAuth, implementations, type OperationServices } from "@parley/core"
import { type OperationName, operations } from "@parley/domain"
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
      const principal = yield* authenticator.authenticate(headersOf(request))
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
  }),
)
