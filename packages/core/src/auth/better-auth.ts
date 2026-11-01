import { apiKey } from "@better-auth/api-key"
import { getCurrentAuthEndpointContext } from "@better-auth/core/context"
import { mcp } from "@better-auth/mcp"
import { passkey } from "@better-auth/passkey"
import type { schema } from "@parley/db"
import { ENOUGH_STRENGTH, passwordStrength } from "@parley/domain"
import { type BetterAuthPlugin, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api"
import { jwt } from "better-auth/plugins/jwt"
import { organization } from "better-auth/plugins/organization"
import { twoFactor } from "better-auth/plugins/two-factor"
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
  readonly db: NodePgDatabase<typeof schema.authRelations>
  readonly schema: Record<string, unknown>
  readonly secret: string
  readonly baseURL: string
  readonly connections: ConnectionHooks
  /** Whether an account may be made for this address (D163): its domain, an invitation, or the first account. */
  readonly mayCreateAccount: (email: string) => Promise<boolean>
  /** Sends the link that proves someone owns their email address. */
  readonly sendVerificationEmail: (to: string, link: string) => Promise<void>
  /** Sends the link to choose a new password (D172). */
  readonly sendPasswordResetEmail: (to: string, link: string) => Promise<void>
  /** Headers holding the client's address when behind a proxy, such as `cf-connecting-ip`. */
  readonly ipAddressHeaders: ReadonlyArray<string>
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

/** What a hook before an endpoint sees. */
type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

/**
 * Consent is only accepted for the connection the consent page just recorded, for the same
 * agent. Without this, accepting consent directly would mint tokens that name no connection.
 */
const consentGuard = (connections: ConnectionHooks) => async (ctx: HookContext) => {
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
}

/** Where Better-Auth hashes a password someone has just chosen: signing up, changing it, resetting it. */
const NEW_PASSWORD_PATHS: ReadonlySet<string> = new Set(["/sign-up/email", "/change-password", "/reset-password"])

/**
 * A new password must be at least Good (D172), judged by the same check the web app shows as you
 * type. Built the way Better-Auth's own haveibeenpwned plugin is: it wraps the password hasher, so
 * it sees the password only once Better-Auth has validated the request (and any reset token)
 * itself. Signing up and changing it, the person's name and email count as easy guesses, from
 * what Better-Auth hands over: the sign-up form, or the signed-in session. A reset has neither, so
 * it judges the password alone, as the reset page does.
 */
const passwordStrengthPlugin = {
  id: "parley-password-strength",
  init: (context) => {
    const hash = context.password.hash
    return {
      context: {
        password: {
          ...context.password,
          hash: async (password: string) => {
            const endpoint = getCurrentAuthEndpointContext()
            if (endpoint.path && NEW_PASSWORD_PATHS.has(endpoint.path)) {
              const owner =
                endpoint.path === "/sign-up/email"
                  ? [endpoint.body?.name, endpoint.body?.email]
                  : [endpoint.context.session?.user.name, endpoint.context.session?.user.email]
              const strength = await passwordStrength(
                password,
                owner.filter((value): value is string => typeof value === "string" && value.length > 0),
              )
              if (strength.score < ENOUGH_STRENGTH) {
                throw new APIError("BAD_REQUEST", {
                  code: "PASSWORD_TOO_WEAK",
                  message: `That password is too easy to guess. ${strength.warning ?? ""}`.trim(),
                })
              }
            }
            return hash(password)
          },
        },
      },
    }
  },
} satisfies BetterAuthPlugin

/** A passkey used without a fingerprint, face or PIN (D172). */
const unverifiedPasskey = () =>
  new APIError("BAD_REQUEST", {
    code: "PASSKEY_NOT_VERIFIED",
    message: "Use a passkey that checks your fingerprint, face or PIN.",
  })

/** The site passkeys belong to: Parley's own host name, without the port (D172). */
const relyingParty = (baseURL: string) => new URL(baseURL)

export const makeAuth = (config: AuthConfig): Auth => {
  const guardConsent = consentGuard(config.connections)
  return betterAuth({
    appName: "Parley",
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: BASE_PATH,
    database: drizzleAdapter(config.db, { provider: "pg", schema: config.schema }),
    // Nobody signs in before proving they own their address (D163): whether an address may have an
    // account depends on it, and an invitation names an address only its owner may take.
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // A forgotten password is reset by an emailed link, good once for an hour, and the reset signs
      // you out everywhere (D172). Service accounts never sign in with a password (D18), so no
      // link is ever sent for one; the reply looks the same either way.
      sendResetPassword: async ({ user, url }) => {
        if ((user as { kind?: string | null }).kind === "service-account") return
        await config.sendPasswordResetEmail(user.email, url)
      },
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      // Signing in before confirming sends a fresh link, in case the first one is lost.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => config.sendVerificationEmail(user.email, url),
    },
    user: {
      additionalFields: {
        /** "service-account" users can never sign in with a password (D18). */
        kind: { type: "string", required: false, defaultValue: "user", input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Service accounts are made by Parley itself, not by signing up.
          before: async (user) => {
            if (user.kind === "service-account" || (await config.mayCreateAccount(user.email))) return
            // Better-Auth answers a refusal (403) as it answers an address that already has an
            // account: as if signed up, waiting for a confirmation email that never comes. So nobody
            // learns from the reply which addresses may sign up or already have.
            throw new APIError("FORBIDDEN", {
              code: "SIGN_UP_NOT_ALLOWED",
              message: "This address can't create an account here.",
            })
          },
        },
      },
    },
    disabledPaths: DISABLED_PATHS,
    ...(config.ipAddressHeaders.length > 0
      ? { advanced: { ipAddress: { ipAddressHeaders: [...config.ipAddressHeaders] } } }
      : {}),
    // Always on (Better-Auth only enables it in production by default), with tighter limits where
    // a request costs an email or a stored row: sign-up, verification and agents registering.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        // Reading the session costs one indexed lookup and the web app checks it on every
        // navigation, so a limit here signs out everyone sharing an IP address (an office).
        "/get-session": false,
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 3600, max: 20 },
        "/send-verification-email": { window: 3600, max: 5 },
        "/request-password-reset": { window: 3600, max: 5 },
        "/reset-password": { window: 60, max: 10 },
        "/oauth2/register": { window: 3600, max: 30 },
        // A code is six digits, so guesses are few and slow (D172).
        "/two-factor/verify-totp": { window: 60, max: 10 },
        "/two-factor/verify-backup-code": { window: 60, max: 10 },
        "/change-password": { window: 60, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await guardConsent(ctx)
      }),
    },
    plugins: [
      organization({ creatorRole: "owner" }),
      passwordStrengthPlugin,
      // An authenticator app after your password, with backup codes; a trusted device skips it for
      // 30 days (D172).
      twoFactor({
        issuer: "Parley",
        backupCodeOptions: { amount: 10 },
        trustDeviceMaxAge: 30 * 24 * 60 * 60,
      }),
      // Signing in with a passkey needs no password and no code (D172), so it must prove who is
      // holding the device (a fingerprint, face or PIN), not just that it's present: a security
      // key without a PIN would otherwise sign in by touch alone, skipping the code.
      passkey({
        rpID: relyingParty(config.baseURL).hostname,
        rpName: "Parley",
        origin: relyingParty(config.baseURL).origin,
        authenticatorSelection: { userVerification: "required" },
        registration: {
          afterVerification: ({ verification }) => {
            if (!verification.registrationInfo?.userVerified) throw unverifiedPasskey()
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) throw unverifiedPasskey()
          },
        },
      }),
      apiKey({
        defaultPrefix: "parley_",
        enableMetadata: true,
        requireName: true,
        // "parley_" plus four characters, so people can tell their keys apart (D97).
        startingCharactersConfig: { charactersLength: 11 },
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
}
