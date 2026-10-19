import { Database, schema } from "@parley/db"
import type { Connection, ConnectionId, DatabaseUnavailable, Permission, TeamId, UserId } from "@parley/domain"
import { ROLE_PERMISSIONS } from "@parley/domain"
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Context, Effect, Layer } from "effect"
import type { MemberOf } from "../proofs/member-of.ts"
import type { OwnConnection } from "../proofs/own-connection.ts"
import type { ServiceAccountInTeam } from "../proofs/service-account-in-team.ts"
import { classifySqlError } from "./sql-errors.ts"

const PERMISSIONS = new Set<string>(ROLE_PERMISSIONS.owner)
const scopesOf = (scopes: ReadonlyArray<string>) =>
  scopes.filter((scope): scope is Permission => PERMISSIONS.has(scope))

const actsAs = alias(schema.user, "acts_as")

const columns = {
  connection: schema.connections,
  actsAsName: actsAs.name,
  actsAsKind: actsAs.kind,
}

type Row = {
  readonly connection: typeof schema.connections.$inferSelect
  readonly actsAsName: string
  readonly actsAsKind: string | null
}

const summarize = ({ connection, actsAsName, actsAsKind }: Row): Connection => ({
  id: connection.id as ConnectionId,
  name: connection.name,
  actsAs: {
    userId: connection.actsAsUserId as UserId,
    name: actsAsName,
    kind: actsAsKind === "service-account" ? "service-account" : "user",
  },
  scopes: scopesOf(connection.scopes),
  createdAt: connection.createdAt.toISOString(),
  authorizedAt: connection.authorizedAt?.toISOString() ?? null,
  lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
  revoked: connection.revokedAt !== null,
})

/** What authentication needs to know about the connection an access token names. */
export interface ConnectionGrant {
  readonly id: ConnectionId
  readonly name: string
  readonly teamId: TeamId
  readonly clientId: string
  readonly connectedByUserId: UserId
  readonly actsAs: { readonly userId: UserId; readonly name: string; readonly kind: "user" | "service-account" }
  readonly scopes: ReadonlySet<Permission>
  readonly revoked: boolean
}

/** Agents people connected over OAuth (D92). Better-Auth runs the OAuth flow; this records what was agreed. */
export class Connections extends Context.Service<
  Connections,
  {
    readonly list: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<Connection>, DatabaseUnavailable>
    /** Used only by the OwnConnection prover. */
    readonly locateOwn: <P, T>(
      member: MemberOf<P, T>,
      connectionId: ConnectionId,
    ) => Effect.Effect<Connection | undefined, DatabaseUnavailable>
    /** The registered name of an OAuth client, or undefined if Parley doesn't know it. */
    readonly clientName: (clientId: string) => Effect.Effect<string | undefined, DatabaseUnavailable>
    /**
     * Records a pending connection for this sign-in session. Better-Auth picks it up as the
     * consent's reference, and the first access token makes it authorized.
     */
    readonly create: <P, T, S>(
      member: MemberOf<P, T>,
      input: {
        readonly sessionId: string
        readonly clientId: string
        readonly name: string
        readonly scopes: ReadonlyArray<Permission>
        readonly serviceAccount: ServiceAccountInTeam<P, T, S> | undefined
      },
    ) => Effect.Effect<Connection, DatabaseUnavailable>
    readonly revoke: <P, T, C>(target: OwnConnection<P, T, C>) => Effect.Effect<Connection, DatabaseUnavailable>
    /** Used only by the Authenticator. */
    readonly grant: (connectionId: string) => Effect.Effect<ConnectionGrant | undefined, DatabaseUnavailable>
    /** Records use, at most once a minute per connection. */
    readonly touch: (connectionId: ConnectionId) => Effect.Effect<void, DatabaseUnavailable>
  }
>()("@parley/core/Connections") {
  static readonly layer = Layer.effect(
    Connections,
    Effect.gen(function* () {
      const db = yield* Database

      const select = (where: ReturnType<typeof and>) =>
        db
          .query((d) =>
            d
              .select(columns)
              .from(schema.connections)
              .innerJoin(actsAs, eq(actsAs.id, schema.connections.actsAsUserId))
              .where(where)
              .orderBy(desc(schema.connections.createdAt)),
          )
          .pipe(Effect.catchTag("SqlError", classifySqlError))

      const own = <P, T>(member: MemberOf<P, T>) =>
        and(
          eq(schema.connections.teamId, member.team.value),
          eq(schema.connections.connectedByUserId, member.principal.value.userId),
        )

      const list = <P, T>(member: MemberOf<P, T>) =>
        Effect.map(select(own(member)), (rows) => rows.map(summarize)).pipe(Effect.withSpan("Connections.list"))

      const locateOwn = <P, T>(member: MemberOf<P, T>, connectionId: ConnectionId) =>
        Effect.map(select(and(own(member), eq(schema.connections.id, connectionId))), ([row]) =>
          row ? summarize(row) : undefined,
        ).pipe(Effect.withSpan("Connections.locateOwn"))

      const clientName = Effect.fn("Connections.clientName")(function* (clientId: string) {
        const [row] = yield* db
          .query((d) =>
            d
              .select({ name: schema.oauthClient.name, disabled: schema.oauthClient.disabled })
              .from(schema.oauthClient)
              .where(eq(schema.oauthClient.clientId, clientId))
              .limit(1),
          )
          .pipe(Effect.catchTag("SqlError", classifySqlError))
        if (!row || row.disabled) return undefined
        return row.name?.trim() || "Agent"
      })

      const byId = (connectionId: string) =>
        Effect.map(select(and(eq(schema.connections.id, connectionId))), ([row]) => {
          if (!row) return Effect.die(`connection ${connectionId} vanished`)
          return Effect.succeed(summarize(row))
        }).pipe(Effect.flatten)

      const create = <P, T, S>(
        member: MemberOf<P, T>,
        input: {
          readonly sessionId: string
          readonly clientId: string
          readonly name: string
          readonly scopes: ReadonlyArray<Permission>
          readonly serviceAccount: ServiceAccountInTeam<P, T, S> | undefined
        },
      ) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const userId = member.principal.value.userId
          yield* db
            .query((d) =>
              d.insert(schema.connections).values({
                id,
                teamId: member.team.value,
                clientId: input.clientId,
                name: input.name,
                connectedByUserId: userId,
                actsAsUserId: input.serviceAccount?.serviceAccount.value ?? userId,
                scopes: [...input.scopes],
                sessionId: input.sessionId,
              }),
            )
            .pipe(Effect.catchTag("SqlError", classifySqlError))
          return yield* byId(id)
        }).pipe(Effect.withSpan("Connections.create"))

      const revoke = <P, T, C>(target: OwnConnection<P, T, C>) =>
        Effect.gen(function* () {
          if (!target.found.revoked) {
            yield* db
              .query((d) =>
                d
                  .update(schema.connections)
                  .set({ revokedAt: new Date() })
                  .where(and(eq(schema.connections.id, target.connection.value), isNull(schema.connections.revokedAt))),
              )
              .pipe(Effect.catchTag("SqlError", classifySqlError))
          }
          return yield* byId(target.connection.value)
        }).pipe(Effect.withSpan("Connections.revoke"))

      const grant = Effect.fn("Connections.grant")(function* (connectionId: string) {
        // Not a uuid: not ours. Checked here so a forged claim can't reach the query as a cast error.
        if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return undefined
        const [row] = yield* select(and(eq(schema.connections.id, connectionId)))
        if (!row) return undefined
        const summary = summarize(row)
        return {
          id: summary.id,
          name: summary.name,
          teamId: row.connection.teamId as TeamId,
          clientId: row.connection.clientId,
          connectedByUserId: row.connection.connectedByUserId as UserId,
          actsAs: summary.actsAs,
          scopes: new Set(summary.scopes),
          revoked: summary.revoked,
        } satisfies ConnectionGrant
      })

      const touch = Effect.fn("Connections.touch")(function* (connectionId: ConnectionId) {
        yield* db
          .query((d) =>
            d
              .update(schema.connections)
              .set({ lastUsedAt: new Date() })
              .where(
                and(
                  eq(schema.connections.id, connectionId),
                  or(
                    isNull(schema.connections.lastUsedAt),
                    lt(schema.connections.lastUsedAt, sql`now() - interval '1 minute'`),
                  ),
                ),
              ),
          )
          .pipe(Effect.catchTag("SqlError", classifySqlError))
      })

      return { list, locateOwn, clientName, create, revoke, grant, touch }
    }),
  )
}
