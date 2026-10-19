import { type Connection, type ConnectionId, ConnectionNotFound, type DatabaseUnavailable } from "@parley/domain"
import { Effect } from "effect"
import { Connections } from "../services/connections.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const OwnConnectionProver = defineProof("OwnConnection")

/** Connection C was made by principal P, in team T. */
export interface OwnConnection<P, T, C> extends Proof<"OwnConnection", [P, T, C]> {
  readonly member: MemberOf<P, T>
  readonly connection: Named<C, ConnectionId>
  readonly found: Connection
}

/** Someone else's connection, or one in another team, is simply not found: no oracle. */
export const proveOwnConnection = <P, T, C>(
  member: MemberOf<P, T>,
  connection: Named<C, ConnectionId>,
): Effect.Effect<OwnConnection<P, T, C>, ConnectionNotFound | DatabaseUnavailable, Connections> =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const found = yield* connections.locateOwn(member, connection.value)
    if (!found) return yield* new ConnectionNotFound({ connectionId: connection.value })
    return { ...OwnConnectionProver.prove(member.principal, member.team, connection), member, connection, found }
  })
