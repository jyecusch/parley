import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import { BetterAuth, CoreLive } from "@parley/core"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { McpRoutesLive } from "../src/index.ts"

const AppLive = McpRoutesLive.pipe(Layer.provide(CoreLive), Layer.provide(HttpServer.layerServices))
const { handler, dispose } = HttpRouter.toWebHandler(AppLive, { disableLogger: true })
const runtime = ManagedRuntime.make(CoreLive)

const suffix = crypto.randomUUID().slice(0, 8)
let teamId = ""
let writeKey = ""
let readKey = ""
let sessionId: string | undefined

let nextId = 1
const rpc = async (key: string | undefined, method: string, params?: unknown, notification = false) => {
  const response = await handler(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(key ? { "x-api-key": key } : {}),
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        ...(params ? { params } : {}),
        ...(notification ? {} : { id: nextId++ }),
      }),
    }),
  )
  sessionId = response.headers.get("mcp-session-id") ?? sessionId
  const text = await response.text()
  const json = response.headers.get("content-type")?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5)))
        .at(-1)
    : text
      ? JSON.parse(text)
      : undefined
  return { status: response.status, json }
}

const callTool = async (key: string, name: string, args: unknown) => {
  const { json } = await rpc(key, "tools/call", { name, arguments: args })
  const content = json.result.content[0].text
  return { isError: json.result.isError === true, value: JSON.parse(content) }
}

beforeAll(async () => {
  const seeded = await runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* BetterAuth
      const tryPromise = <A>(thunk: () => Promise<A>) => Effect.tryPromise(thunk).pipe(Effect.orDie)
      const user = yield* tryPromise(() =>
        auth.api.signUpEmail({
          body: { name: "Jane Doe", email: `jane-mcp-${suffix}@example.com`, password: "correct-horse-battery" },
        }),
      )
      const team = yield* tryPromise(() =>
        auth.api.createOrganization({ body: { name: "Acme", slug: `acme-mcp-${suffix}`, userId: user.user.id } }),
      )
      const key = (permissions: Record<string, Array<string>>) =>
        tryPromise(() =>
          auth.api.createApiKey({
            body: { name: "Claude on my laptop", userId: user.user.id, permissions, metadata: { teamId: team?.id } },
          }),
        )
      const write = yield* key({ records: ["read", "write"] })
      const read = yield* key({ records: ["read"] })
      return { teamId: team?.id ?? "", write: write.key, read: read.key }
    }),
  )
  teamId = seeded.teamId
  writeKey = seeded.write
  readKey = seeded.read
  const init = await rpc(writeKey, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  })
  expect(init.json.result.serverInfo.name).toBe("Parley")
  await rpc(writeKey, "notifications/initialized", undefined, true)
})

afterAll(async () => {
  await dispose()
  await runtime.dispose()
})

describe("MCP entrypoint", () => {
  it("exposes every operation as a tool with its description and hints", async () => {
    const { json } = await rpc(writeKey, "tools/list")
    const tools = json.result.tools as Array<{
      name: string
      description: string
      annotations: { readOnlyHint: boolean }
    }>
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "apiKeys_create",
      "apiKeys_list",
      "apiKeys_revoke",
      "connections_create",
      "connections_list",
      "connections_revoke",
      "contacts_activity",
      "contacts_create",
      "contacts_delete",
      "contacts_get",
      "contacts_list",
      "contacts_restore",
      "contacts_update",
      "serviceAccounts_create",
      "serviceAccounts_list",
      "teams_create",
      "teams_list",
    ])
    expect(tools.find((tool) => tool.name === "contacts_list")?.annotations.readOnlyHint).toBe(true)
  })

  it("runs operations as the API key's user", async () => {
    const teams = await callTool(writeKey, "teams_list", {})
    expect(teams.value).toEqual([{ id: teamId, name: "Acme", role: "owner" }])
    const created = await callTool(writeKey, "contacts_create", {
      teamId,
      firstName: "Sam",
      emails: [{ address: "sam@northwind.io" }],
    })
    expect(created.isError).toBe(false)
    expect(created.value.displayName).toBe("Sam")
    const activity = await callTool(writeKey, "contacts_activity", { teamId, contactId: created.value.id })
    expect(activity.value[0]).toMatchObject({ kind: "created", actorName: "Jane Doe", via: "Claude on my laptop" })
  })

  it("returns errors as data agents can branch on", async () => {
    const denied = await callTool(readKey, "contacts_create", { teamId, firstName: "Nope" })
    expect(denied.isError).toBe(true)
    expect(denied.value).toMatchObject({
      _tag: "ApiKeyScopeExcludes",
      isRetryable: false,
      details: { needed: "records:write" },
    })
    const invalid = await callTool(writeKey, "contacts_create", { teamId, emails: [{ address: "nope" }] })
    expect(invalid.value).toMatchObject({
      _tag: "InputRejected",
      details: { problems: [{ field: "emails.0.address", problem: "invalid-format" }] },
    })
  })

  it("refuses requests without a valid API key", async () => {
    const anonymous = await rpc(undefined, "tools/list")
    expect(anonymous.status).toBe(401)
    expect(anonymous.json.error._tag).toBe("SessionMissing")
    const bogus = await rpc("parley_nope", "tools/list")
    expect(bogus.status).toBe(401)
    expect(bogus.json.error._tag).toBe("ApiKeyUnrecognized")
  })
})
