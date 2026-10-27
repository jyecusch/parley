import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import { BetterAuth, CoreLive, Users } from "@parley/core"
import type { UserId } from "@parley/domain"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { ApiRoutesLive, AuthRoutesLive, FailureResponsesLive, FileRoutesLive } from "../src/index.ts"

const AppLive = Layer.mergeAll(ApiRoutesLive, AuthRoutesLive, FileRoutesLive, FailureResponsesLive).pipe(
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
  const userId = signUp.body.user.id as string
  // Signing in needs a confirmed address (D163); the emailed link would confirm it.
  await runtime.runPromise(
    Effect.gen(function* () {
      yield* (yield* Users).markEmailVerified(userId as UserId)
    }),
  )
  const signIn = await call("POST", "/api/auth/sign-in/email", { body: { email, password: "correct-horse-battery" } })
  expect(signIn.status).toBe(200)
  cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
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
    expect(response.body).toEqual([{ id: teamId, name: "Acme", role: "owner", gravatar: false }])
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

  it("asks for a JSON object when the body is missing or isn't one", async () => {
    for (const body of [undefined, "hi"]) {
      const response = await call("POST", `/api/v1/teams/${teamId}/contacts`, body === undefined ? {} : { body })
      expect(response.status).toBe(422)
      expect(response.body.error.userMessage).toBe(
        'The input should be a JSON object of its fields, such as {"firstName": "Ada"}.',
      )
    }
  })

  it("says what the operation takes with every rejected input (D143)", async () => {
    const malformed = await call("POST", `/api/v1/teams/${teamId}/contacts`)
    expect(malformed.body.error.details.expected).toMatchObject({
      operation: "contacts.create",
      method: "POST",
      path: "/api/v1/teams/{teamId}/contacts",
      pathParameters: ["teamId"],
    })
    expect(malformed.body.error.details.expected.body.properties.firstName.anyOf[0].title).toBe("First name")
    // A rejection from the operation itself, not the decoder, says the same.
    const badFilter = await call(
      "GET",
      `/api/v1/teams/${teamId}/contacts?filter=${encodeURIComponent(JSON.stringify({ match: "all", conditions: [{ field: "nope", operator: "is", value: "x" }] }))}`,
    )
    expect(badFilter.status).toBe(422)
    expect(badFilter.body.error.details.expected.operation).toBe("contacts.list")
    expect(badFilter.body.error.details.expected.query.properties.filter).toBeDefined()
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

describe("API keys", () => {
  it("are created by a signed-in user, act within their scopes, and stop working when revoked", async () => {
    const created = await call("POST", `/api/v1/teams/${teamId}/api-keys`, { body: { name: "Claude on my laptop" } })
    expect(created.status).toBe(200)
    expect(created.body.apiKey).toMatchObject({ name: "Claude on my laptop", scopes: ["records:read"], revoked: false })
    expect(created.body.secret).toMatch(/^parley_/)
    const secret = created.body.secret as string

    const listed = await call("GET", `/api/v1/teams/${teamId}/api-keys`)
    expect(listed.body.map((key: { id: string }) => key.id)).toContain(created.body.apiKey.id)
    expect(JSON.stringify(listed.body)).not.toContain(secret)

    const saved = cookie
    cookie = ""
    const asKey = (method: string, path: string, body?: unknown) =>
      call(method, path, { headers: { "x-api-key": secret }, ...(body !== undefined ? { body } : {}) })
    expect((await asKey("GET", `/api/v1/teams/${teamId}/contacts`)).status).toBe(200)
    const mint = await asKey("POST", `/api/v1/teams/${teamId}/api-keys`, { name: "Sneaky" })
    expect(mint.status).toBe(403)
    expect(mint.body.error._tag).toBe("SignInRequired")
    cookie = saved

    const revoked = await call("POST", `/api/v1/teams/${teamId}/api-keys/${created.body.apiKey.id}/revoke`)
    expect(revoked.body.revoked).toBe(true)
    cookie = ""
    const after = await asKey("GET", `/api/v1/teams/${teamId}/contacts`)
    cookie = saved
    expect(after.status).toBe(401)
    expect(after.body.error._tag).toBe("ApiKeyRevoked")
  })

  it("can't grant more than the creator's role, and can't revoke someone else's key", async () => {
    const tooMuch = await call("POST", `/api/v1/teams/${teamId}/api-keys`, {
      body: { name: "Admin key", scopes: ["records:read", "team:manage"] },
    })
    expect(tooMuch.status).toBe(200) // Jane owns Acme, so team:manage is within her role.
    const unknown = await call("POST", `/api/v1/teams/${teamId}/api-keys/not-a-key/revoke`)
    expect(unknown.status).toBe(404)
    expect(unknown.body.error._tag).toBe("ApiKeyNotFound")
  })
})

describe("files", () => {
  it("serves an uploaded avatar to the team, and nothing without a session", async () => {
    const created = await call("POST", `/api/v1/teams/${teamId}/contacts`, { body: { firstName: "Pic" } })
    // A 1x1 PNG.
    const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    const uploaded = await call("POST", `/api/v1/teams/${teamId}/contacts/${created.body.id}/avatar`, {
      body: { image },
    })
    expect(uploaded.status).toBe(200)
    const url = uploaded.body.avatarUrl as string
    const file = await handler(new Request(`${base}${url}`, { headers: { cookie } }))
    expect(file.status).toBe(200)
    expect(file.headers.get("content-type")).toBe("image/webp")
    const saved = cookie
    cookie = ""
    const anonymous = await call("GET", url)
    cookie = saved
    expect(anonymous.status).toBe(401)
    const missing = await call("GET", `/api/files/${teamId}/avatars/nothing.webp`)
    expect(missing.status).toBe(404)
  })
})

describe("email images", () => {
  it("serves an uploaded email image to anyone, cached for good, and 404s unknown ids", async () => {
    // A 1x1 PNG with an alpha channel, so it stays a PNG.
    const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    const uploaded = await call("POST", `/api/v1/teams/${teamId}/email-images`, { body: { image } })
    expect(uploaded.status).toBe(200)
    const path = new URL(uploaded.body.url as string).pathname
    expect(path).toMatch(/^\/i\/[0-9a-f-]{36}$/)
    const file = await handler(new Request(`${base}${path}`))
    expect(file.status).toBe(200)
    expect(file.headers.get("content-type")).toBe("image/png")
    expect(file.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(file.headers.get("x-content-type-options")).toBe("nosniff")
    for (const unknown of [`/i/${crypto.randomUUID()}`, "/i/not-an-id", "/i/..%2F..%2Fapi"]) {
      expect((await handler(new Request(`${base}${unknown}`))).status, unknown).toBe(404)
    }
  })
})

describe("Better-Auth endpoints", () => {
  it("serves only the ones Parley uses", async () => {
    const closed = [
      "/api/auth/organization/list-invitations",
      "/api/auth/organization/get-full-organization",
      "/api/auth/update-user",
      "/api/auth/list-accounts",
      "/api/auth/oauth2/client/rotate-keys",
    ]
    for (const path of closed) expect((await call("GET", path)).status, path).toBe(404)
    expect((await call("GET", "/api/auth/get-session")).status).toBe(200)
  })
})

describe("malformed requests", () => {
  it("answers a body that isn't JSON, or the wrong shape, with 422 rather than a server error", async () => {
    for (const body of ["{not json", JSON.stringify({ emails: "nope" })]) {
      const response = await handler(
        new Request(`${base}/api/v1/teams/${teamId}/contacts`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body,
        }),
      )
      expect(response.status, body).toBe(422)
    }
  })
})

describe("listing over GET (D142)", () => {
  it("takes search, limit, sort and a JSON filter in the query", async () => {
    for (const firstName of ["Gia", "Gus", "Hal"]) {
      await call("POST", `/api/v1/teams/${teamId}/contacts`, {
        body: {
          firstName,
          lastName: suffix,
          emails: [{ address: `${firstName.toLowerCase()}-${suffix}@example.com` }],
        },
      })
    }
    const filter = JSON.stringify({ match: "all", conditions: [{ field: "name", operator: "contains", value: "G" }] })
    const sort = JSON.stringify({ field: "name", direction: "desc" })
    const query = new URLSearchParams({ search: suffix, limit: "1", filter, sort })
    const page = await call("GET", `/api/v1/teams/${teamId}/contacts?${query}`)
    expect(page.status, JSON.stringify(page.body)).toBe(200)
    expect(page.body.total).toBe(2)
    expect(page.body.items.map((contact: { firstName: string }) => contact.firstName)).toEqual(["Gus"])
    const plain = await call("GET", `/api/v1/teams/${teamId}/contacts?search=${suffix}&deleted=false`)
    expect(plain.status, JSON.stringify(plain.body)).toBe(200)
    expect(plain.body.total).toBe(3)
    const bad = await call("GET", `/api/v1/teams/${teamId}/contacts?filter=nope`)
    expect(bad.status).toBe(422)
  })
})
