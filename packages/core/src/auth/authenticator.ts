import { schema } from "@parley/db"
import {
  AccessTokenExpired,
  AccessTokenUnrecognized,
  ApiKeyExpired,
  type ApiKeyId,
  ApiKeyRevoked,
  ApiKeyUnrecognized,
  ConnectionRevoked,
  type DatabaseUnavailable,
  Permission,
  RequestsTooFrequent,
  SessionExpired,
  SessionMissing,
  type TeamId,
  type UserId,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Config, Context, Duration, Effect, Layer, Redacted } from "effect"
import { createLocalJWKSet, type JWTPayload, jwtVerify } from "jose"
import { Pool } from "pg"
import { PublicUrl } from "../config/public-url.ts"
import { Mailer } from "../mail/mailer.ts"
import { renderVerification } from "../mail/templates.ts"
import type { Principal } from "../principal.ts"
import { Connections } from "../services/connections.ts"
import { RateLimiter } from "../services/rate-limiter.ts"
import { Users } from "../services/users.ts"
import { type Auth, CONNECTION_CLAIM, type ConnectionHooks, issuer, makeAuth, mcpResource } from "./better-auth.ts"
import { domainMaySignUp, signUpDomainsOf } from "./sign-up-policy.ts"

/** How long the consent page has between recording a connection and the agent finishing sign-in. */
const PENDING_FOR = "10 minutes"

/** The Better-Auth instance. Process tier: one per server, with its own small pool. */
export class BetterAuth extends Context.Service<BetterAuth, Auth>()("@parley/core/BetterAuth") {
  static readonly layer = Layer.effect(
    BetterAuth,
    Effect.gen(function* () {
      const url = yield* Config.Redacted("DATABASE_URL")
      const secret = yield* Config.Redacted("BETTER_AUTH_SECRET")
      // Behind a proxy, the header carrying the visitor's address, so rate limits are per visitor.
      const ipAddressHeader = yield* Config.String("IP_ADDRESS_HEADER").pipe(Config.withDefault(""))
      // Which addresses may sign up without an invitation (D163). Unset: none.
      const signUpDomains = signUpDomainsOf(yield* Config.String("PARLEY_SIGNUP_DOMAINS").pipe(Config.withDefault("")))
      // Refuse to start with the example's placeholder, or anything short enough to guess.
      const secretText = Redacted.value(secret)
      if (secretText.startsWith("replace-with") || secretText.length < 32) {
        return yield* Effect.die(
          new Error("BETTER_AUTH_SECRET must be at least 32 random characters (openssl rand -hex 32)."),
        )
      }
      const baseURL = yield* PublicUrl
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => new Pool({ connectionString: Redacted.value(url), max: 5, statement_timeout: 30_000 })),
        (pool) =>
          Effect.callback<void>((resume) => {
            pool.end().then(
              () => resume(Effect.void),
              () => resume(Effect.void),
            )
          }),
      )
      const db = drizzle(pool, { schema })
      const { connections } = schema
      // Better-Auth calls these mid-request, outside any fiber, so they use its pool directly.
      const hooks: ConnectionHooks = {
        pendingFor: async (sessionId) => {
          const [row] = await db
            .select({ id: connections.id, clientId: connections.clientId })
            .from(connections)
            .where(
              and(
                eq(connections.sessionId, sessionId),
                isNull(connections.authorizedAt),
                isNull(connections.revokedAt),
                gt(connections.createdAt, sql`now() - ${PENDING_FOR}::interval`),
              ),
            )
            .orderBy(desc(connections.createdAt))
            .limit(1)
          return row
        },
        authorize: async (connectionId) => {
          const rows = await db
            .update(connections)
            .set({ authorizedAt: sql`coalesce(${connections.authorizedAt}, now())` })
            .where(and(eq(connections.id, connectionId), isNull(connections.revokedAt)))
            .returning({ id: connections.id })
          if (rows.length === 0) throw new Error(`connection ${connectionId} is missing or revoked`)
        },
      }
      const mailer = yield* Mailer
      const runtime = yield* Effect.context<never>()
      const sendVerificationEmail = (to: string, link: string) => {
        const message = renderVerification({ link })
        return Effect.runPromiseWith(runtime)(
          mailer.send({ to, ...message }).pipe(
            Effect.asVoid,
            Effect.catch((error) => Effect.logWarning("verification email not sent", error._tag)),
          ),
        )
      }
      /** An account may be made on its domain, for an address with a pending invitation, or as the first one. */
      const mayCreateAccount = async (email: string) => {
        if (domainMaySignUp(signUpDomains, email)) return true
        const [invited] = await db
          .select({ id: schema.invitation.id })
          .from(schema.invitation)
          .where(
            and(
              sql`lower(${schema.invitation.email}) = ${email.trim().toLowerCase()}`,
              eq(schema.invitation.status, "pending"),
              gt(schema.invitation.expiresAt, new Date()),
            ),
          )
          .limit(1)
        if (invited) return true
        const [someone] = await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.kind, "user"))
          .limit(1)
        return someone === undefined
      }
      return makeAuth({
        db,
        schema,
        mayCreateAccount,
        secret: Redacted.value(secret),
        baseURL,
        connections: hooks,
        sendVerificationEmail,
        ipAddressHeaders: ipAddressHeader ? [ipAddressHeader] : [],
      })
    }),
  )
}

export type AuthenticationFailure =
  | SessionMissing
  | SessionExpired
  | ApiKeyUnrecognized
  | ApiKeyExpired
  | ApiKeyRevoked
  | AccessTokenUnrecognized
  | AccessTokenExpired
  | ConnectionRevoked
  | RequestsTooFrequent
  | DatabaseUnavailable

const SESSION_COOKIE = "better-auth.session_token"

/** A bearer credential: an API key, or an agent's OAuth access token (a JWT). */
type Credential =
  | { readonly _tag: "ApiKey"; readonly key: string }
  | { readonly _tag: "AccessToken"; readonly token: string }

const API_KEY_PREFIX = "parley_"
const isJwt = (value: string) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)

const credentialFrom = (headers: Headers): Credential | undefined => {
  const explicit = headers.get("x-api-key")
  if (explicit) return { _tag: "ApiKey", key: explicit.trim() }
  const authorization = headers.get("authorization")
  if (!authorization?.toLowerCase().startsWith("bearer ")) return undefined
  const value = authorization.slice(7).trim()
  return !value.startsWith(API_KEY_PREFIX) && isJwt(value)
    ? { _tag: "AccessToken", token: value }
    : { _tag: "ApiKey", key: value }
}

/** Every permission there is, from the domain's own list, so a new one is never silently dropped. */
const PERMISSIONS: ReadonlySet<string> = new Set<string>(Permission.literals)
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

/** Where a request arrived. Access tokens are bound to the MCP endpoint, so only it accepts them. */
export type Entrypoint = "http" | "mcp"

/**
 * Turns a request's credentials into a Principal. Entrypoints call this and nothing else
 * about auth: they authenticate; proofs authorize (docs/04-authorization-proofs.md).
 */
export class Authenticator extends Context.Service<
  Authenticator,
  {
    readonly authenticate: (headers: Headers, entrypoint: Entrypoint) => Effect.Effect<Principal, AuthenticationFailure>
  }
>()("@parley/core/Authenticator") {
  static readonly layer = Layer.effect(
    Authenticator,
    Effect.gen(function* () {
      const auth = yield* BetterAuth
      const users = yield* Users
      const connections = yield* Connections
      const limiter = yield* RateLimiter
      const baseURL = yield* PublicUrl

      // Better-Auth's signing keys, fetched in-process and refetched when a token names a new one.
      let keys: ReturnType<typeof createLocalJWKSet> | undefined
      const loadKeys = async (refresh: boolean) => {
        if (!keys || refresh)
          keys = createLocalJWKSet((await auth.api.getJwks()) as Parameters<typeof createLocalJWKSet>[0])
        return keys
      }
      const verify = async (token: string): Promise<JWTPayload> => {
        const options = { issuer: issuer(baseURL), audience: mcpResource(baseURL) }
        try {
          return (await jwtVerify(token, await loadKeys(false), options)).payload
        } catch (error) {
          if ((error as { readonly code?: unknown }).code !== "ERR_JWKS_NO_MATCHING_KEY") throw error
          return (await jwtVerify(token, await loadKeys(true), options)).payload
        }
      }

      const fromAccessToken = Effect.fn("Authenticator.fromAccessToken")(function* (token: string) {
        const verified = yield* Effect.callback<JWTPayload | "expired" | "invalid">((resume) => {
          verify(token).then(
            (payload) => resume(Effect.succeed(payload)),
            (error: { readonly code?: unknown }) =>
              resume(Effect.succeed(error.code === "ERR_JWT_EXPIRED" ? "expired" : "invalid")),
          )
        })
        if (verified === "expired") return yield* new AccessTokenExpired()
        if (verified === "invalid") return yield* new AccessTokenUnrecognized()
        const connectionId = verified[CONNECTION_CLAIM]
        if (typeof connectionId !== "string") return yield* new AccessTokenUnrecognized()
        const grant = yield* connections.grant(connectionId)
        // The token must come from the agent and the person the connection was made for.
        const clientId = verified.azp ?? verified.client_id
        if (!grant || grant.clientId !== clientId || grant.connectedByUserId !== verified.sub) {
          return yield* new AccessTokenUnrecognized()
        }
        if (grant.revoked) return yield* new ConnectionRevoked()
        yield* connections.touch(grant.id)
        const common = {
          userId: grant.actsAs.userId,
          name: DisplayName.fromRecord(grant.actsAs.name),
          connectionId: grant.id,
          connectionName: grant.name,
          teamId: grant.teamId,
          scopes: grant.scopes,
        }
        const principal: Principal =
          grant.actsAs.kind === "service-account"
            ? { _tag: "ServiceAccountConnection", ...common, connectedByUserId: grant.connectedByUserId }
            : { _tag: "UserConnection", ...common }
        // The same allowance as an API key: an agent in a loop can't run without limit.
        yield* limiter.take(`connection:${grant.id}`, 600, Duration.minutes(1))
        return principal
      })

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
          sessionId: session.session.id,
        }
        return principal
      })

      const authenticate = (
        headers: Headers,
        entrypoint: Entrypoint,
      ): Effect.Effect<Principal, AuthenticationFailure> => {
        const credential = credentialFrom(headers)
        if (credential?._tag === "ApiKey") return fromApiKey(credential.key)
        if (credential?._tag === "AccessToken") {
          return entrypoint === "mcp" ? fromAccessToken(credential.token) : Effect.fail(new AccessTokenUnrecognized())
        }
        // Agents on MCP never have a session cookie; asking them to sign in starts OAuth.
        return entrypoint === "mcp" ? Effect.fail(new SessionMissing()) : fromSession(headers)
      }

      return { authenticate }
    }),
  )
}
