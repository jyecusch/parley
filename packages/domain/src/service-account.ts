import { Schema } from "effect"
import { Role } from "./access.ts"
import { UserId } from "./ids.ts"

/** A non-human member of a team, which agents and API keys can act as (D18, D94). */
export const ServiceAccount = Schema.Struct({
  id: UserId,
  name: Schema.String,
  role: Role,
  /** Null when whoever created it has since been removed. */
  createdBy: Schema.NullOr(Schema.Struct({ userId: UserId, name: Schema.String })),
  /** Connections acting as it that finished signing in and haven't been revoked. */
  connectionCount: Schema.Number,
  createdAt: Schema.String.annotate({ description: "ISO 8601 timestamp" }),
})
export type ServiceAccount = typeof ServiceAccount.Type
