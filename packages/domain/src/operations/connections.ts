import { Schema } from "effect"
import { Permission } from "../access.ts"
import { Connection } from "../connection.ts"
import { SignInRequired } from "../errors/access.ts"
import { ConnectionNotFound, ConnectionRequestInvalid } from "../errors/connections.ts"
import { ServiceAccountNotFound } from "../errors/service-accounts.ts"
import { ConnectionId, TeamId, UserId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }

export const listConnections = defineTeamOperation({
  name: "connections.list",
  description:
    "List the agents you connected to a team over OAuth, newest first, with who each acts as and what it may do.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(Connection),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/connections" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: [],
})

export const createConnection = defineTeamOperation({
  name: "connections.create",
  description:
    "Approve an agent's OAuth sign-in request: bind it to this team, acting as you or as a service account, limited to its scopes (read-only unless you add more). Used by the consent page. Only a signed-in user can do this.",
  input: Schema.Struct({
    ...InTeam,
    request: Schema.String.check(Schema.isMinLength(1)).annotate({
      title: "Connection request",
      description: "The query string Parley's consent page was opened with.",
    }),
    actsAs: Schema.optional(
      UserId.annotate({
        title: "Acts as",
        description: "A service account's id, from serviceAccounts.list. Omit for the agent to act as you.",
      }),
    ),
    scopes: Schema.optional(
      Schema.Array(Permission)
        .check(Schema.isMinLength(1))
        .annotate({ title: "Scopes", description: 'Defaults to ["records:read"].' }),
    ),
  }),
  output: Connection,
  errors: [SignInRequired, ConnectionRequestInvalid, ServiceAccountNotFound],
  http: { method: "POST", path: "/teams/:teamId/connections" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: [],
})

export const revokeConnection = defineTeamOperation({
  name: "connections.revoke",
  description:
    "Revoke a connection you made. The agent stops working immediately. Revoking a revoked connection does nothing.",
  input: Schema.Struct({
    ...InTeam,
    connectionId: ConnectionId.annotate({ description: "The connection's id, from connections.list." }),
  }),
  output: Connection,
  errors: [SignInRequired, ConnectionNotFound],
  http: { method: "POST", path: "/teams/:teamId/connections/:connectionId/revoke" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: [],
})
