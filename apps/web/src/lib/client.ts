import {
  type OperationInput,
  type OperationName,
  type OperationOutput,
  type Operations,
  operations,
} from "@parley/domain"
import { PublicError, type UserText, userText } from "@parley/errors"
import { Schema } from "effect"

/** A failed call: the HTTP status and the PublicError the server sent (never our own sentence). */
export interface ApiFailure {
  readonly _tag: "ApiFailure"
  readonly status: number
  readonly error: PublicError
}

export const isApiFailure = (value: unknown): value is ApiFailure =>
  typeof value === "object" && value !== null && (value as { _tag?: unknown })._tag === "ApiFailure"

const offline = (): ApiFailure => ({
  _tag: "ApiFailure",
  status: 0,
  error: {
    _tag: "NetworkUnavailable",
    userMessage: userText`Parley couldn't be reached. Your changes are still here. Check your connection and try again.`,
    isRetryable: true,
  },
})

export const messageOf = (failure: unknown): UserText =>
  isApiFailure(failure) ? failure.error.userMessage : offline().error.userMessage

const decodePublicError = Schema.decodeUnknownSync(Schema.Struct({ error: PublicError }))

/**
 * Calls an operation over /api/v1. Typed end to end from the operation's contract (D13, D16):
 * the same contract the server and the MCP tools are derived from.
 */
export const call = async <Name extends OperationName>(
  name: Name,
  input: OperationInput<Operations[Name]>,
): Promise<OperationOutput<Operations[Name]>> => {
  const op = operations[name]
  const values = { ...(input as Record<string, unknown>) }
  const path = op.http.path.replace(/:(\w+)/g, (_, key: string) => {
    const value = String(values[key])
    delete values[key]
    return encodeURIComponent(value)
  })
  const hasBody = op.http.method === "POST" || op.http.method === "PATCH"
  const query = new URLSearchParams()
  if (!hasBody) {
    for (const [key, value] of Object.entries(values)) if (value !== undefined) query.set(key, String(value))
  }
  let response: Response
  try {
    response = await fetch(`/api/v1${path}${query.size > 0 ? `?${query}` : ""}`, {
      method: op.http.method,
      credentials: "same-origin",
      headers: hasBody ? { "content-type": "application/json" } : {},
      ...(hasBody ? { body: JSON.stringify(values) } : {}),
    })
  } catch {
    throw offline()
  }
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    try {
      throw { _tag: "ApiFailure", status: response.status, error: decodePublicError(body).error } satisfies ApiFailure
    } catch (thrown) {
      if (isApiFailure(thrown)) throw thrown
      throw offline()
    }
  }
  return Schema.decodeUnknownSync(op.output as Schema.ConstraintDecoder<unknown>)(body) as OperationOutput<
    Operations[Name]
  >
}
