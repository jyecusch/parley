import { CoreLive } from "@parley/core"
import { ApiRoutesLive, AuthRoutesLive, FailureResponsesLive } from "@parley/http"
import { McpRoutesLive } from "@parley/mcp"
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"

/**
 * The whole server as one Effect web handler: /api/v1 (operations), /api/auth (Better-Auth)
 * and /mcp (operations as tools). Process tier: built once, on first use.
 */
const AppLive = Layer.mergeAll(ApiRoutesLive, AuthRoutesLive, McpRoutesLive, FailureResponsesLive).pipe(
  Layer.provide(CoreLive),
  Layer.provide(HttpServer.layerServices),
)

const makeApp = () => HttpRouter.toWebHandler(AppLive)
let app: ReturnType<typeof makeApp> | undefined

export const handle = (request: Request): Promise<Response> => {
  app ??= makeApp()
  return app.handler(request)
}
