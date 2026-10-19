import { DatabaseUnavailable } from "@parley/domain"
import { Effect } from "effect"
import type { SqlError } from "effect/sql"

const UNAVAILABLE = new Set([
  "ConnectionError",
  "StatementTimeoutError",
  "LockTimeoutError",
  "DeadlockError",
  "SerializationError",
])

/**
 * The default classifier for a query: infrastructure trouble becomes DatabaseUnavailable,
 * anything else is a bug and dies. Call sites that expect a constraint violation check for it first.
 */
export const classifySqlError = (error: SqlError.SqlError): Effect.Effect<never, DatabaseUnavailable> =>
  UNAVAILABLE.has(error.reason._tag) ? Effect.fail(new DatabaseUnavailable({ cause: error })) : Effect.die(error)

export const isUniqueViolation = (error: SqlError.SqlError, constraint: string): boolean =>
  error.reason._tag === "UniqueViolation" && error.reason.constraint === constraint
