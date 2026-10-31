import { Cause, Effect, Layer } from "effect"
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http"
import { expect, it, vi } from "vitest"
import { Logging } from "./logging.ts"

it("writes startup and request errors as complete single-line JSON events", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {})
  const error = new Error("PgConnection: Connection timed out")
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(
      Layer.effectDiscard(Effect.logWarning("broadcast worker database operation failed", Cause.fail(error))),
      HttpRouter.add(
        "GET",
        "/log",
        Effect.gen(function* () {
          yield* Effect.logWarning("request database operation failed", Cause.fail(error))
          return HttpServerResponse.empty()
        }),
      ),
    ).pipe(Layer.provide(HttpServer.layerServices), Layer.provideMerge(Logging.layer)),
  )
  try {
    expect((await app.handler(new Request("http://localhost/log"))).status).toBe(204)
    const lines = output.mock.calls.map(([line]) => String(line))
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) {
      expect(line).not.toContain("\n")
      expect(() => JSON.parse(line)).not.toThrow()
    }
    const warnings = lines.map((line) => JSON.parse(line)).filter((event) => event.level === "WARN")
    expect(warnings.map((event) => event.message)).toEqual([
      "broadcast worker database operation failed",
      "request database operation failed",
    ])
    for (const warning of warnings) {
      expect(JSON.stringify(warning)).toContain("Connection timed out")
      expect(warning.cause).toContain("logging.test.ts")
    }
  } finally {
    await app.dispose()
    output.mockRestore()
  }
})

it.each([
  [200, "INFO"],
  [422, "WARN"],
  [503, "ERROR"],
] as const)("summarizes HTTP %i responses with route, status, duration and severity", async (status, level) => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {})
  const path = "/api/v1/teams/:teamId/invitations"
  const app = HttpRouter.toWebHandler(
    HttpRouter.add("GET", path, HttpServerResponse.empty({ status })).pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(Logging.layer),
    ),
  )
  try {
    const response = await app.handler(
      new Request("http://localhost/api/v1/teams/team-private/invitations?token=secret"),
    )
    expect(response.status).toBe(status)
    const events = output.mock.calls.map(([line]) => JSON.parse(String(line)))
    const requests = events.filter((event) => event.annotations["http.status"] === status)
    expect(requests).toHaveLength(1)
    const event = requests[0]
    expect(event.message).toMatch(new RegExp(String.raw`^GET ${path} → ${status} \(\d+ ms\)$`))
    expect(event.level).toBe(level)
    expect(event.annotations["http.route"]).toBe(path)
    expect(event.annotations["http.url"]).toBe(path)
    expect(event.annotations["http.duration_ms"]).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(event)).not.toContain("team-private")
    expect(JSON.stringify(event)).not.toContain("secret")
  } finally {
    await app.dispose()
    output.mockRestore()
  }
})

it("keeps the complete cause when an HTTP request fails unexpectedly", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {})
  const error = new Error("request database connection timed out")
  const app = HttpRouter.toWebHandler(
    HttpRouter.add("GET", "/failure", Effect.die(error)).pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(Logging.layer),
    ),
  )
  try {
    expect((await app.handler(new Request("http://localhost/failure"))).status).toBe(500)
    const events = output.mock.calls.map(([line]) => JSON.parse(String(line)))
    const event = events.find((event) => event.annotations["http.status"] === 500)
    expect(event.message).toMatch(/^GET \/failure → 500 \(\d+ ms\)$/)
    expect(event.level).toBe("ERROR")
    expect(event.cause).toContain(error.message)
    expect(event.cause).toContain("logging.test.ts")
  } finally {
    await app.dispose()
    output.mockRestore()
  }
})

it("identifies unmatched requests without putting raw paths or query values in the summary", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {})
  const app = HttpRouter.toWebHandler(
    HttpRouter.add("GET", "/known", HttpServerResponse.empty()).pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(Logging.layer),
    ),
  )
  try {
    expect((await app.handler(new Request("http://localhost/secret-path?token=secret-query"))).status).toBe(404)
    const events = output.mock.calls.map(([line]) => JSON.parse(String(line)))
    const event = events.find((event) => event.annotations["http.status"] === 404)
    expect(event.message).toMatch(/^GET \(unmatched route\) → 404 \(\d+ ms\)$/)
    expect(event.level).toBe("WARN")
    expect(event.message).not.toContain("secret-path")
    expect(event.annotations["http.url"]).toBe("(unmatched route)")
    expect(event.cause).toContain("RouteNotFound")
    expect(JSON.stringify(event)).not.toContain("secret-query")
  } finally {
    await app.dispose()
    output.mockRestore()
  }
})
