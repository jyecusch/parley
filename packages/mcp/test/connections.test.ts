import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import { BetterAuth, CoreLive } from "@parley/core"
import { ApiRoutesLive, AuthRoutesLive, FailureResponsesLive } from "@parley/http"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { McpRoutesLive } from "../src/index.ts"

// The whole OAuth journey an agent such as Claude takes: discover, register, sign in, consent, call tools.
const AppLive = Layer.mergeAll(ApiRoutesLive, AuthRoutesLive, FailureResponsesLive, McpRoutesLive).pipe(
  Layer.provide(CoreLive),
  Layer.provide(HttpServer.layerServices),
)
const { handler, dispose } = HttpRouter.toWebHandler(AppLive, { disableLogger: true })
const runtime = ManagedRuntime.make(CoreLive)

const base = "http://localhost:3000"
const redirectUri = "http://127.0.0.1:33418/callback"
const suffix = crypto.randomUUID().slice(0, 8)
let cookie = ""
let teamId = ""
let clientId = ""

const send = async (
  method: string,
  path: string,
  init: { json?: unknown; form?: Record<string, string>; headers?: Record<string, string>; asUser?: boolean } = {},
) => {
  const headers: Record<string, string> = { ...init.headers }
  if (init.asUser !== false && cookie) headers.cookie = cookie
  let body: string | undefined
  if (init.json !== undefined) {
    headers["content-type"] = "application/json"
    body = JSON.stringify(init.json)
  } else if (init.form) {
    headers["content-type"] = "application/x-www-form-urlencoded"
    body = new URLSearchParams(init.form).toString()
  }
  const response = await handler(
    new Request(`${base}${path}`, { method, headers, redirect: "manual", ...(body ? { body } : {}) }),
  )
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {}
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally
  return { status: response.status, body: parsed as any, headers: response.headers }
}

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url")

/** Steps an agent takes up to the consent page. Returns the consent page's query and the PKCE verifier. */
const startSignIn = async () => {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  const authorize = await send(
    "GET",
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid offline_access",
      state: "s1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: `${base}/mcp`,
    })}`,
  )
  expect(authorize.status).toBe(302)
  const location = new URL(authorize.headers.get("location") ?? "", base)
  expect(location.pathname).toBe("/connect")
  return { request: location.search.slice(1), verifier }
}

/** Consent, then exchange the code for tokens, as the agent would. */
const finishSignIn = async (request: string, verifier: string) => {
  const consent = await send("POST", "/api/auth/oauth2/consent", { json: { accept: true, oauth_query: request } })
  expect(consent.status).toBe(200)
  const callback = new URL(consent.body.url)
  expect(callback.origin + callback.pathname).toBe(redirectUri)
  const token = await send("POST", "/api/auth/oauth2/token", {
    asUser: false,
    form: {
      grant_type: "authorization_code",
      code: callback.searchParams.get("code") ?? "",
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${base}/mcp`,
    },
  })
  expect(token.status).toBe(200)
  return token.body as { access_token: string; refresh_token?: string }
}

let nextId = 1
/** MCP sessions, one per access token, as each agent would have its own. */
const sessions = new Map<string, string>()
const mcp = async (token: string | undefined, method: string, params?: unknown): Promise<McpResponse> => {
  if (token && !sessions.has(token) && method !== "initialize") {
    const init = await mcp(token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "Claude", version: "1.0.0" },
    })
    if (init.status !== 200) return init
  }
  const session = token ? sessions.get(token) : undefined
  const response = await handler(
    new Request(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, id: nextId++, ...(params ? { params } : {}) }),
    }),
  )
  const started = response.headers.get("mcp-session-id")
  if (token && started) sessions.set(token, started)
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
  return { status: response.status, json, headers: response.headers }
}

// biome-ignore lint/suspicious/noExplicitAny: JSON-RPC bodies are inspected structurally
type McpResponse = { status: number; json: any; headers: Headers }

const callTool = async (token: string, name: string, args: unknown) => {
  const { json } = await mcp(token, "tools/call", { name, arguments: args })
  return { isError: json.result.isError === true, value: JSON.parse(json.result.content[0].text) }
}

beforeAll(async () => {
  const signUp = await send("POST", "/api/auth/sign-up/email", {
    json: { name: "Jane Doe", email: `jane-oauth-${suffix}@example.com`, password: "correct-horse-battery" },
  })
  expect(signUp.status).toBe(200)
  cookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
  const userId = signUp.body.user.id as string
  teamId = await runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* BetterAuth
      const team = yield* Effect.tryPromise(() =>
        auth.api.createOrganization({ body: { name: "Acme", slug: `acme-oauth-${suffix}`, userId } }),
      ).pipe(Effect.orDie)
      return team?.id ?? ""
    }),
  )
  const registered = await send("POST", "/api/auth/oauth2/register", {
    asUser: false,
    json: {
      client_name: "Claude",
      application_type: "native",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  })
  expect(registered.status).toBe(201)
  clientId = registered.body.client_id
})

afterAll(async () => {
  await dispose()
  await runtime.dispose()
})

describe("connecting an agent over OAuth", () => {
  it("challenges an unauthenticated agent and serves discovery metadata", async () => {
    const challenged = await mcp(undefined, "tools/list")
    expect(challenged.status).toBe(401)
    expect(challenged.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
    )
    const resource = await send("GET", "/.well-known/oauth-protected-resource/mcp", { asUser: false })
    expect(resource.status).toBe(200)
    expect(resource.body.resource).toBe(`${base}/mcp`)
    const server = await send("GET", "/.well-known/oauth-authorization-server/api/auth", { asUser: false })
    expect(server.status).toBe(200)
    expect(server.body.authorization_endpoint).toBe(`${base}/api/auth/oauth2/authorize`)
  })

  it("refuses consent that doesn't go through the consent page", async () => {
    const { request } = await startSignIn()
    const consent = await send("POST", "/api/auth/oauth2/consent", { json: { accept: true, oauth_query: request } })
    expect(consent.status).toBe(403)
  })

  it("acts as you, within the connection's scopes, and stops when revoked", async () => {
    const { request, verifier } = await startSignIn()
    const created = await send("POST", `/api/v1/teams/${teamId}/connections`, { json: { request } })
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({
      name: "Claude",
      actsAs: { name: "Jane Doe", kind: "user" },
      scopes: ["records:read"],
      authorizedAt: null,
      revoked: false,
    })
    const tokens = await finishSignIn(request, verifier)

    expect((await callTool(tokens.access_token, "teams_list", {})).value).toEqual([
      { id: teamId, name: "Acme", role: "owner" },
    ])
    expect((await callTool(tokens.access_token, "contacts_list", { teamId })).isError).toBe(false)
    const denied = await callTool(tokens.access_token, "contacts_create", { teamId, firstName: "Sam" })
    expect(denied).toMatchObject({ isError: true, value: { _tag: "ConnectionScopeExcludes" } })
    // An agent can't connect more agents.
    const minted = await callTool(tokens.access_token, "connections_create", { teamId, request })
    expect(minted.value._tag).toBe("SignInRequired")

    const listed = await send("GET", `/api/v1/teams/${teamId}/connections`)
    const connection = listed.body.find((row: { id: string }) => row.id === created.body.id)
    expect(connection.authorizedAt).not.toBeNull()
    expect(connection.lastUsedAt).not.toBeNull()

    const revoked = await send("POST", `/api/v1/teams/${teamId}/connections/${created.body.id}/revoke`)
    expect(revoked.body.revoked).toBe(true)
    const after = await mcp(tokens.access_token, "tools/list")
    expect(after.status).toBe(401)
    expect(after.json.error._tag).toBe("ConnectionRevoked")
  })

  it("acts as a service account, attributed in activity via the connection", async () => {
    const serviceAccount = await send("POST", `/api/v1/teams/${teamId}/service-accounts`, {
      json: { name: "Sync bot" },
    })
    expect(serviceAccount.status).toBe(200)
    expect(serviceAccount.body).toMatchObject({ name: "Sync bot", role: "member" })

    const { request, verifier } = await startSignIn()
    const beyondRole = await send("POST", `/api/v1/teams/${teamId}/connections`, {
      json: { request, actsAs: serviceAccount.body.id, scopes: ["records:read", "fields:manage"] },
    })
    expect(beyondRole.status).toBe(403)
    expect(beyondRole.body.error._tag).toBe("ServiceAccountRoleLacksPermission")

    const created = await send("POST", `/api/v1/teams/${teamId}/connections`, {
      json: { request, actsAs: serviceAccount.body.id, scopes: ["records:read", "records:write"] },
    })
    expect(created.status).toBe(200)
    expect(created.body.actsAs).toMatchObject({ name: "Sync bot", kind: "service-account" })
    const tokens = await finishSignIn(request, verifier)

    const contact = await callTool(tokens.access_token, "contacts_create", { teamId, firstName: "Ana" })
    expect(contact.isError).toBe(false)
    const activity = await send("GET", `/api/v1/teams/${teamId}/contacts/${contact.value.id}/activity`)
    expect(activity.body[0]).toMatchObject({ actorName: "Sync bot", via: "Claude", kind: "created" })
  })

  it("rejects an access token on the HTTP API, where only API keys and sessions work", async () => {
    const { request, verifier } = await startSignIn()
    await send("POST", `/api/v1/teams/${teamId}/connections`, { json: { request } })
    const tokens = await finishSignIn(request, verifier)
    const response = await send("GET", "/api/v1/teams", {
      asUser: false,
      headers: { authorization: `Bearer ${tokens.access_token}` },
    })
    expect(response.status).toBe(401)
    expect(response.body.error._tag).toBe("AccessTokenUnrecognized")
  })
})
