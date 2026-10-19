import { apiKey } from "@better-auth/api-key"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
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
]

export interface AuthConfig {
  readonly db: NodePgDatabase<Record<string, unknown>>
  readonly schema: Record<string, unknown>
  readonly secret: string
  readonly baseURL: string
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
  }
}

export const makeAuth = (config: AuthConfig): Auth =>
  betterAuth({
    appName: "Parley",
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    database: drizzleAdapter(config.db, { provider: "pg", schema: config.schema }),
    emailAndPassword: { enabled: true },
    user: {
      additionalFields: {
        /** "service-account" users can never sign in with a password (D18). */
        kind: { type: "string", required: false, defaultValue: "user", input: false },
      },
    },
    disabledPaths: DISABLED_PATHS,
    plugins: [
      organization({ creatorRole: "owner" }),
      apiKey({
        defaultPrefix: "parley_",
        enableMetadata: true,
        requireName: true,
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 600 },
      }),
    ],
  })
