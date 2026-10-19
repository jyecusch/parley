import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import { BetterAuth, CoreLive } from "@parley/core"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { ApiRoutesLive, AuthRoutesLive, FailureResponsesLive } from "../src/index.ts"

const AppLive = Layer.mergeAll(ApiRoutesLive, AuthRoutesLive, FailureResponsesLive).pipe(
  Layer.provide(CoreLive),
  Layer.provide(HttpServer.layerServices),
)
const { handler, dispose } = HttpRouter.toWebHandler(AppLive, { disableLogger: true })
const runtime = ManagedRuntime.make(CoreLive)

const base = "http://localhost:3000"
const suffix = crypto.randomUUID().slice(0, 8)
const email = `jane-${suffix}@example.com`
let cookie = ""
let teamId = ""
let readOnlyKey = ""

const call = async (method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) => {
  const response = await handler(
    new Request(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...init.headers },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }),
  )
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : undefined, headers: response.headers }
}

beforeAll(async () => {
  const signUp = await call("POST", "/api/auth/sign-up/email", {
    body: { name: "Jane Doe", email, password: "correct-horse-battery" },
  })
  expect(signUp.status).toBe(200)
  cookie = (signUp.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
  const userId = signUp.body.user.id as string
  const seeded = await runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* BetterAuth
      const team = yield* Effect.tryPromise(() =>
        auth.api.createOrganization({ body: { name: "Acme", slug: `acme-${suffix}`, userId } }),
      ).pipe(Effect.orDie)
      const key = yield* Effect.tryPromise(() =>
        auth.api.createApiKey({
          body: {
            name: "Claude on my laptop",
            userId,
            permissions: { records: ["read"] },
            metadata: { teamId: team?.id },
          },
        }),
      ).pipe(Effect.orDie)
      return { teamId: team?.id ?? "", key: key.key }
    }),
  )
  teamId = seeded.teamId
  readOnlyKey = seeded.key
})

afterAll(async () => {
  await dispose()
  await runtime.dispose()
})

describe("HTTP entrypoint", () => {
  it("lists the signed-in user's teams", async () => {
    const response = await call("GET", "/api/v1/teams")
    expect(response.status).toBe(200)
    expect(response.body).toEqual([{ id: teamId, name: "Acme", role: "owner" }])
  })

  it("creates and conflicts on email, with the agreed wire shape", async () => {
    const created = await call("POST", `/api/v1/teams/${teamId}/contacts`, {
      body: { firstName: "Sam", emails: [{ address: "sam@northwind.io" }] },
    })
    expect(created.status).toBe(200)
    expect(created.body.displayName).toBe("Sam")

    const conflict = await call("POST", `/api/v1/teams/${teamId}/contacts`, {
      body: { emails: [{ address: "sam@northwind.io" }] },
    })
    expect(conflict.status).toBe(409)
    expect(conflict.body).toEqual({
      _tag: "Conflict",
      error: {
        _tag: "ContactEmailTaken",
        userMessage:
          "sam@northwind.io is already used by Sam in Acme. Open Sam to update it there, or use a different email.",
        isRetryable: false,
        details: { existing: created.body.id },
      },
    })
  })

  it("answers invalid input with 422 InputRejected, field by field", async () => {
    const response = await call("POST", `/api/v1/teams/${teamId}/contacts`, {
      body: { firstName: "Sam", emails: [{ address: "nope" }] },
    })
    expect(response.status).toBe(422)
    expect(response.body.error._tag).toBe("InputRejected")
    expect(response.body.error.details.problems).toEqual([
      { field: "emails.0.address", problem: "invalid-format", userMessage: "Email isn't in a valid format." },
    ])
  })

  it("answers an unknown team with 404 NotATeamMember, and no session with 401", async () => {
    const other = await call("GET", "/api/v1/teams/not-a-team/contacts")
    expect(other.status).toBe(404)
    expect(other.body.error._tag).toBe("NotATeamMember")
    const saved = cookie
    cookie = ""
    const anonymous = await call("GET", "/api/v1/teams")
    cookie = saved
    expect(anonymous.status).toBe(401)
    expect(anonymous.body.error._tag).toBe("SessionMissing")
  })

  it("lets an API key read but not write, as its scopes say", async () => {
    const saved = cookie
    cookie = ""
    const read = await call("GET", `/api/v1/teams/${teamId}/contacts`, { headers: { "x-api-key": readOnlyKey } })
    const write = await call("POST", `/api/v1/teams/${teamId}/contacts`, {
      headers: { authorization: `Bearer ${readOnlyKey}` },
      body: { firstName: "Agent" },
    })
    const bogus = await call("GET", "/api/v1/teams", { headers: { "x-api-key": "parley_nope" } })
    cookie = saved
    expect(read.status).toBe(200)
    expect(write.status).toBe(403)
    expect(write.body.error).toMatchObject({ _tag: "ApiKeyScopeExcludes", details: { needed: "records:write" } })
    expect(bogus.status).toBe(401)
    expect(bogus.body.error._tag).toBe("ApiKeyUnrecognized")
  })

  it("serves an OpenAPI document generated from the operations", async () => {
    const response = await call("GET", "/api/v1/openapi.json")
    expect(response.status).toBe(200)
    expect(Object.keys(response.body.paths)).toContain("/api/v1/teams/{teamId}/contacts/{contactId}")
  })
})
