import { Database, schema } from "@parley/db"
import {
  type ApiKey,
  type ApiKeyId,
  type CreatedApiKey,
  type DatabaseUnavailable,
  type Permission,
  ROLE_PERMISSIONS,
} from "@parley/domain"
import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { BetterAuth } from "../auth/authenticator.ts"
import type { MemberOf } from "../proofs/member-of.ts"
import type { OwnApiKey } from "../proofs/own-api-key.ts"
import { classifySqlError } from "./sql-errors.ts"

const PERMISSIONS = new Set<string>([...ROLE_PERMISSIONS.owner])

/** Our scopes as Better-Auth permissions: ["records:read"] → { records: ["read"] }. */
const toPermissions = (scopes: ReadonlyArray<Permission>): Record<string, Array<string>> => {
  const permissions: Record<string, Array<string>> = {}
  for (const scope of scopes) {
    const [resource = "", action = ""] = scope.split(":")
    permissions[resource] = [...(permissions[resource] ?? []), action]
  }
  return permissions
}

const parseJson = (text: string | null): unknown => {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const scopesOf = (permissions: string | null): ReadonlyArray<Permission> => {
  const parsed = parseJson(permissions)
  if (!parsed || typeof parsed !== "object") return []
  return Object.entries(parsed).flatMap(([resource, actions]) =>
    Array.isArray(actions)
      ? actions
          .map((action) => `${resource}:${String(action)}`)
          .filter((scope): scope is Permission => PERMISSIONS.has(scope))
      : [],
  )
}

const teamOf = (metadata: string | null): string | undefined => {
  const parsed = parseJson(metadata)
  const teamId = parsed && typeof parsed === "object" ? (parsed as { teamId?: unknown }).teamId : undefined
  return typeof teamId === "string" ? teamId : undefined
}

type Row = typeof schema.apikey.$inferSelect

const summarize = (row: Row): ApiKey => ({
  id: row.id as ApiKeyId,
  name: row.name ?? "API key",
  start: row.start,
  scopes: scopesOf(row.permissions),
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt?.toISOString() ?? null,
  lastUsedAt: row.lastRequest?.toISOString() ?? null,
  revoked: row.enabled === false,
})

/**
 * A member's own API keys in one team (D19). Better-Auth stores and verifies them; its own
 * routes for creating and changing keys are disabled, so this service is the only way in (D17).
 */
export class ApiKeys extends Context.Service<
  ApiKeys,
  {
    readonly list: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<ApiKey>, DatabaseUnavailable>
    /** Used only by the OwnApiKey prover. */
    readonly locateOwn: <P, T>(
      member: MemberOf<P, T>,
      apiKeyId: ApiKeyId,
    ) => Effect.Effect<ApiKey | undefined, DatabaseUnavailable>
    readonly create: <P, T>(
      member: MemberOf<P, T>,
      input: {
        readonly name: string
        readonly scopes: ReadonlyArray<Permission>
        readonly expiresInDays: number | undefined
      },
    ) => Effect.Effect<CreatedApiKey, DatabaseUnavailable>
    readonly revoke: <P, T, K>(target: OwnApiKey<P, T, K>) => Effect.Effect<ApiKey, DatabaseUnavailable>
  }
>()("@parley/core/ApiKeys") {
  static readonly layer = Layer.effect(
    ApiKeys,
    Effect.gen(function* () {
      const db = yield* Database
      const auth = yield* BetterAuth

      const rowsOf = (userId: string) =>
        db
          .query((d) =>
            d
              .select()
              .from(schema.apikey)
              .where(eq(schema.apikey.referenceId, userId))
              .orderBy(desc(schema.apikey.createdAt)),
          )
          .pipe(Effect.catchTag("SqlError", classifySqlError))

      const list = <P, T>(member: MemberOf<P, T>) =>
        Effect.map(rowsOf(member.principal.value.userId), (rows) =>
          rows.filter((row) => teamOf(row.metadata) === member.team.value).map(summarize),
        )

      const findRow = (userId: string, apiKeyId: string) =>
        Effect.map(
          db
            .query((d) =>
              d
                .select()
                .from(schema.apikey)
                .where(and(eq(schema.apikey.id, apiKeyId), eq(schema.apikey.referenceId, userId)))
                .limit(1),
            )
            .pipe(Effect.catchTag("SqlError", classifySqlError)),
          ([row]) => row,
        )

      const locateOwn = <P, T>(member: MemberOf<P, T>, apiKeyId: ApiKeyId) =>
        Effect.map(findRow(member.principal.value.userId, apiKeyId), (row) =>
          row && teamOf(row.metadata) === member.team.value ? summarize(row) : undefined,
        )

      const create = <P, T>(
        member: MemberOf<P, T>,
        input: {
          readonly name: string
          readonly scopes: ReadonlyArray<Permission>
          readonly expiresInDays: number | undefined
        },
      ) =>
        Effect.gen(function* () {
          const userId = member.principal.value.userId
          const created = yield* Effect.tryPromise(() =>
            auth.api.createApiKey({
              body: {
                name: input.name,
                userId,
                permissions: toPermissions(input.scopes),
                metadata: { teamId: member.team.value },
                ...(input.expiresInDays ? { expiresIn: input.expiresInDays * 86_400 } : {}),
              },
            }),
          ).pipe(Effect.orDie)
          const row = yield* findRow(userId, created.id)
          if (!row) return yield* Effect.die(`API key ${created.id} vanished after creation`)
          return { apiKey: summarize(row), secret: created.key } satisfies CreatedApiKey
        }).pipe(Effect.withSpan("ApiKeys.create"))

      const revoke = <P, T, K>(target: OwnApiKey<P, T, K>) =>
        Effect.gen(function* () {
          const userId = target.member.principal.value.userId
          if (!target.found.revoked) {
            yield* Effect.tryPromise(() =>
              auth.api.updateApiKey({ body: { keyId: target.apiKey.value, userId, enabled: false } }),
            ).pipe(Effect.orDie)
          }
          const row = yield* findRow(userId, target.apiKey.value)
          if (!row) return yield* Effect.die(`API key ${target.apiKey.value} vanished while revoking`)
          return summarize(row)
        }).pipe(Effect.withSpan("ApiKeys.revoke"))

      return { list, locateOwn, create, revoke }
    }),
  )
}
