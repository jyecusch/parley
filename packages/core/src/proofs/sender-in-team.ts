import { type DatabaseUnavailable, type Sender, type SenderId, SenderNotFound, type TeamId } from "@parley/domain"
import { Effect } from "effect"
import { Sending } from "../services/sending.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const SenderInTeamProver = defineProof("SenderInTeam")

/** Sender S belongs to team T. */
export interface SenderInTeam<S, T> extends Proof<"SenderInTeam", [S, T]> {
  readonly team: Named<T, TeamId>
  readonly sender: Named<S, SenderId>
  readonly found: Sender
}

export const proveSenderInTeam = <P, T, S>(
  member: MemberOf<P, T>,
  sender: Named<S, SenderId>,
): Effect.Effect<SenderInTeam<S, T>, SenderNotFound | DatabaseUnavailable, Sending> =>
  Effect.gen(function* () {
    const sending = yield* Sending
    const found = yield* sending.locateSender(member.team.value, sender.value)
    if (!found) return yield* new SenderNotFound({ team: member.teamName, senderId: sender.value })
    return SenderInTeamProver.prove([sender, member.team], { team: member.team, sender, found })
  })

const SenderOfTeamProver = defineProof("SenderOfTeam")

/** A sender belongs to team T. For a broadcast or form choosing it, where its id needn't be named. */
export interface SenderOfTeam<T> extends Proof<"SenderOfTeam", [T]> {
  readonly team: Named<T, TeamId>
  readonly found: Sender
}

export const proveSenderOfTeam = <P, T>(
  member: MemberOf<P, T>,
  senderId: SenderId,
): Effect.Effect<SenderOfTeam<T>, SenderNotFound | DatabaseUnavailable, Sending> =>
  Effect.gen(function* () {
    const sending = yield* Sending
    const found = yield* sending.locateSender(member.team.value, senderId)
    if (!found) return yield* new SenderNotFound({ team: member.teamName, senderId })
    return SenderOfTeamProver.prove([member.team], { team: member.team, found })
  })

/**
 * A broadcast's or form's choice of sender: undefined leaves it, null means the team's default,
 * and an id must be a sender in the team.
 */
export const proveSenderChoice = <P, T>(member: MemberOf<P, T>, senderId: SenderId | null | undefined) =>
  senderId == null ? Effect.succeed(senderId) : proveSenderOfTeam(member, senderId)
