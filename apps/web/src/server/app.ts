import { BackgroundLive, CoreLive } from "@parley/core"
import {
  ApiRoutesLive,
  AuthRoutesLive,
  FailureResponsesLive,
  FileRoutesLive,
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
  return limited instanceof Response ? Promise.resolve(limited) : app.handler(limited)
}
