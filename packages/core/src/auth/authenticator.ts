import { schema } from "@parley/db"
import {
  ApiKeyExpired,
  type ApiKeyId,
  ApiKeyRevoked,
  ApiKeyUnrecognized,
  type DatabaseUnavailable,
  type Permission,
  RequestsTooFrequent,
  SessionExpired,
  SessionMissing,
  type TeamId,
  type UserId,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { drizzle } from "drizzle-orm/node-postgres"
import { Config, Context, Duration, Effect, Layer, Redacted } from "effect"
import { Pool } from "pg"
import type { Principal } from "../principal.ts"
import { Users } from "../services/users.ts"
import { type Auth, makeAuth } from "./better-auth.ts"

/** The Better-Auth instance. Process tier: one per server, with its own small pool. */
export class BetterAuth extends Context.Service<BetterAuth, Auth>()("@parley/core/BetterAuth") {
  static readonly layer = Layer.effect(
    BetterAuth,
    Effect.gen(function* () {
      const url = yield* Config.Redacted("DATABASE_URL")
      const secret = yield* Config.Redacted("BETTER_AUTH_SECRET")
      const baseURL = yield* Config.String("BETTER_AUTH_URL")
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => new Pool({ connectionString: Redacted.value(url), max: 5 })),
        (pool) =>
          Effect.callback<void>((resume) => {
            pool.end().then(
              () => resume(Effect.void),
              () => resume(Effect.void),
            )
          }),
      )
      return makeAuth({ db: drizzle(pool, { schema }), schema, secret: Redacted.value(secret), baseURL })
    }),
  )
}

export type AuthenticationFailure =
  | SessionMissing
  | SessionExpired
  | ApiKeyUnrecognized
  | ApiKeyExpired
  | ApiKeyRevoked
  | RequestsTooFrequent
  | DatabaseUnavailable

const SESSION_COOKIE = "better-auth.session_token"

const apiKeyFrom = (headers: Headers): string | undefined => {
  const explicit = headers.get("x-api-key")
  if (explicit) return explicit.trim()
  const authorization = headers.get("authorization")
  return authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined
}

const PERMISSIONS: ReadonlySet<string> = new Set<Permission>([
  "records:read",
  "records:write",
  "records:delete",
  "fields:manage",
  "members:manage",
  "service-accounts:manage",
  "team:manage",
])
const isPermission = (value: string): value is Permission => PERMISSIONS.has(value)

/** An API key's scopes, stored as Better-Auth permissions ({ records: ["read"] }). None means none (deny by default). */
const scopesFrom = (permissions: unknown): ReadonlySet<Permission> => {
  const parsed = typeof permissions === "string" ? safeJson(permissions) : permissions
  const scopes = new Set<Permission>()
  if (parsed && typeof parsed === "object") {
    for (const [resource, actions] of Object.entries(parsed)) {
      if (!Array.isArray(actions)) continue
      for (const action of actions) {
        const permission = `${resource}:${String(action)}`
        if (isPermission(permission)) scopes.add(permission)
      }
    }
  }
  return scopes
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const teamIdFrom = (metadata: unknown): TeamId | undefined => {
  const parsed = typeof metadata === "string" ? safeJson(metadata) : metadata
  const teamId = parsed && typeof parsed === "object" ? (parsed as { readonly teamId?: unknown }).teamId : undefined
  return typeof teamId === "string" ? (teamId as TeamId) : undefined
}

const tryAgainInFrom = (cause: unknown): Duration.Duration => {
  const details = cause && typeof cause === "object" ? (cause as { readonly details?: unknown }).details : undefined
  const ms =
    details && typeof details === "object" ? (details as { readonly tryAgainIn?: unknown }).tryAgainIn : undefined
  return typeof ms === "number" && ms > 0 ? Duration.millis(ms) : Duration.seconds(60)
}

/** Calls into Better-Auth. A rejection here is a bug or an outage we haven't classified, so it dies. */
const call = <A>(thunk: () => Promise<A>): Effect.Effect<A> =>
  Effect.callback<A>((resume) => {
    thunk().then(
      (value) => resume(Effect.succeed(value)),
      (cause) => resume(Effect.die(cause)),
    )
  })

/**
 * Turns a request's credentials into a Principal. Entrypoints call this and nothing else
 * about auth: they authenticate; proofs authorize (docs/04-authorization-proofs.md).
 */
export class Authenticator extends Context.Service<
  Authenticator,
  { readonly authenticate: (headers: Headers) => Effect.Effect<Principal, AuthenticationFailure> }
>()("@parley/core/Authenticator") {
  static readonly layer = Layer.effect(
    Authenticator,
    Effect.gen(function* () {
      const auth = yield* BetterAuth
      const users = yield* Users

      const fromApiKey = Effect.fn("Authenticator.fromApiKey")(function* (key: string) {
        const result = yield* call(() => auth.api.verifyApiKey({ body: { key } }))
        if (!result.valid || !result.key) {
          const code = result.error?.code
          if (code === "KEY_EXPIRED") return yield* new ApiKeyExpired()
          if (code === "KEY_DISABLED") return yield* new ApiKeyRevoked()
          if (code === "RATE_LIMITED" || code === "RATE_LIMIT_EXCEEDED") {
            return yield* new RequestsTooFrequent({ retryAfter: tryAgainInFrom(result.error?.cause) })
          }
          return yield* new ApiKeyUnrecognized()
        }
        const apiKey = result.key
        const owner = yield* users.find(apiKey.referenceId as UserId)
        if (!owner) return yield* new ApiKeyUnrecognized()
        const common = {
          userId: apiKey.referenceId as UserId,
          name: DisplayName.fromRecord(owner.name),
          apiKeyId: apiKey.id as ApiKeyId,
          apiKeyName: apiKey.name ?? "API key",
          scopes: scopesFrom((apiKey as { readonly permissions?: unknown }).permissions),
        }
        const principal: Principal =
          owner.kind === "service-account"
            ? { _tag: "ServiceAccountApiKey", ...common }
            : {
                _tag: "UserApiKey",
                ...common,
                teamId: teamIdFrom((apiKey as { readonly metadata?: unknown }).metadata),
              }
        return principal
      })

      const fromSession = Effect.fn("Authenticator.fromSession")(function* (headers: Headers) {
        const session = yield* call(() => auth.api.getSession({ headers }))
        if (!session) {
          const hasCookie = headers.get("cookie")?.includes(SESSION_COOKIE) ?? false
          return yield* hasCookie ? new SessionExpired() : new SessionMissing()
        }
        const principal: Principal = {
          _tag: "UserSession",
          userId: session.user.id as UserId,
          name: DisplayName.fromRecord(session.user.name),
        }
        return principal
      })

      const authenticate = (headers: Headers): Effect.Effect<Principal, AuthenticationFailure> => {
        const key = apiKeyFrom(headers)
        return key ? fromApiKey(key) : fromSession(headers)
      }

      return { authenticate }
    }),
  )
}
