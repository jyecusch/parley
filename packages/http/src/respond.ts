import { type AnyOperationError, BODY_TAG, detailsOf, ERROR_STATUS, expectedInputOf, operationFor } from "@parley/api"
import { classifyDecodeError } from "@parley/core"
import type { OperationName } from "@parley/domain"
import { defectPublicError, ReferenceId, toPublicError } from "@parley/errors"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiError } from "effect/http-api"

/**
 * The error body for a domain error, by its exhaustively mapped status. Rejected input also says
 * what the operation takes (D143), when the operation is known.
 */
export const errorBody = (error: AnyOperationError, operation?: OperationName) => {
  const status = ERROR_STATUS[error._tag]
  const details = detailsOf(error)
  const expected = error._tag === "InputRejected" && operation ? { expected: expectedInputOf(operation) } : {}
  return {
    _tag: BODY_TAG[status],
    error: toPublicError(
      error,
      details === undefined && !expected.expected ? undefined : { ...(details as object), ...expected },
    ),
  }
}

const errorResponse = (error: AnyOperationError, operation?: OperationName) =>
  HttpServerResponse.jsonUnsafe(errorBody(error, operation), { status: ERROR_STATUS[error._tag] })

/**
 * Wraps the whole HTTP app. Decode failures become InputRejected (422) in our own words;
 * defects are logged in full under a reference id and answered with a fixed message (D46).
 */
export const respondToFailures = <E, R>(
  app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R> =>
  app.pipe(
    Effect.catchCause((cause) => {
      // HttpApi raises request decode failures as defects; they're the caller's input, not our bug.
      const decodeFailure = cause.reasons
        .map((reason) =>
          Cause.isFailReason(reason) ? reason.error : Cause.isDieReason(reason) ? reason.defect : undefined,
        )
        .find((value) => HttpApiError.HttpApiSchemaError.is(value))
      if (decodeFailure && decodeFailure.kind !== "Body" && decodeFailure.kind !== "ResponseHeaders") {
        return Effect.map(Effect.serviceOption(HttpServerRequest.HttpServerRequest), (request) => {
          const operation =
            request._tag === "Some"
              ? operationFor(request.value.method, new URL(request.value.url, "http://parley").pathname)
              : undefined
          return errorResponse(classifyDecodeError(decodeFailure.cause), operation)
        })
      }
      if (Cause.hasDies(cause)) {
        const referenceId = ReferenceId.make()
        return Effect.logError("defect", { referenceId }, cause).pipe(
          Effect.as(
            HttpServerResponse.jsonUnsafe(
              { _tag: BODY_TAG[500], error: defectPublicError(referenceId) },
              { status: 500 },
            ),
          ),
        )
      }
      return Effect.failCause(cause)
    }),
  )

/** Installs respondToFailures around every route, where it can still change the response. */
export const FailureResponsesLive = HttpRouter.middleware(respondToFailures, { global: true })
