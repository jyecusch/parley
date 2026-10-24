import { expectedInputOf, operationsAt } from "@parley/api"

const PREFIX = "/api/v1"

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

/**
 * A request under /api/v1 that no route took. The router answers those with a bare 404, which
 * reads as "wrong team or record" when the method is what's wrong (GET on a POST-only path). This
 * says which: 405 with the methods the path takes, or 404 pointing at the API's description.
 */
export const explainUnmatched = (request: Request): Response | undefined => {
  const path = new URL(request.url).pathname
  if (!path.startsWith(`${PREFIX}/`) || path === `${PREFIX}/openapi.json`) return undefined
  const matches = operationsAt(path)
  if (matches.length > 0) {
    const allowed = [...new Set(matches.map((route) => route.method))]
    const options = matches.map((route) => `${route.method} (${route.name})`).join(" or ")
    return json(
      405,
      {
        _tag: "MethodNotAllowed",
        error: {
          _tag: "MethodNotAllowed",
          userMessage: `This path takes ${options}, not ${request.method}.`,
          isRetryable: false,
          // What each method here takes (D143).
          details: { expected: matches.map((route) => expectedInputOf(route.name)) },
        },
      },
      { allow: allowed.join(", ") },
    )
  }
  return json(404, {
    _tag: "NotFound",
    error: {
      _tag: "RouteNotFound",
      userMessage: `There's no ${request.method} ${path} in Parley's API. Every operation is described at ${PREFIX}/openapi.json.`,
      isRetryable: false,
    },
  })
}

/**
 * A body in a format the API doesn't read: the router answers 415 in plain text. This says the
 * same in the API's own JSON error.
 */
export const explainUnsupportedBody = (request: Request): Response =>
  json(415, {
    _tag: "UnsupportedMediaType",
    error: {
      _tag: "UnsupportedMediaType",
      userMessage: `This endpoint reads JSON, not ${request.headers.get("content-type") ?? "an unlabelled body"}. Send the body as JSON with the header content-type: application/json.`,
      isRetryable: false,
    },
  })
