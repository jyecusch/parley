import { describe, expect, it } from "@effect/vitest"
import { limitBody } from "../src/index.ts"

const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  new Request(`http://parley.test${path}`, { method: "POST", body, headers, duplex: "half" } as RequestInit)

describe("request body limits", () => {
  it("refuses a declared length over the limit before reading anything", () => {
    const body = "x".repeat(2 * 1024 * 1024)
    const result = limitBody(post("/api/v1/teams/t/contacts", body, { "content-length": String(body.length) }))
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(413)
  })

  it("allows images and imports up to their larger limit", () => {
    const result = limitBody(post("/api/v1/teams/t/contacts/c/avatar", "x".repeat(2 * 1024 * 1024)))
    expect(result).toBeInstanceOf(Request)
  })

  it("cuts off a streamed body without a length once it passes the limit", async () => {
    const chunk = new Uint8Array(512 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(chunk)
        controller.close()
      },
    })
    const result = limitBody(post("/api/unsubscribe/x", stream))
    expect(result).toBeInstanceOf(Request)
    await expect((result as Request).text()).rejects.toThrow()
  })

  it("works with server request objects, which can't be copied once their body is read", async () => {
    // Like the server's own request (srvx): it exposes the parts, but isn't a Request to copy from.
    const native = post("/api/auth/sign-in/email", JSON.stringify({ email: "a@b.co" }), {
      "content-type": "application/json",
    })
    const serverRequest = {
      url: native.url,
      method: native.method,
      headers: native.headers,
      signal: native.signal,
      get body() {
        return native.body
      },
    } as unknown as Request
    const result = limitBody(serverRequest)
    expect(result).toBeInstanceOf(Request)
    expect(await (result as Request).json()).toEqual({ email: "a@b.co" })
  })
})
