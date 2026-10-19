import { PublicError } from "@parley/errors"
import { Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"
import type { Status } from "./status.ts"

/** Every error response body: `{ "_tag": "<status name>", "error": PublicError }`. */
const body = <const Tag extends string>(tag: Tag, status: number) =>
  Schema.TaggedStruct(tag, { error: PublicError }).pipe(HttpApiSchema.status(status))

export const Unauthorized = body("Unauthorized", 401)
export const Forbidden = body("Forbidden", 403)
export const NotFound = body("NotFound", 404)
export const Conflict = body("Conflict", 409)
export const Gone = body("Gone", 410)
export const UnprocessableEntity = body("UnprocessableEntity", 422)
export const TooManyRequests = body("TooManyRequests", 429)
export const InternalError = body("InternalError", 500)
export const BadGateway = body("BadGateway", 502)
export const ServiceUnavailable = body("ServiceUnavailable", 503)

export const ErrorBodies = [
  Unauthorized,
  Forbidden,
  NotFound,
  Conflict,
  Gone,
  UnprocessableEntity,
  TooManyRequests,
  InternalError,
  BadGateway,
  ServiceUnavailable,
] as const

export const BODY_TAG: { readonly [S in Status | 500]: (typeof ErrorBodies)[number]["Type"]["_tag"] } = {
  401: "Unauthorized",
  403: "Forbidden",
  404: "NotFound",
  409: "Conflict",
  410: "Gone",
  422: "UnprocessableEntity",
  429: "TooManyRequests",
  500: "InternalError",
  502: "BadGateway",
  503: "ServiceUnavailable",
}
