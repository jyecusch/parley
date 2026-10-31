import {
  type DatabaseUnavailable,
  type Segment,
  type SegmentId,
  SegmentIsDynamic,
  SegmentNotFound,
  type TeamId,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { Segments } from "../services/segments.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const SegmentInTeamProver = defineProof("SegmentInTeam")
const SegmentIsFixedProver = defineProof("SegmentIsFixed")

/** Segment K belongs to team T. */
export interface SegmentInTeam<K, T> extends Proof<"SegmentInTeam", [K, T]> {
  readonly team: Named<T, TeamId>
  readonly segment: Named<K, SegmentId>
  readonly found: Segment
}

/** Segment K is a fixed one, so its contacts are picked by hand. */
export interface SegmentIsFixed<K> extends Proof<"SegmentIsFixed", [K]> {}

export const proveSegmentInTeam = <P, T, K>(
  member: MemberOf<P, T>,
  segment: Named<K, SegmentId>,
): Effect.Effect<SegmentInTeam<K, T>, SegmentNotFound | DatabaseUnavailable, Segments> =>
  Effect.gen(function* () {
    const segments = yield* Segments
    const found = yield* segments.locate(member.team.value, segment.value)
    if (!found) return yield* new SegmentNotFound({ team: member.teamName, segmentId: segment.value })
    return SegmentInTeamProver.prove([segment, member.team], { team: member.team, segment, found })
  })

export const proveSegmentIsFixed = <K, T>(
  target: SegmentInTeam<K, T>,
): Effect.Effect<SegmentIsFixed<K>, SegmentIsDynamic> =>
  target.found.kind === "fixed"
    ? Effect.succeed(SegmentIsFixedProver.prove([target.segment]))
    : Effect.fail(new SegmentIsDynamic({ segment: DisplayName.fromRecord(target.found.name) }))

const SegmentOfTeamProver = defineProof("SegmentOfTeam")

/** A segment belongs to team T. For linking it to something else, where its id needn't be named. */
export interface SegmentOfTeam<T> extends Proof<"SegmentOfTeam", [T]> {
  readonly team: Named<T, TeamId>
  readonly found: Segment
}

export const proveSegmentOfTeam = <P, T>(
  member: MemberOf<P, T>,
  segmentId: SegmentId,
): Effect.Effect<SegmentOfTeam<T>, SegmentNotFound | DatabaseUnavailable, Segments> =>
  Effect.gen(function* () {
    const segments = yield* Segments
    const found = yield* segments.locate(member.team.value, segmentId)
    if (!found) return yield* new SegmentNotFound({ team: member.teamName, segmentId })
    return SegmentOfTeamProver.prove([member.team], { team: member.team, found })
  })
