import { Database, schema } from "@parley/db"
import {
  AlreadyAMember,
  type DatabaseUnavailable,
  type EmailError,
  type Invitation,
  InvitationExpired,
  InvitationForAnotherEmail,
  type InvitationId,
  InvitationNotFound,
  type Role,
  type Team,
  type TeamId,
  type UserId,
} from "@parley/domain"
import { EchoedInput } from "@parley/errors"
import { and, desc, eq, sql } from "drizzle-orm"
import { Config, Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { Mailer } from "../mail/mailer.ts"
import { renderInvitation } from "../mail/templates.ts"
import type { CanManageMembers } from "../proofs/permissions.ts"
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
      access: CanManageMembers<P, T>,
      email: string,
      role: Role,
    ) => Effect.Effect<Invitation, AlreadyAMember | EmailError | DatabaseUnavailable>
    readonly revoke: <P, T>(
      access: CanManageMembers<P, T>,
      invitationId: InvitationId,
    ) => Effect.Effect<Invitation, InvitationNotFound | DatabaseUnavailable>
    /** For the person it was sent to: their email must match. */
    readonly forRecipient: (
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
      const mailer = yield* Mailer
      const baseURL = yield* Config.String("BETTER_AUTH_URL").pipe(Effect.orDie)
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

      const create = <P, T>(access: CanManageMembers<P, T>, rawEmail: string, role: Role) =>
        Effect.gen(function* () {
          const email = rawEmail.trim().toLowerCase()
          const teamId: TeamId = access.member.team.value
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
          yield* mailer.send({ to: email, ...message })
          return invitation
        }).pipe(Effect.withSpan("Invitations.create"))

      const revoke = <P, T>(access: CanManageMembers<P, T>, invitationId: InvitationId) =>
        Effect.gen(function* () {
          const [row] = yield* select(
            and(
              eq(schema.invitation.organizationId, access.member.team.value),
              sql`${schema.invitation.id} = ${invitationId}`,
            ),
          )
          if (!row || row.invitation.status !== "pending") return yield* new InvitationNotFound({ invitationId })
          yield* run(
            db.query((d) =>
              d.update(schema.invitation).set({ status: "revoked" }).where(eq(schema.invitation.id, invitationId)),
            ),
          )
          return summarize(yield* byId(invitationId))
        })

      const forRecipient = (invitationId: InvitationId, email: string) =>
        Effect.gen(function* () {
          const [row] = yield* select(and(sql`${schema.invitation.id} = ${invitationId}`))
          if (!row || row.invitation.status === "revoked" || row.invitation.status === "canceled") {
            return yield* new InvitationNotFound({ invitationId })
          }
          if (row.invitation.email.toLowerCase() !== email.toLowerCase()) {
            return yield* new InvitationForAnotherEmail()
          }
          return summarize(row)
        })

      const accept = (invitationId: InvitationId, user: { readonly id: UserId; readonly email: string }) =>
        Effect.gen(function* () {
          const invitation = yield* forRecipient(invitationId, user.email)
          if (invitation.status !== "pending") {
            return yield* new InvitationExpired({ used: invitation.status === "accepted" })
          }
          const [row] = yield* select(and(sql`${schema.invitation.id} = ${invitationId}`))
          const teamId = row?.invitation.organizationId ?? ""
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                const [already] = yield* db.query((d) =>
                  d
                    .select({ id: schema.member.id })
                    .from(schema.member)
                    .where(and(eq(schema.member.organizationId, teamId), eq(schema.member.userId, user.id))),
                )
                if (!already) {
                  yield* db.query((d) =>
                    d.insert(schema.member).values({
                      id: crypto.randomUUID(),
                      organizationId: teamId,
                      userId: user.id,
                      role: invitation.role,
                      createdAt: new Date(),
                    }),
                  )
                }
                yield* db.query((d) =>
                  d.update(schema.invitation).set({ status: "accepted" }).where(eq(schema.invitation.id, invitationId)),
                )
              }),
            ),
          )
          const [settings] = yield* run(
            db.query((d) => d.select().from(schema.teamSettings).where(eq(schema.teamSettings.teamId, teamId))),
          )
          return {
            id: teamId as TeamId,
            name: invitation.teamName,
            role: invitation.role,
            gravatar: settings?.gravatar ?? false,
          } satisfies Team
        }).pipe(Effect.withSpan("Invitations.accept"))

      return { list, create, revoke, forRecipient, accept }
    }),
  )
}
