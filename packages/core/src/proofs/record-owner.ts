import { type DatabaseUnavailable, MemberNotFound, type TeamId, type UserId } from "@parley/domain"
import { Effect } from "effect"
import { Members } from "../services/members.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const RecordOwnerProver = defineProof("RecordOwner")

/**
 * `userId` is a member of team T (a person or a service account), so they may be the record owner
 * of the team's contacts and companies (D123).
 */
export interface RecordOwner<T> extends Proof<"RecordOwner", [T]> {
  readonly team: Named<T, TeamId>
  readonly userId: UserId
}

export const proveRecordOwner = <P, T>(
  member: MemberOf<P, T>,
  userId: UserId,
): Effect.Effect<RecordOwner<T>, MemberNotFound | DatabaseUnavailable, Members> =>
  Effect.gen(function* () {
    const members = yield* Members
    const found = yield* members.lookup(member.team.value, userId)
    if (found._tag !== "Member") return yield* new MemberNotFound({ team: member.teamName, userId })
    return RecordOwnerProver.prove([member.team], { team: member.team, userId })
  })

/** What a create or update does with the record owner: leave it (undefined), clear it (null), or set it. */
export type RecordOwnerChange<T> = undefined | null | RecordOwner<T>

/** Proves the ownerId given in an input, if any. */
export const recordOwnerChange = <P, T>(
  member: MemberOf<P, T>,
  ownerId: UserId | null | undefined,
): Effect.Effect<RecordOwnerChange<T>, MemberNotFound | DatabaseUnavailable, Members> =>
  ownerId === undefined || ownerId === null ? Effect.succeed(ownerId) : proveRecordOwner(member, ownerId)
