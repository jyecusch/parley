import { Database, schema } from "@parley/db"
import {
  AlreadyAMember,
  type DatabaseUnavailable,
  type Invitation,
  InvitationExpired,
  InvitationForAnotherEmail,
  type InvitationId,
  InvitationNotFound,
  type Team,
  type TeamId,
  type UserId,
} from "@parley/domain"
import { EchoedInput } from "@parley/errors"
import { and, desc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { PublicUrl } from "../config/public-url.ts"
import type { OutgoingEmail } from "../mail/mailer.ts"
import { renderInvitation } from "../mail/templates.ts"
import type { MemberInvitable } from "../proofs/member-changes.ts"
import type { CanManageMembers } from "../proofs/permissions.ts"
import { MemberChanges, type MemberTransaction } from "./member-changes.ts"
import { isRole } from "./members.ts"
import { classifySqlError } from "./sql-errors.ts"

/** How long an invitation link works. */
const VALID_DAYS = 7

type Row = {
  readonly invitation: typeof schema.invitation.$inferSelect
  readonly teamName: string
  readonly inviterName: string | null
}

const statusOf = (row: Row["invitation"]): Invitation["status"] => {
  if (row.status === "accepted" || row.status === "revoked" || row.status === "canceled") {
    return row.status === "canceled" ? "revoked" : row.status
  }
  // Better-Auth's word for an invitation its recipient turned down.
  if (row.status === "rejected") return "declined"
  return row.expiresAt.getTime() < Date.now() ? "expired" : "pending"
}

const summarize = ({ invitation, teamName, inviterName }: Row): Invitation => ({
  id: invitation.id as InvitationId,
  email: invitation.email,
  role: invitation.role && isRole(invitation.role) ? invitation.role : "member",
  status: statusOf(invitation),
  invitedBy: inviterName,
  teamName,
  createdAt: invitation.createdAt.toISOString(),
  expiresAt: invitation.expiresAt.toISOString(),
})

/** Invitations to join a team, by email (stored in Better-Auth's invitation table). */
export class Invitations extends Context.Service<
  Invitations,
  {
    readonly list: <P, T>(
      access: CanManageMembers<P, T>,
    ) => Effect.Effect<ReadonlyArray<Invitation>, DatabaseUnavailable>
    readonly create: <P, T>(
      transaction: MemberTransaction<T>,
      access: MemberInvitable<P, T>,
      email: string,
    ) => Effect.Effect<
      { readonly invitation: Invitation; readonly email: OutgoingEmail },
      AlreadyAMember | DatabaseUnavailable
    >
    readonly revoke: <P, T>(
      transaction: MemberTransaction<T>,
      access: CanManageMembers<P, T>,
      invitationId: InvitationId,
    ) => Effect.Effect<Invitation, InvitationNotFound | DatabaseUnavailable>
    /** For the person it was sent to: their email must match. */
    readonly forRecipient: (
      invitationId: InvitationId,
      email: string,
    ) => Effect.Effect<Invitation, InvitationNotFound | InvitationForAnotherEmail | DatabaseUnavailable>
    /** Invitations still open to this address, newest first (D131). */
    readonly pendingFor: (email: string) => Effect.Effect<ReadonlyArray<Invitation>, DatabaseUnavailable>
    /** The recipient turns it down (D131). Only a pending invitation can be declined. */
    readonly decline: (
      invitationId: InvitationId,
      email: string,
    ) => Effect.Effect<Invitation, InvitationNotFound | InvitationForAnotherEmail | DatabaseUnavailable>
    readonly accept: (
      invitationId: InvitationId,
      user: { readonly id: UserId; readonly email: string },
    ) => Effect.Effect<Team, InvitationNotFound | InvitationExpired | InvitationForAnotherEmail | DatabaseUnavailable>
  }
>()("@parley/core/Invitations") {
  static readonly layer = Layer.effect(
    Invitations,
    Effect.gen(function* () {
      const db = yield* Database
      const changes = yield* MemberChanges
      const baseURL = yield* PublicUrl.pipe(Effect.orDie)
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const select = (where: ReturnType<typeof and>) =>
        run(
          db.query((d) =>
            d
              .select({
                invitation: schema.invitation,
                teamName: schema.organization.name,
                inviterName: schema.user.name,
              })
              .from(schema.invitation)
              .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
              .leftJoin(schema.user, eq(schema.user.id, schema.invitation.inviterId))
              .where(where)
              .orderBy(desc(schema.invitation.createdAt)),
          ),
        )

      const byId = (id: string) =>
        Effect.flatMap(select(and(eq(schema.invitation.id, id))), ([row]) =>
          row ? Effect.succeed(row) : Effect.die(`invitation ${id} vanished`),
        )

      const list = <P, T>(access: CanManageMembers<P, T>) =>
        Effect.map(
          select(
            and(
              eq(schema.invitation.organizationId, access.member.team.value),
              eq(schema.invitation.status, "pending"),
            ),
          ),
          (rows) => rows.map(summarize).filter((invitation) => invitation.status === "pending"),
        )

      const create = <P, T>(transaction: MemberTransaction<T>, access: MemberInvitable<P, T>, rawEmail: string) =>
        Effect.gen(function* () {
          const role = access.role
          const email = rawEmail.trim().toLowerCase()
          const teamId = transaction.team.value
          const [existingMember] = yield* run(
            db.query((d) =>
              d
                .select({ userId: schema.member.userId })
                .from(schema.member)
                .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
                .where(and(eq(schema.member.organizationId, teamId), sql`lower(${schema.user.email}) = ${email}`)),
            ),
          )
          if (existingMember) {
            return yield* new AlreadyAMember({ team: access.member.teamName, email: EchoedInput.fromRequest(email) })
          }
          const expiresAt = new Date(Date.now() + VALID_DAYS * 86_400_000)
          const [pending] = yield* select(
            and(
              eq(schema.invitation.organizationId, teamId),
              eq(schema.invitation.status, "pending"),
              sql`lower(${schema.invitation.email}) = ${email}`,
            ),
          )
          const inviterId = access.member.principal.value.userId
          const id = pending?.invitation.id ?? crypto.randomUUID()
          // Inviting the same address again refreshes the invitation and sends a fresh link.
          yield* run(
            pending
              ? db.query((d) =>
                  d.update(schema.invitation).set({ role, expiresAt, inviterId }).where(eq(schema.invitation.id, id)),
                )
              : db.query((d) =>
                  d.insert(schema.invitation).values({ id, organizationId: teamId, email, role, expiresAt, inviterId }),
                ),
          )
          const invitation = summarize(yield* byId(id))
          const message = renderInvitation({
            inviterName: access.member.principal.value.name,
            teamName: invitation.teamName,
            link: `${baseURL}/invite/${id}`,
            validDays: VALID_DAYS,
          })
          return { invitation, email: { to: email, ...message } }
        }).pipe(Effect.withSpan("Invitations.create"))

      const revoke = <P, T>(
        transaction: MemberTransaction<T>,
        _access: CanManageMembers<P, T>,
        invitationId: InvitationId,
      ) =>
        Effect.gen(function* () {
          const [row] = yield* select(
            and(
              eq(schema.invitation.organizationId, transaction.team.value),
              sql`${schema.invitation.id} = ${invitationId}`,
            ),
          )
          if (row?.invitation.status !== "pending") return yield* new InvitationNotFound({ invitationId })
          yield* run(
            db.query((d) =>
              d.update(schema.invitation).set({ status: "revoked" }).where(eq(schema.invitation.id, invitationId)),
            ),
          )
          return summarize(yield* byId(invitationId))
        })

      const forRecipientRow = (invitationId: InvitationId, email: string) =>
        Effect.gen(function* () {
          const [row] = yield* select(and(sql`${schema.invitation.id} = ${invitationId}`))
          if (!row || row.invitation.status === "revoked" || row.invitation.status === "canceled") {
            return yield* new InvitationNotFound({ invitationId })
          }
          if (row.invitation.email.toLowerCase() !== email.toLowerCase()) {
            return yield* new InvitationForAnotherEmail()
          }
          return row
        })

      const forRecipient = (invitationId: InvitationId, email: string) =>
        Effect.map(forRecipientRow(invitationId, email), summarize)

      const pendingFor = (email: string) =>
        Effect.map(
          select(
            and(
              eq(schema.invitation.status, "pending"),
              sql`lower(${schema.invitation.email}) = ${email.toLowerCase()}`,
            ),
          ),
          (rows) => rows.map(summarize).filter((invitation) => invitation.status === "pending"),
        )

      const decline = (invitationId: InvitationId, email: string) =>
        Effect.gen(function* () {
          const routing = yield* forRecipientRow(invitationId, email)
          return yield* changes.inTeam(routing.invitation.organizationId as TeamId, () =>
            Effect.gen(function* () {
              const invitation = yield* forRecipient(invitationId, email)
              if (invitation.status !== "pending") return yield* new InvitationNotFound({ invitationId })
              yield* run(
                db.query((d) =>
                  d.update(schema.invitation).set({ status: "rejected" }).where(eq(schema.invitation.id, invitationId)),
                ),
              )
              return summarize(yield* byId(invitationId))
            }),
          )
        })

      const accept = (invitationId: InvitationId, user: { readonly id: UserId; readonly email: string }) =>
        Effect.gen(function* () {
          const routing = yield* forRecipientRow(invitationId, user.email)
          return yield* changes.inTeam(routing.invitation.organizationId as TeamId, (transaction) =>
            Effect.gen(function* () {
              const invitation = yield* forRecipient(invitationId, user.email)
              if (invitation.status !== "pending") {
                return yield* new InvitationExpired({ used: invitation.status === "accepted" })
              }
              const teamId = transaction.team.value
              const [already] = yield* run(
                db.query((d) =>
                  d
                    .select({ id: schema.member.id })
                    .from(schema.member)
                    .where(and(eq(schema.member.organizationId, teamId), eq(schema.member.userId, user.id))),
                ),
              )
              if (!already) {
                yield* run(
                  db.query((d) =>
                    d.insert(schema.member).values({
                      id: crypto.randomUUID(),
                      organizationId: teamId,
                      userId: user.id,
                      role: invitation.role,
                      createdAt: new Date(),
                    }),
                  ),
                )
              }
              yield* run(
                db.query((d) =>
                  d.update(schema.invitation).set({ status: "accepted" }).where(eq(schema.invitation.id, invitationId)),
                ),
              )
              const [settings] = yield* run(
                db.query((d) => d.select().from(schema.teamSettings).where(eq(schema.teamSettings.teamId, teamId))),
              )
              return {
                id: teamId,
                name: invitation.teamName,
                role: invitation.role,
                gravatar: settings?.gravatar ?? false,
              } satisfies Team
            }),
          )
        }).pipe(Effect.withSpan("Invitations.accept"))

      return { list, create, revoke, forRecipient, pendingFor, decline, accept }
    }),
  )
}
