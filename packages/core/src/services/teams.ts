import type { Team, TeamId, UserId } from "@parley/domain"
import { Context, Effect, Layer } from "effect"
import { BetterAuth } from "../auth/authenticator.ts"

const slugOf = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "team"
  }-${crypto.randomUUID().slice(0, 6)}`

/** Creates teams through Better-Auth's server API, where its client-facing route is disabled (D17). */
export class Teams extends Context.Service<
  Teams,
  { readonly create: (owner: UserId, name: string) => Effect.Effect<Team> }
>()("@parley/core/Teams") {
  static readonly layer = Layer.effect(
    Teams,
    Effect.gen(function* () {
      const auth = yield* BetterAuth
      const create = Effect.fn("Teams.create")(function* (owner: UserId, name: string) {
        const team = yield* Effect.tryPromise(() =>
          auth.api.createOrganization({ body: { name, slug: slugOf(name), userId: owner } }),
        ).pipe(Effect.orDie)
        if (!team) return yield* Effect.die("Better-Auth returned no team")
        return { id: team.id as TeamId, name, role: "owner" } satisfies Team
      })
      return { create }
    }),
  )
}
