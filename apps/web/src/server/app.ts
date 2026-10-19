import { BackgroundLive, CoreLive } from "@parley/core"
import {
  ApiRoutesLive,
  AuthRoutesLive,
  FailureResponsesLive,
  FileRoutesLive,
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
let app: ReturnType<typeof makeApp> | undefined

export const handle = (request: Request): Promise<Response> => {
  app ??= makeApp()
  return app.handler(request)
}
