import { FormRuntime, type SubmissionInput, type Visitor } from "@parley/core"
import { AppearanceOverride, type DatabaseUnavailable, isUuid } from "@parley/domain"
import { Config, Effect, Schema } from "effect"
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http"

/*
 * The public side of forms (D144): what a form's page asks of the server. Nobody signs in; the
 * form id, the signed render token and the confirmation token are the authority. Called
 * same-origin from the form's own page (inside the iframe), so no CORS.
 *
 *   GET  /api/forms/:formId?page=&appearance=&again=   a published form to show, with a fresh render token
 *   GET  /api/forms/:formId/sites                where it may be framed (null for anywhere)
 *   POST /api/forms/:formId/submissions          a visitor's answers
 *   POST /api/forms/confirm/:token               the confirmation link's click (D146)
 *
 * Confirming is a POST, made by the confirmation page's script: email link scanners open links
 * (a GET) but don't run pages, so a scanner can't confirm on someone's behalf.
 */

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" }

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status, headers: NO_STORE })

const notFound = () =>
  json(
    {
      _tag: "NotFound",
      error: { _tag: "FormNotFound", userMessage: "This form isn't available.", isRetryable: false },
    },
    404,
  )

const unavailable = () =>
  json(
    {
      _tag: "ServiceUnavailable",
      error: {
        _tag: "DatabaseUnavailable",
        userMessage: "Something went wrong on our side. Try again in a minute.",
        isRetryable: true,
      },
    },
    503,
  )

/** The appearance overrides in a query parameter, if they're a valid override (D148). */
const decodeAppearance = Schema.decodeUnknownOption(Schema.fromJsonString(AppearanceOverride))

const SubmissionBody = Schema.Struct({
  renderToken: Schema.String.check(Schema.isMaxLength(2000)),
  values: Schema.Record(Schema.String, Schema.Unknown),
  honeypot: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  captchaToken: Schema.optional(Schema.String.check(Schema.isMaxLength(10_000))),
  page: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
  utm: Schema.optional(Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(500)))),
  clickIds: Schema.optional(Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(500)))),
})
const decodeSubmission = Schema.decodeUnknownOption(SubmissionBody)

/**
 * Who sent the request. With IP_ADDRESS_HEADER set (production, behind a proxy), only that header
 * counts: anything else is the visitor's own say-so, and a forged address could spend someone
 * else's limits. Without it (development), the usual forwarding headers.
 */
const visitorOf = (request: HttpServerRequest.HttpServerRequest, ipHeader: string): Visitor => {
  const header = (name: string) => {
    const value = request.headers[name]
    return typeof value === "string" ? value : undefined
  }
  const ip = ipHeader
    ? header(ipHeader.toLowerCase())
    : (header("x-forwarded-for")?.split(",")[0]?.trim() ?? header("x-real-ip"))
  return { ip: (ip || "unknown").slice(0, 100), userAgent: (header("user-agent") ?? "").slice(0, 500) }
}

const pathOf = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.url, "http://parley").pathname
    .replace(/^\/api\/forms\//, "")
    .split("/")
    .map(decodeURIComponent)

export const FormRoutesLive = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<FormRuntime>()
    const ipHeader = yield* Config.String("IP_ADDRESS_HEADER").pipe(Config.withDefault(""), Effect.orDie)
    const run = (
      effect: Effect.Effect<HttpServerResponse.HttpServerResponse, DatabaseUnavailable, FormRuntime>,
    ): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
      effect.pipe(
        Effect.catchTag("DatabaseUnavailable", () => Effect.succeed(unavailable())),
        Effect.provide(services),
      )

    yield* router.add("GET", "/api/forms/*", (request) =>
      run(
        Effect.gen(function* () {
          const [formId, ...rest] = pathOf(request)
          if (!formId || !isUuid(formId)) return notFound()
          const runtimeForSites = yield* FormRuntime
          // Where the form may be framed, for the page's frame-ancestors (the server entry asks).
          if (rest.length === 1 && rest[0] === "sites") {
            return json({ allowedSites: yield* runtimeForSites.allowedSites(formId) })
          }
          if (rest.length > 0) return notFound()
          const query = new URL(request.url, "http://parley").searchParams
          const appearance = decodeAppearance(query.get("appearance") ?? "")
          const runtime = yield* FormRuntime
          const rendered = yield* runtime.render(formId, {
            page: (query.get("page") ?? "").slice(0, 2000),
            appearance: appearance._tag === "Some" ? appearance.value : undefined,
            ip: visitorOf(request, ipHeader).ip,
            countView: query.get("again") !== "1",
          })
          return rendered ? json(rendered) : notFound()
        }),
      ),
    )

    yield* router.add("POST", "/api/forms/*", (request) =>
      run(
        Effect.gen(function* () {
          const [first, second, ...rest] = pathOf(request)
          if (rest.length > 0 || !first || !second) return notFound()
          const runtime = yield* FormRuntime
          const visitor = visitorOf(request, ipHeader)
          if (first === "confirm") {
            const page = yield* runtime.confirm(second, visitor)
            return page.kind === "invalid" ? json(page, 404) : json(page)
          }
          if (second !== "submissions" || !isUuid(first)) return notFound()
          const body = yield* request.json.pipe(Effect.orElseSucceed(() => null))
          const decoded = decodeSubmission(body)
          if (decoded._tag === "None") {
            return json(
              {
                kind: "invalid",
                problems: { form: "Something's wrong with this form. Reload the page and try again." },
              },
              422,
            )
          }
          const input: SubmissionInput = {
            renderToken: decoded.value.renderToken,
            values: decoded.value.values,
            honeypot: decoded.value.honeypot ?? "",
            captchaToken: decoded.value.captchaToken ?? "",
            page: decoded.value.page ?? "",
            utm: decoded.value.utm ?? {},
            clickIds: decoded.value.clickIds ?? {},
          }
          const outcome = yield* runtime.submit(first, input, visitor)
          return json(outcome, outcome.kind === "invalid" ? 422 : outcome.kind === "unavailable" ? 404 : 200)
        }),
      ),
    )
  }),
)
