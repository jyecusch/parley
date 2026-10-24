import { describe, expect, it } from "vitest"
import { explainUnmatched, explainUnsupportedBody } from "../src/unmatched.ts"

const ask = (method: string, path: string) => explainUnmatched(new Request(`http://parley${path}`, { method }))

describe("requests no API route took", () => {
  it("names the methods a path takes, for the wrong method", async () => {
    const response = ask("PUT", "/api/v1/teams/t1/contacts")
    expect(response?.status).toBe(405)
    expect(response?.headers.get("allow")).toBe("GET, POST")
    const body = (await response?.json()) as { error: { userMessage: string } }
    expect(body.error.userMessage).toBe("This path takes GET (contacts.list) or POST (contacts.create), not PUT.")
    const expected = (body as unknown as { error: { details: { expected: Array<{ operation: string }> } } }).error
      .details.expected
    expect(expected.map((entry) => entry.operation)).toEqual(["contacts.list", "contacts.create"])
  })

  it("points at the API's description for a path that doesn't exist", async () => {
    const response = ask("GET", "/api/v1/nonsense")
    expect(response?.status).toBe(404)
    const body = (await response?.json()) as { error: { _tag: string; userMessage: string } }
    expect(body.error._tag).toBe("RouteNotFound")
    expect(body.error.userMessage).toContain("/api/v1/openapi.json")
  })

  it("leaves anything outside /api/v1 alone", () => {
    expect(ask("GET", "/t/team/contacts")).toBeUndefined()
  })
})

describe("bodies the API can't read", () => {
  it("says to send JSON, in the API's own error", async () => {
    const response = explainUnsupportedBody(
      new Request("http://parley/api/v1/teams/t1/contacts", {
        method: "POST",
        headers: { "content-type": "text/plain" },
      }),
    )
    expect(response.status).toBe(415)
    const body = (await response.json()) as { error: { _tag: string; userMessage: string } }
    expect(body.error._tag).toBe("UnsupportedMediaType")
    expect(body.error.userMessage).toContain("not text/plain")
  })
})
