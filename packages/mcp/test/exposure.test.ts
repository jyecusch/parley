import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import { BetterAuth, CoreLive } from "@parley/core"
import type { CheckedExposureManifest, ExposureManifest, OperationName, Operations } from "@parley/domain"
import { ApiRoutesLive, FailureResponsesLive } from "@parley/http"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { vi } from "vitest"
import { McpRoutesLive } from "../src/index.ts"

vi.mock("@parley/domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@parley/domain")>()
  const exposures = {
    ...actual.operationExposures,
    "contacts.get": {
      http: { kind: "excluded", reason: "This fixture only offers contact listing over HTTP." },
      mcp: { kind: "analogous", operation: "contacts.list", reason: "List contacts and select the requested contact." },
    },
    "contacts.create": {
      ...actual.operationExposures["contacts.create"],
      mcp: { kind: "excluded", reason: "This fixture only offers contact creation over HTTP." },
    },
  } as const satisfies ExposureManifest<OperationName>
  exposures satisfies CheckedExposureManifest<typeof exposures, Operations>
  return {
    ...actual,
    operationExposures: exposures,
    httpOperationNames: actual.includedOperationNames(exposures, "http"),
    mcpOperationNames: actual.includedOperationNames(exposures, "mcp"),
  }
})

const AppLive = Layer.mergeAll(ApiRoutesLive, FailureResponsesLive, McpRoutesLive).pipe(
  Layer.provide(CoreLive),
  Layer.provide(HttpServer.layerServices),
)
const { handler, dispose } = HttpRouter.toWebHandler(AppLive, { disableLogger: true })
const runtime = ManagedRuntime.make(CoreLive)
let key = ""
let teamId = ""
let contactId = ""
let sessionId: string | undefined
let requestId = 0

const http = (method: string, path: string, body?: unknown) =>
  handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers: { "x-api-key": key, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )

const rpc = async (method: string, params: unknown) => {
  const response = await handler(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    }),
  )
  sessionId = response.headers.get("mcp-session-id") ?? sessionId
  const text = await response.text()
  return JSON.parse(
    response.headers.get("content-type")?.includes("text/event-stream")
      ? (text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .at(-1)
          ?.slice(5) ?? "null")
      : text,
  )
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const seeded = await runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* BetterAuth
      const user = yield* Effect.tryPromise(() =>
        auth.api.signUpEmail({
          body: { name: "Exposure test", email: `exposure-${suffix}@example.com`, password: "correct-horse-battery" },
        }),
      ).pipe(Effect.orDie)
      const team = yield* Effect.tryPromise(() =>
        auth.api.createOrganization({
          body: { name: "Exposure test", slug: `exposure-${suffix}`, userId: user.user.id },
        }),
      ).pipe(Effect.orDie)
      const apiKey = yield* Effect.tryPromise(() =>
        auth.api.createApiKey({
          body: {
            name: "Exposure test",
            userId: user.user.id,
            permissions: { records: ["read", "write"] },
            metadata: { teamId: team?.id },
          },
        }),
      ).pipe(Effect.orDie)
      return { teamId: team?.id ?? "", key: apiKey.key }
    }),
  )
  key = seeded.key
  teamId = seeded.teamId
  const created = await http("POST", `/api/v1/teams/${teamId}/contacts`, { firstName: "Visible through listing" })
  expect(created.status).toBe(200)
  contactId = (await created.json()).id
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "exposure-test", version: "1.0.0" },
  })
  expect(initialized.result.serverInfo.name).toBe("Parley")
})

afterAll(async () => {
  await dispose()
  await runtime.dispose()
})

describe("entrypoint exposure decisions", () => {
  it("omits an excluded HTTP endpoint from OpenAPI and rejects direct requests", async () => {
    const document = await (await http("GET", "/api/v1/openapi.json")).json()
    expect(document.paths["/api/v1/teams/{teamId}/contacts/{contactId}"]?.get).toBeUndefined()
    const excluded = await http("GET", `/api/v1/teams/${teamId}/contacts/${contactId}`)
    expect(excluded.status).toBe(404)
    const included = await http("GET", `/api/v1/teams/${teamId}/contacts`)
    expect(included.status).toBe(200)
    expect((await included.json()).items).toEqual([expect.objectContaining({ id: contactId })])
  })

  it("omits excluded and analogous MCP names from discovery and rejects direct calls", async () => {
    const listed = await rpc("tools/list", {})
    const names = listed.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).not.toContain("contacts_create")
    expect(names).not.toContain("contacts_get")
    expect(names).toContain("contacts_list")
    for (const [name, args] of [
      ["contacts_create", { teamId, firstName: "Excluded" }],
      ["contacts_get", { teamId, contactId }],
    ] as const) {
      const rejected = await rpc("tools/call", { name, arguments: args })
      expect(rejected.error).toMatchObject({ code: -32602 })
      expect(rejected.result).toBeUndefined()
    }
    const included = await rpc("tools/call", { name: "contacts_list", arguments: { teamId } })
    expect(included.result.isError).not.toBe(true)
    expect(JSON.parse(included.result.content[0].text).items).toEqual([expect.objectContaining({ id: contactId })])
  })
})
