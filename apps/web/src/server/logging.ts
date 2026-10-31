export * as Logging from "./logging.ts"

import { Context, Formatter, Logger } from "effect"
import { HttpRouter } from "effect/http"

const jsonFormatter = Logger.make((options) => {
  const event = Logger.formatStructured.log(options)
  const method = event.annotations["http.method"]
  const status = event.annotations["http.status"]
  if (typeof method !== "string" || typeof status !== "number") return Formatter.formatJson(event)

  const route =
    Context.getOrUndefined(options.fiber.context, HttpRouter.RouteContext)?.route.path ?? "(unmatched route)"
  const durationMilliseconds = event.spans["http.span"]
  return Formatter.formatJson({
    ...event,
    message: `${method} ${route} → ${status} (${durationMilliseconds} ms)`,
    level: status >= 500 ? "ERROR" : status >= 400 ? "WARN" : event.level,
    annotations: {
      ...event.annotations,
      "http.url": route,
      "http.route": route,
      "http.duration_ms": durationMilliseconds,
    },
  })
})

export const layer = Logger.layer([Logger.withConsoleLog(jsonFormatter), Logger.tracerLogger])
