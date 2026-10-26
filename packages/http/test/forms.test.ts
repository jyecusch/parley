import { FormRuntime, type RenderContext, type SubmissionInput, type Visitor } from "@parley/core"
import { DEFAULT_APPEARANCE, type FormContent, type FormId } from "@parley/domain"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { afterAll, describe, expect, it } from "vitest"
import { FormRoutesLive, ROUTER_CONFIG } from "../src/forms.ts"

const FORM = "11111111-2222-4333-8444-555555555555"
const content: FormContent = {
  title: "Join",
  description: "",
  submitLabel: "Join",
  finePrint: "",
  fields: [{ kind: "contact", field: "email", label: "Email", required: true }],
  afterSubmit: { kind: "message", title: "Check your inbox", body: "Click the link we sent." },
  doubleOptIn: true,
  senderId: null,
  segmentId: null,
  set: {},
  captureTracking: true,
  appearance: DEFAULT_APPEARANCE,
}

/** A FormRuntime that records what the routes pass it. */
const seen: { render?: RenderContext; submit?: SubmissionInput; visitor?: Visitor; confirm?: string } = {}
/** As long as a real confirmation token, with its dots. */
const JWT_LENGTH = `eyJhbGciOiJIUzI1NiJ9.${"x".repeat(110)}.${"y".repeat(43)}`

const FakeRuntime = Layer.succeed(FormRuntime, {
  render: (formId, context) =>
    Effect.sync(() => {
      seen.render = context
      return formId === FORM
        ? {
            formId: formId as FormId,
            version: 1,
            content,
            customFields: [],
            privacyPolicyUrl: null,
            renderToken: "token",
            captcha: { provider: "turnstile", siteKey: "site", mode: "invisible" },
          }
        : undefined
    }),
  allowedSites: () => Effect.succeed(["nitric.io"]),
  submit: (_formId, input, visitor) =>
    Effect.sync(() => {
      seen.submit = input
      seen.visitor = visitor
      return input.values.email === "bad"
        ? { kind: "invalid", problems: { email: "Enter an email address like you@example.com." } }
        : { kind: "accepted", afterSubmit: content.afterSubmit, confirmByEmail: true }
    }),
  look: (token) => Effect.succeed(token === "good" ? content.appearance : undefined),
  confirm: (token) =>
    Effect.sync(() => {
      seen.confirm = token
      return token === "good" || token === JWT_LENGTH
        ? { kind: "confirmed", content, privacyPolicyUrl: null }
        : { kind: "invalid" }
    }),
})

const { handler, dispose } = HttpRouter.toWebHandler(
  FormRoutesLive.pipe(Layer.provide(FakeRuntime), Layer.provide(HttpServer.layerServices)),
  { disableLogger: true, routerConfig: ROUTER_CONFIG },
)
afterAll(() => dispose())

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const response = await handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )
  return { status: response.status, headers: response.headers, body: await response.json() }
}

describe("public form routes (D144)", () => {
  it("serves a published form, never cached, with the page and valid appearance overrides", async () => {
    const appearance = JSON.stringify({
      colorMode: "light-dark",
      darkColors: { accent: "#0a7a5c", background: "transparent" },
    })
    const response = await call(
      "GET",
      `/api/forms/${FORM}?page=${encodeURIComponent("https://nitric.io/blog")}&appearance=${encodeURIComponent(appearance)}`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.body.renderToken).toBe("token")
    expect(seen.render).toMatchObject({ page: "https://nitric.io/blog", appearance: JSON.parse(appearance) })
    expect(typeof seen.render?.ip).toBe("string")

    await call("GET", `/api/forms/${FORM}?appearance=${encodeURIComponent('{"colorMode":"neon"}')}`)
    expect(seen.render?.appearance).toBeUndefined()
  })

  it("answers 404 for unknown and malformed forms", async () => {
    expect((await call("GET", "/api/forms/22222222-2222-4333-8444-555555555555")).status).toBe(404)
    expect((await call("GET", "/api/forms/not-a-form")).status).toBe(404)
  })

  it("says where a form may be framed", async () => {
    expect((await call("GET", `/api/forms/${FORM}/sites`)).body).toEqual({ allowedSites: ["nitric.io"] })
  })

  it("takes a submission with the visitor's address and agent", async () => {
    const response = await call(
      "POST",
      `/api/forms/${FORM}/submissions`,
      {
        renderToken: "token",
        values: { email: "ada@example.com" },
        honeypot: "",
        captchaToken: "cf",
        utm: { utm_source: "x" },
        clickIds: { gclid: "g" },
      },
      { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "Test" },
    )
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ kind: "accepted", confirmByEmail: true })
    expect(seen.visitor).toEqual({ ip: "203.0.113.9", userAgent: "Test" })
    expect(seen.submit).toMatchObject({
      captchaToken: "cf",
      utm: { utm_source: "x" },
      clickIds: { gclid: "g" },
      page: "",
    })
  })

  it("reports problems with the answers as 422, and a malformed body without reaching the runtime", async () => {
    const invalid = await call("POST", `/api/forms/${FORM}/submissions`, { renderToken: "t", values: { email: "bad" } })
    expect(invalid.status).toBe(422)
    expect(invalid.body.problems.email).toBeDefined()
    const malformed = await call("POST", `/api/forms/${FORM}/submissions`, { values: "nope" })
    expect(malformed.status).toBe(422)
    expect(malformed.body.problems.form).toBeDefined()
  })

  it("confirms with a POST, and 404s a bad token", async () => {
    // The page asks for the form's look first; that confirms nothing.
    delete seen.confirm
    const look = await call("GET", "/api/forms/confirm/good")
    expect(look).toMatchObject({ status: 200, body: { appearance: { colorMode: "fixed" } } })
    expect(seen.confirm).toBeUndefined()
    expect((await call("GET", "/api/forms/confirm/nope")).status).toBe(404)
    const good = await call("POST", "/api/forms/confirm/good")
    expect(good.body).toMatchObject({ kind: "confirmed" })
    // A real link's token is a JWT, longer than the router's default limit of 100 for a parameter.
    const long = await call("POST", `/api/forms/confirm/${JWT_LENGTH}`)
    expect(long).toMatchObject({ status: 200, body: { kind: "confirmed" } })
    expect((await call("POST", "/api/forms/confirm/nope")).status).toBe(404)
  })
})
