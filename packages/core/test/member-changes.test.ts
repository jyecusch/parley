import { describe, expect, it } from "@effect/vitest"
import { Database, schema } from "@parley/db"
import { and, eq, sql } from "drizzle-orm"
import { Deferred, Effect, Fiber } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { MemberChanges } from "../src/services/member-changes.ts"
import { Fixture } from "./fixture.ts"

const waitForBlockedBy = (pid: number) =>
  Effect.gen(function* () {
    const db = yield* Database
    for (;;) {
      const [state] = yield* db.query((d) =>
        d
          .select({
            blocked: sql<boolean>`exists(select 1 from pg_stat_activity a where ${pid} = any(pg_blocking_pids(a.pid)))`,
          })
          .from(schema.organization)
          .limit(1),
      )
      if (state?.blocked) return
      yield* Effect.sleep("10 millis")
    }
  }).pipe(Effect.timeout("5 seconds"), Effect.orDie)

describe("concurrent member changes", () => {
  for (const change of ["demote principal", "remove principal", "promote target"] as const) {
    for (const operation of ["members.update", "members.remove", "serviceAccounts.update"] as const) {
      if (change === "promote target" && operation === "serviceAccounts.update") continue
      it.live(`${operation} rechecks authorization after a concurrent ${change}`, () =>
        Effect.gen(function* () {
          const f = yield* Fixture
          const db = yield* Database
          yield* run["members.update"](f.jane, { teamId: f.acme, userId: f.sam.userId, role: "admin" })
          yield* db
            .query((d) =>
              d.insert(schema.member).values({
                id: crypto.randomUUID(),
                organizationId: f.acme,
                userId: f.bob.userId,
                role: "member",
                createdAt: new Date(),
              }),
            )
            .pipe(Effect.orDie)

          const bot =
            operation === "serviceAccounts.update"
              ? yield* run["serviceAccounts.create"](f.jane, { teamId: f.acme, name: "Import bot" })
              : undefined
          const locked = yield* Deferred.make<number>()
          const release = yield* Deferred.make<void>()
          const first = yield* db
            .transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .select({ id: schema.organization.id })
                    .from(schema.organization)
                    .where(eq(schema.organization.id, f.acme))
                    .for("update"),
                )
                // Member-row locks also hold a request that checks permissions before acquiring the team lock.
                yield* db.query((d) =>
                  d
                    .select({ id: schema.member.id })
                    .from(schema.member)
                    .where(eq(schema.member.organizationId, f.acme))
                    .for("update"),
                )
                if (change === "remove principal") {
                  yield* db.query((d) =>
                    d
                      .delete(schema.member)
                      .where(and(eq(schema.member.organizationId, f.acme), eq(schema.member.userId, f.sam.userId))),
                  )
                } else {
                  yield* db.query((d) =>
                    d
                      .update(schema.member)
                      .set({ role: change === "promote target" ? "owner" : "member" })
                      .where(
                        and(
                          eq(schema.member.organizationId, f.acme),
                          eq(schema.member.userId, change === "promote target" ? f.bob.userId : f.sam.userId),
                        ),
                      ),
                  )
                }
                const [connection] = yield* db.query((d) =>
                  d
                    .select({ pid: sql<number>`pg_backend_pid()` })
                    .from(schema.organization)
                    .where(eq(schema.organization.id, f.acme))
                    .limit(1),
                )
                if (!connection) return yield* Effect.die("missing transaction connection")
                yield* Deferred.succeed(locked, connection.pid)
                yield* Deferred.await(release)
              }),
            )
            .pipe(Effect.orDie, Effect.forkScoped)
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
          const pid = yield* Deferred.await(locked)

          const request = Effect.gen(function* () {
            if (bot)
              return yield* run["serviceAccounts.update"](f.sam, {
                teamId: f.acme,
                serviceAccountId: bot.id,
                role: "admin",
              })
            if (operation === "members.update")
              return yield* run["members.update"](f.sam, { teamId: f.acme, userId: f.bob.userId, role: "admin" })
            return yield* run["members.remove"](f.sam, { teamId: f.acme, userId: f.bob.userId })
          })
          const second = yield* request.pipe(Effect.result, Effect.forkScoped)

          yield* waitForBlockedBy(pid).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
          yield* Fiber.join(first)
          const outcome = yield* Fiber.join(second)
          expect(outcome).toMatchObject({
            _tag: "Failure",
            failure: {
              _tag:
                change === "remove principal"
                  ? "NotATeamMember"
                  : change === "promote target"
                    ? "OwnerChangeNeedsOwner"
                    : "RoleLacksPermission",
            },
          })
          if (bot) {
            const accounts = yield* run["serviceAccounts.list"](f.jane, { teamId: f.acme })
            expect(accounts.find((account) => account.id === bot.id)?.role).toBe("member")
          }
          const people = yield* run["members.list"](f.jane, { teamId: f.acme })
          expect(people.find((member) => member.userId === f.bob.userId)?.role).toBe(
            change === "promote target" ? "owner" : "member",
          )
        }).pipe(Effect.provide(CoreLive)),
      )
    }
  }

  it.live("concurrent owners cannot both give up ownership", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      yield* run["members.update"](f.jane, { teamId: f.acme, userId: f.sam.userId, role: "owner" })
      const outcomes = yield* Effect.all(
        [f.jane, f.sam].map((principal) =>
          run["members.update"](principal, { teamId: f.acme, userId: principal.userId, role: "admin" }).pipe(
            Effect.result,
          ),
        ),
        { concurrency: "unbounded" },
      )
      expect(outcomes.filter((outcome) => outcome._tag === "Success")).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome._tag === "Failure")).toMatchObject([
        { failure: { _tag: "LastOwner" } },
      ])
      const people = yield* run["members.list"](f.jane, { teamId: f.acme })
      expect(people.filter((member) => member.role === "owner")).toHaveLength(1)
    }).pipe(Effect.provide(CoreLive)),
  )

  for (const change of ["revoke", "lower role"] as const) {
    it.live(`invitation acceptance rechecks a concurrent ${change}`, () =>
      Effect.gen(function* () {
        const f = yield* Fixture
        const db = yield* Database
        const [recipient] = yield* db
          .query((d) =>
            d.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, f.bob.userId)),
          )
          .pipe(Effect.orDie)
        if (!recipient) return yield* Effect.die("missing invited user")
        const invitation = yield* run["invitations.create"](f.jane, {
          teamId: f.acme,
          email: recipient.email as never,
          role: "owner",
        })
        const locked = yield* Deferred.make<number>()
        const release = yield* Deferred.make<void>()
        const first = yield* db
          .transaction(
            Effect.gen(function* () {
              yield* db.query((d) =>
                d
                  .select({ id: schema.organization.id })
                  .from(schema.organization)
                  .where(eq(schema.organization.id, f.acme))
                  .for("update"),
              )
              yield* db.query((d) =>
                d
                  .update(schema.invitation)
                  .set(change === "revoke" ? { status: "revoked" } : { role: "member" })
                  .where(eq(schema.invitation.id, invitation.id)),
              )
              const [connection] = yield* db.query((d) =>
                d
                  .select({ pid: sql<number>`pg_backend_pid()` })
                  .from(schema.organization)
                  .where(eq(schema.organization.id, f.acme)),
              )
              if (!connection) return yield* Effect.die("missing transaction connection")
              yield* Deferred.succeed(locked, connection.pid)
              yield* Deferred.await(release)
            }),
          )
          .pipe(Effect.orDie, Effect.forkScoped)
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        const pid = yield* Deferred.await(locked)
        const second = yield* run["invitations.accept"](f.bob, { invitationId: invitation.id }).pipe(
          Effect.result,
          Effect.forkScoped,
        )
        yield* waitForBlockedBy(pid).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
        yield* Fiber.join(first)
        const outcome = yield* Fiber.join(second)
        if (change === "revoke") {
          expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "InvitationNotFound" } })
        } else {
          expect(outcome).toMatchObject({ _tag: "Success", success: { role: "member" } })
        }
        const people = yield* run["members.list"](f.jane, { teamId: f.acme })
        expect(people.find((member) => member.userId === f.bob.userId)?.role).toBe(
          change === "revoke" ? undefined : "member",
        )
      }).pipe(Effect.provide(CoreLive)),
    )
  }

  it.live("a member change in one team does not block another team", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const changes = yield* MemberChanges
      const locked = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const first = yield* changes
        .inTeam(f.acme, () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(locked, undefined)
            yield* Deferred.await(release)
          }),
        )
        .pipe(Effect.forkScoped)
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
      yield* Deferred.await(locked)
      const other = yield* run["members.update"](f.bob, { teamId: f.globex, userId: f.bob.userId, role: "owner" }).pipe(
        Effect.timeout("2 seconds"),
        Effect.ensuring(Deferred.succeed(release, undefined)),
      )
      yield* Fiber.join(first)
      expect(other.role).toBe("owner")
    }).pipe(Effect.provide(CoreLive)),
  )
})
