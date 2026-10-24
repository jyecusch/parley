import { Schema } from "effect"
import { Permission } from "./access.ts"
import { ApiKeyId } from "./ids.ts"

const Timestamp = Schema.String.annotate({ description: "ISO 8601 timestamp" })

/** An API key as its owner sees it. The secret itself is shown once, at creation, and never again. */
export const ApiKey = Schema.Struct({
  id: ApiKeyId,
  name: Schema.String,
  /** The first characters of the key, so its owner can recognize it ("parley_a1b2"). */
  start: Schema.NullOr(Schema.String),
  scopes: Schema.Array(Permission),
  createdAt: Timestamp,
  expiresAt: Schema.NullOr(Timestamp),
  lastUsedAt: Schema.NullOr(Timestamp),
  revoked: Schema.Boolean,
})
export type ApiKey = typeof ApiKey.Type

export const CreatedApiKey = Schema.Struct({
  apiKey: ApiKey,
  /** The full key. Shown once; Parley stores only a hash. */
  secret: Schema.String,
})
export type CreatedApiKey = typeof CreatedApiKey.Type
