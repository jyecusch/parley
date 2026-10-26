import { FormRuntime, type SubmissionInput, type Visitor } from "@parley/core"
import { AppearanceOverride, type DatabaseUnavailable } from "@parley/domain"
import { Config, Effect, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

/*
 * The public side of forms (D144): what a form's page asks of the server. Nobody signs in; the
 * form id, the signed render token and the confirmation token are the authority. Called
 * same-origin from the form's own page (inside the iframe), so no CORS.
 *
 *   GET  /api/forms/:formId?page=&appearance=&again=   a published form to show, with a fresh render token
 *   GET  /api/forms/:formId/sites                where it may be framed (null for anywhere)
 *   POST /api/forms/:formId/submissions          a visitor's answers
 *   GET  /api/forms/confirm/:token               the form's look for a confirmation link, confirming nothing
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

const FormPath = Schema.Struct({ formId: Schema.String.check(Schema.isUUID()) })
/**
 * The router's settings. A confirmation link's token (a JWT, about 150 characters) is a path
 * parameter, and the router turns away any longer than 100 by default: the link would 404.
 */
export const ROUTER_CONFIG = { maxParamLength: 2000 } as const

const ConfirmPath = Schema.Struct({ token: Schema.String.check(Schema.isMaxLength(ROUTER_CONFIG.maxParamLength)) })
const RenderQuery = Schema.Struct({
  page: Schema.optional(Schema.String),
  appearance: Schema.optional(Schema.String),
  again: Schema.optional(Schema.String),
})

const invalidBody = () =>
  json({ kind: "invalid", problems: { form: "Something's wrong with this form. Reload the page and try again." } }, 422)

export const FormRoutesLive = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<FormRuntime>()
    const ipHeader = yield* Config.String("IP_ADDRESS_HEADER").pipe(Config.withDefault(""), Effect.orDie)
    const run = <R>(
      effect: Effect.Effect<HttpServerResponse.HttpServerResponse, DatabaseUnavailable, FormRuntime | R>,
    ): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
      effect.pipe(
        Effect.catchTag("DatabaseUnavailable", () => Effect.succeed(unavailable())),
        Effect.provide(services),
      )
    /** The route's form id; a path that isn't one is no form. */
    const formIdOf = HttpRouter.schemaPathParams(FormPath).pipe(
      Effect.map(({ formId }) => formId),
      Effect.option,
    )

    yield* router.add(
      "GET",
      "/api/forms/:formId",
      run(
        Effect.gen(function* () {
          const formId = yield* formIdOf
          if (formId._tag === "None") return notFound()
          const request = yield* HttpServerRequest.HttpServerRequest
          const query = yield* HttpRouter.schemaParams(RenderQuery).pipe(
            Effect.orElseSucceed((): typeof RenderQuery.Type => ({})),
          )
          const appearance = decodeAppearance(query.appearance ?? "")
          const rendered = yield* (yield* FormRuntime).render(formId.value, {
            page: (query.page ?? "").slice(0, 2000),
            appearance: appearance._tag === "Some" ? appearance.value : undefined,
            ip: visitorOf(request, ipHeader).ip,
            countView: query.again !== "1",
          })
          return rendered ? json(rendered) : notFound()
        }),
      ),
    )

    // Where the form may be framed, for the page's frame-ancestors (the server entry asks).
    yield* router.add(
      "GET",
      "/api/forms/:formId/sites",
      run(
        Effect.gen(function* () {
          const formId = yield* formIdOf
          if (formId._tag === "None") return notFound()
          return json({ allowedSites: yield* (yield* FormRuntime).allowedSites(formId.value) })
        }),
      ),
    )

    yield* router.add(
      "GET",
      "/api/forms/confirm/:token",
      run(
        Effect.gen(function* () {
          const path = yield* HttpRouter.schemaPathParams(ConfirmPath).pipe(Effect.option)
          if (path._tag === "None") return notFound()
          const appearance = yield* (yield* FormRuntime).look(path.value.token)
          return appearance ? json({ appearance }) : notFound()
        }),
      ),
    )

    yield* router.add(
      "POST",
      "/api/forms/confirm/:token",
      run(
        Effect.gen(function* () {
          const path = yield* HttpRouter.schemaPathParams(ConfirmPath).pipe(Effect.option)
          if (path._tag === "None") return notFound()
          const request = yield* HttpServerRequest.HttpServerRequest
          const page = yield* (yield* FormRuntime).confirm(path.value.token, visitorOf(request, ipHeader))
          return page.kind === "invalid" ? json(page, 404) : json(page)
        }),
      ),
    )

    yield* router.add(
      "POST",
      "/api/forms/:formId/submissions",
      run(
        Effect.gen(function* () {
          const formId = yield* formIdOf
          if (formId._tag === "None") return notFound()
          const request = yield* HttpServerRequest.HttpServerRequest
          const body = yield* HttpServerRequest.schemaBodyJson(SubmissionBody).pipe(Effect.option)
          if (body._tag === "None") return invalidBody()
          const input: SubmissionInput = {
            renderToken: body.value.renderToken,
            values: body.value.values,
            honeypot: body.value.honeypot ?? "",
            captchaToken: body.value.captchaToken ?? "",
            page: body.value.page ?? "",
            utm: body.value.utm ?? {},
            clickIds: body.value.clickIds ?? {},
          }
          const outcome = yield* (yield* FormRuntime).submit(formId.value, input, visitorOf(request, ipHeader))
          return json(outcome, outcome.kind === "invalid" ? 422 : outcome.kind === "unavailable" ? 404 : 200)
        }),
      ),
    )
  }),
)
