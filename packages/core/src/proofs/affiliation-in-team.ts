import {
  type Affiliation,
  type AffiliationId,
  AffiliationNotFound,
  type DatabaseUnavailable,
  type TeamId,
} from "@parley/domain"
import type { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { Affiliations } from "../services/affiliations.ts"
import type { CanReadRecords } from "./permissions.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const AffiliationInTeamProver = defineProof("AffiliationInTeam")

/** Affiliation A is in team T, and neither its contact nor its company is deleted. */
export interface AffiliationInTeam<A, T> extends Proof<"AffiliationInTeam", [A, T]> {
  readonly affiliation: Named<A, AffiliationId>
  readonly team: Named<T, TeamId>
  readonly teamName: DisplayName
  readonly found: Affiliation
}

/** Needs read access to the team before it will even look (D37: no existence oracle). */
export const proveAffiliationInTeam = <P, T, A>(
  team: Named<T, TeamId>,
  affiliation: Named<A, AffiliationId>,
  read: CanReadRecords<P, T>,
): Effect.Effect<AffiliationInTeam<A, T>, AffiliationNotFound | DatabaseUnavailable, Affiliations> =>
  Effect.gen(function* () {
    const affiliations = yield* Affiliations
    const found = yield* affiliations.locate(team, affiliation.value, read)
    if (!found) {
      return yield* new AffiliationNotFound({ team: read.member.teamName, affiliationId: affiliation.value })
    }
    return AffiliationInTeamProver.prove([affiliation, team], {
      affiliation,
      team,
      teamName: read.member.teamName,
      found,
    })
  })
