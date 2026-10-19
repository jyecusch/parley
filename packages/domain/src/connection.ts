import { Schema } from "effect"
import { Permission } from "./access.ts"
import { ConnectionId, UserId } from "./ids.ts"

const Timestamp = Schema.String.annotate({ description: "ISO 8601 timestamp" })

/** An agent someone authorized over OAuth, as the person who connected it sees it (D92). */
export const Connection = Schema.Struct({
  id: ConnectionId,
  /** The agent's own name, from its registration ("Claude", "Cursor"). */
  name: Schema.String,
  /** Who the agent acts as: the person who connected it, or a service account. */
  actsAs: Schema.Struct({
    userId: UserId,
    name: Schema.String,
    kind: Schema.Literals(["user", "service-account"]),
  }),
  scopes: Schema.Array(Permission),
  createdAt: Timestamp,
  /** Null until the agent finishes signing in. */
  authorizedAt: Schema.NullOr(Timestamp),
  lastUsedAt: Schema.NullOr(Timestamp),
  revoked: Schema.Boolean,
})
export type Connection = typeof Connection.Type
