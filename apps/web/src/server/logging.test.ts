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
