import { apiKey } from "@better-auth/api-key"
import { mcp } from "@better-auth/mcp"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api"
import { jwt } from "better-auth/plugins/jwt"
import { organization } from "better-auth/plugins/organization"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

/**
 * Better-Auth handles sign-in, sessions, and storing teams, members and API keys.
 * It never makes authorization decisions: every client-facing mutation of teams, members
 * and API keys is disabled, and Parley operations make those changes server-side after
 * proving the principal may (D17).
 */
const DISABLED_PATHS = [
  "/organization/create",
  "/organization/update",
  "/organization/delete",
  "/organization/leave",
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/remove-member",
  "/organization/update-member-role",
  "/organization/create-role",
  "/organization/update-role",
  "/organization/delete-role",
  "/organization/create-team",
  "/organization/update-team",
  "/organization/remove-team",
  "/organization/add-team-member",
  "/organization/remove-team-member",
  "/organization/set-active-team",
  "/api-key/create",
  "/api-key/update",
  "/api-key/delete",
  "/api-key/delete-all-expired-api-keys",
  // Consent is recorded as a connection by connections.create; see the consent guard below (D92).
  "/oauth2/get-consent",
  "/oauth2/get-consents",
  "/oauth2/update-consent",
  "/oauth2/delete-consent",
  // Agents register themselves (dynamic registration); nobody manages clients by hand.
  "/oauth2/create-client",
  "/oauth2/get-client",
  "/oauth2/get-clients",
  "/oauth2/update-client",
  "/oauth2/delete-client",
  "/oauth2/client/rotate-secret",
  "/admin/oauth2/create-client",
  "/admin/oauth2/update-client",
  "/admin/oauth2/resources",
  // The JWT plugin's session-to-JWT exchange. Parley only issues JWTs as OAuth access tokens.
  "/token",
]

/** OAuth scopes are only about the sign-in itself. What an agent may do is the connection's scopes, chosen at consent. */
export const OAUTH_SCOPES = ["openid", "profile", "email", "offline_access"]

/** The claim in an access token that names its connection. */
export const CONNECTION_CLAIM = "connection_id"

/** Lets Better-Auth find Parley's connection while it handles an OAuth request. */
export interface ConnectionHooks {
  /** The connection being consented to in this sign-in session, if any. */
  readonly pendingFor: (sessionId: string) => Promise<{ readonly id: string; readonly clientId: string } | undefined>
  /** Marks the connection authorized. Rejects when it is missing or revoked, which refuses the token. */
  readonly authorize: (connectionId: string) => Promise<void>
}

export interface AuthConfig {
  readonly db: NodePgDatabase<Record<string, unknown>>
  readonly schema: Record<string, unknown>
  readonly secret: string
  readonly baseURL: string
  readonly connections: ConnectionHooks
}

interface SessionResult {
  readonly user: { readonly id: string; readonly name: string; readonly email: string }
  readonly session: { readonly id: string; readonly expiresAt: Date }
}

interface VerifiedApiKey {
  readonly id: string
  readonly name: string | null
  readonly referenceId: string
  readonly permissions?: unknown
  readonly metadata?: unknown
}

/**
 * The part of Better-Auth Parley uses. Declared, rather than inferred, because the inferred
 * type is too large to emit, and because it documents exactly what we depend on.
 */
export interface Auth {
  readonly handler: (request: Request) => Promise<Response>
  readonly api: {
    readonly getSession: (input: { readonly headers: Headers }) => Promise<SessionResult | null>
    readonly verifyApiKey: (input: { readonly body: { readonly key: string } }) => Promise<{
      readonly valid: boolean
      readonly error: { readonly code: string; readonly cause?: unknown } | null
      readonly key: VerifiedApiKey | null
    }>
    readonly signUpEmail: (input: {
      readonly body: { readonly name: string; readonly email: string; readonly password: string }
    }) => Promise<{ readonly user: { readonly id: string } }>
    readonly createOrganization: (input: {
      readonly body: { readonly name: string; readonly slug: string; readonly userId: string }
    }) => Promise<{ readonly id: string } | null>
    readonly createApiKey: (input: {
      readonly body: {
        readonly name: string
        readonly userId: string
        readonly permissions?: Record<string, Array<string>>
        readonly metadata?: Record<string, unknown>
        readonly expiresIn?: number
      }
    }) => Promise<{ readonly id: string; readonly key: string }>
    readonly updateApiKey: (input: {
      readonly body: { readonly keyId: string; readonly userId: string; readonly enabled: boolean }
    }) => Promise<unknown>
    /** RFC 8414 metadata. Served at the site root too, where MCP clients look for it. */
    readonly getOAuthServerConfig: (input: {
      readonly request: Request
      readonly asResponse: false
    }) => Promise<unknown>
    readonly getOpenIdConfig: (input: { readonly request: Request; readonly asResponse: false }) => Promise<unknown>
    readonly getJwks: () => Promise<{ readonly keys: ReadonlyArray<Record<string, unknown>> }>
    readonly oauth2Consent: (input: {
      readonly headers: Headers
      readonly body: { readonly accept: boolean; readonly oauth_query: string }
    }) => Promise<{ readonly redirect: boolean; readonly url: string }>
  }
}

/** Where MCP clients send their access tokens. Tokens are audience-bound to it. */
export const mcpResource = (baseURL: string) => `${baseURL}/mcp`

const BASE_PATH = "/api/auth"

/** Who issues access tokens: Better-Auth, at its base path. */
export const issuer = (baseURL: string) => `${baseURL}${BASE_PATH}`

/**
 * Consent is only accepted for the connection the consent page just recorded, for the same
 * agent. Without this, accepting consent directly would mint tokens that name no connection.
 */
const consentGuard = (connections: ConnectionHooks) =>
  createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/oauth2/consent" || ctx.body?.accept !== true) return
    const session = await getSessionFromCtx(ctx)
    const pending = session ? await connections.pendingFor(session.session.id) : undefined
    const query = typeof ctx.body?.oauth_query === "string" ? ctx.body.oauth_query : ""
    const clientId = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query).get("client_id")
    if (!pending || pending.clientId !== clientId) {
      throw new APIError("FORBIDDEN", {
        error: "access_denied",
        error_description: "Choose a team and who the agent acts as before allowing it.",
      })
    }
  })

export const makeAuth = (config: AuthConfig): Auth =>
  betterAuth({
    appName: "Parley",
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: BASE_PATH,
    database: drizzleAdapter(config.db, { provider: "pg", schema: config.schema }),
    emailAndPassword: { enabled: true },
    user: {
      additionalFields: {
        /** "service-account" users can never sign in with a password (D18). */
        kind: { type: "string", required: false, defaultValue: "user", input: false },
      },
    },
    disabledPaths: DISABLED_PATHS,
    hooks: { before: consentGuard(config.connections) },
    plugins: [
      organization({ creatorRole: "owner" }),
      apiKey({
        defaultPrefix: "parley_",
        enableMetadata: true,
        requireName: true,
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 600 },
      }),
      jwt(),
      mcp({
        resource: mcpResource(config.baseURL),
        loginPage: "/sign-in",
        consentPage: "/connect",
        scopes: OAUTH_SCOPES,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        postLogin: {
          page: "/connect",
          // Choosing the team and identity happens on the consent page, so never redirect here.
          shouldRedirect: () => false,
          consentReferenceId: async ({ session }) => (await config.connections.pendingFor(session.id))?.id,
        },
        customAccessTokenClaims: async ({ referenceId }) => {
          if (!referenceId) throw new Error("An access token was requested without a connection.")
          await config.connections.authorize(referenceId)
          return { [CONNECTION_CLAIM]: referenceId }
        },
      }),
    ],
  })
