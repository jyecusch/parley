import { type DatabaseUnavailable, type Import, type ImportId, ImportNotFound, type TeamId } from "@parley/domain"
import { Effect } from "effect"
import { Imports } from "../services/imports.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const ImportInTeamProver = defineProof("ImportInTeam")

/** Import I belongs to team T. */
export interface ImportInTeam<I, T> extends Proof<"ImportInTeam", [I, T]> {
  readonly team: Named<T, TeamId>
  readonly import: Named<I, ImportId>
  readonly found: Import
}

export const proveImportInTeam = <P, T, I>(
  member: MemberOf<P, T>,
  target: Named<I, ImportId>,
): Effect.Effect<ImportInTeam<I, T>, ImportNotFound | DatabaseUnavailable, Imports> =>
  Effect.gen(function* () {
    const imports = yield* Imports
    const found = yield* imports.locate(member.team.value, target.value)
    if (!found) return yield* new ImportNotFound({ team: member.teamName, importId: target.value })
    return ImportInTeamProver.prove([target, member.team], { team: member.team, import: target, found })
  })
