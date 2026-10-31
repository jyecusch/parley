import {
  type Broadcast,
  type BroadcastId,
  BroadcastNotDraft,
  BroadcastNotFound,
  type DatabaseUnavailable,
  type TeamId,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { Broadcasts } from "../services/broadcasts.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const BroadcastInTeamProver = defineProof("BroadcastInTeam")
const BroadcastIsDraftProver = defineProof("BroadcastIsDraft")

/** Broadcast C belongs to team T. */
export interface BroadcastInTeam<C, T> extends Proof<"BroadcastInTeam", [C, T]> {
  readonly team: Named<T, TeamId>
  readonly broadcast: Named<C, BroadcastId>
  readonly found: Broadcast
}

/** Broadcast C hasn't been sent, so it can still change (R42). */
export interface BroadcastIsDraft<C> extends Proof<"BroadcastIsDraft", [C]> {}

export const proveBroadcastInTeam = <P, T, C>(
  member: MemberOf<P, T>,
  broadcast: Named<C, BroadcastId>,
): Effect.Effect<BroadcastInTeam<C, T>, BroadcastNotFound | DatabaseUnavailable, Broadcasts> =>
  Effect.gen(function* () {
    const broadcasts = yield* Broadcasts
    const found = yield* broadcasts.locate(member.team.value, broadcast.value)
    if (!found) return yield* new BroadcastNotFound({ team: member.teamName, broadcastId: broadcast.value })
    return BroadcastInTeamProver.prove([broadcast, member.team], { team: member.team, broadcast, found })
  })

export const proveBroadcastIsDraft = <C, T>(
  target: BroadcastInTeam<C, T>,
): Effect.Effect<BroadcastIsDraft<C>, BroadcastNotDraft> =>
  target.found.status === "draft"
    ? Effect.succeed(BroadcastIsDraftProver.prove([target.broadcast]))
    : Effect.fail(
        new BroadcastNotDraft({ broadcast: DisplayName.fromRecord(target.found.name), status: target.found.status }),
      )
