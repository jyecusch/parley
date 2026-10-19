import {
  ConnectionRequestInvalid,
  type createConnection,
  type listConnections,
  type OperationInput,
  type Permission,
  ROLE_PERMISSIONS,
  RoleLacksPermission,
  type revokeConnection,
  ServiceAccountRoleLacksPermission,
  SignInRequired,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveOwnConnection } from "../proofs/own-connection.ts"
import { named } from "../proofs/proof.ts"
import { proveServiceAccountInTeam } from "../proofs/service-account-in-team.ts"
import { Connections } from "../services/connections.ts"

const DEFAULT_SCOPES: ReadonlyArray<Permission> = ["records:read"]

export const list = (principal: Principal, input: OperationInput<typeof listConnections>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const connections = yield* Connections
      const member = yield* proveMemberOf(principal, team)
      return yield* connections.list(member)
    }),
  )

/** The OAuth client named in a sign-in request, if the request hasn't expired. */
const requestedClient = (request: string): string | undefined => {
  const params = new URLSearchParams(request.startsWith("?") ? request.slice(1) : request)
  const clientId = params.get("client_id")
  const expires = Number(params.get("exp"))
  if (!clientId || !Number.isFinite(expires) || expires * 1000 < Date.now()) return undefined
  return clientId
}

/**
 * Only a signed-in user connects an agent, so an agent can't connect more agents. A connection
 * can never carry a permission beyond the role of the person connecting it, or of the service
 * account it acts as (D94). The OAuth request's signature is checked by Better-Auth when the
 * consent page completes it; a mismatched client never gets a working token.
 */
export const create = (principal: Principal, input: OperationInput<typeof createConnection>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const session = principal.value
      if (session._tag !== "UserSession") return yield* new SignInRequired({ action: "connect an agent" })
      const connections = yield* Connections
      const member = yield* proveMemberOf(principal, team)
      const clientId = requestedClient(input.request)
      const name = clientId ? yield* connections.clientName(clientId) : undefined
      if (!clientId || !name) return yield* new ConnectionRequestInvalid()

      const scopes = [...new Set(input.scopes ?? DEFAULT_SCOPES)]
      const beyondRole = scopes.find((scope) => !member.rolePermissions.has(scope))
      if (beyondRole) {
        return yield* new RoleLacksPermission({ team: member.teamName, role: member.role, needed: beyondRole })
      }
      const common = { sessionId: session.sessionId, clientId, name, scopes }
      if (input.actsAs === undefined) return yield* connections.create(member, { ...common, serviceAccount: undefined })

      return yield* named(input.actsAs, (actsAs) =>
        Effect.gen(function* () {
          const serviceAccount = yield* proveServiceAccountInTeam(member, actsAs)
          const beyondServiceAccount = scopes.find((scope) => !ROLE_PERMISSIONS[serviceAccount.found.role].has(scope))
          if (beyondServiceAccount) {
            return yield* new ServiceAccountRoleLacksPermission({
              team: member.teamName,
              serviceAccount: DisplayName.fromRecord(serviceAccount.found.name),
              role: serviceAccount.found.role,
              needed: beyondServiceAccount,
            })
          }
          return yield* connections.create(member, { ...common, serviceAccount })
        }),
      )
    }),
  )

/** A connection may revoke itself; revoking any other takes the person, signed in. */
export const revoke = (principal: Principal, input: OperationInput<typeof revokeConnection>) =>
  named(principal, input.teamId, input.connectionId, (principal, team, connection) =>
    Effect.gen(function* () {
      const connections = yield* Connections
      const self =
        (principal.value._tag === "UserConnection" || principal.value._tag === "ServiceAccountConnection") &&
        principal.value.connectionId === input.connectionId
      if (principal.value._tag !== "UserSession" && !self) {
        return yield* new SignInRequired({ action: "revoke a connection" })
      }
      const member = yield* proveMemberOf(principal, team)
      const target = yield* proveOwnConnection(member, connection)
      return yield* connections.revoke(target)
    }),
  )
