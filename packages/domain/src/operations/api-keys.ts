import { Schema } from "effect"
import { Permission } from "../access.ts"
import { ApiKey, CreatedApiKey } from "../api-key.ts"
import { ApiKeyNotFound, SignInRequired } from "../errors/access.ts"
import { ApiKeyId, TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }

export const listApiKeys = defineTeamOperation({
  name: "apiKeys.list",
  description:
    "List your own API keys for a team, newest first. Secrets are never returned, only each key's first characters.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(ApiKey),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/api-keys" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: [],
})

export const createApiKey = defineTeamOperation({
  name: "apiKeys.create",
  description:
    "Create an API key that acts as you in this team only, limited to its scopes (read-only unless you add more). The secret is returned once. Only a signed-in user can do this, not an API key.",
  input: Schema.Struct({
    ...InTeam,
    name: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(60)).annotate({
      title: "Name",
      description: 'What the key is for, shown in activity: "Claude on my laptop".',
    }),
    scopes: Schema.optional(
      Schema.Array(Permission)
        .check(Schema.isMinLength(1))
        .annotate({ title: "Scopes", description: 'Defaults to ["records:read"].' }),
    ),
    expiresInDays: Schema.optional(
      Schema.Literals([30, 90, 365]).annotate({ title: "Expiry", description: "Omit for a key that doesn't expire." }),
    ),
  }),
  output: CreatedApiKey,
  errors: [SignInRequired],
  http: { method: "POST", path: "/teams/:teamId/api-keys" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: [],
})

export const revokeApiKey = defineTeamOperation({
  name: "apiKeys.revoke",
  description:
    "Revoke one of your API keys. Agents using it stop working immediately. Revoking a revoked key does nothing.",
  input: Schema.Struct({
    ...InTeam,
    apiKeyId: ApiKeyId.annotate({ description: "The API key's id, from apiKeys.list." }),
  }),
  output: ApiKey,
  errors: [ApiKeyNotFound],
  http: { method: "POST", path: "/teams/:teamId/api-keys/:apiKeyId/revoke" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: [],
})
