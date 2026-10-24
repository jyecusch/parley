import { BackgroundLive, CoreLive } from "@parley/core"
import {
  ApiRoutesLive,
  AuthRoutesLive,
  explainUnmatched,
  explainUnsupportedBody,
  FailureResponsesLive,
  FileRoutesLive,
  FormRoutesLive,
  limitBody,
  UnsubscribeRoutesLive,
  WebhookRoutesLive,
} from "@parley/http"
import { McpRoutesLive } from "@parley/mcp"
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"

/**
 * The whole server as one Effect web handler: /api/v1 (operations), /api/auth (Better-Auth)
 * and /mcp (operations as tools), plus background work like the purge. Process tier: built once, on first use.
 */
const AppLive = Layer.mergeAll(
  ApiRoutesLive,
  AuthRoutesLive,
  FileRoutesLive,
  FormRoutesLive,
  UnsubscribeRoutesLive,
  WebhookRoutesLive,
  McpRoutesLive,
  FailureResponsesLive,
  BackgroundLive,
).pipe(Layer.provide(CoreLive), Layer.provide(HttpServer.layerServices))

const makeApp = () => HttpRouter.toWebHandler(AppLive)
type App = ReturnType<typeof makeApp>

/*
 * The app lives on globalThis, not in a module variable. In development, editing server code
 * re-evaluates this module; the new copy finds the old app here and closes it (its database pool and
 * background work), or every edit would leave connections open until Postgres refuses new ones.
 */
const KEY = Symbol.for("parley.app")
const holder = globalThis as typeof globalThis & { [KEY]?: App | undefined }
const stale = holder[KEY]
holder[KEY] = undefined
if (stale) void stale.dispose()

export const handle = (request: Request): Promise<Response> => {
  holder[KEY] ??= makeApp()
  const app = holder[KEY]
  const limited = limitBody(request)
  if (limited instanceof Response) return Promise.resolve(limited)
  return app.handler(limited).then((response) => {
    // The router's own plain answers, in the API's JSON errors: no route took it (a bare 404, not
    // a record's JSON one), or a body that isn't JSON.
    if (response.headers.get("content-type")?.includes("json")) return response
    if (response.status === 404) return explainUnmatched(request) ?? response
    if (response.status === 415 && new URL(request.url).pathname.startsWith("/api/v1/")) {
      return explainUnsupportedBody(request)
    }
    return response
  })
}
