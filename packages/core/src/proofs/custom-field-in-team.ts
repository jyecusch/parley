import {
  type CustomField,
  type CustomFieldId,
  CustomFieldNotFound,
  type DatabaseUnavailable,
  type TeamId,
} from "@parley/domain"
import { Effect } from "effect"
import { CustomFields } from "../services/custom-fields.ts"
import type { CanReadRecords } from "./permissions.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const CustomFieldInTeamProver = defineProof("CustomFieldInTeam")

/** Custom field F belongs to team T. */
export interface CustomFieldInTeam<F, T> extends Proof<"CustomFieldInTeam", [F, T]> {
  readonly team: Named<T, TeamId>
  readonly field: Named<F, CustomFieldId>
  readonly found: CustomField
}

export const proveCustomFieldInTeam = <P, T, F>(
  team: Named<T, TeamId>,
  field: Named<F, CustomFieldId>,
  read: CanReadRecords<P, T>,
): Effect.Effect<CustomFieldInTeam<F, T>, CustomFieldNotFound | DatabaseUnavailable, CustomFields> =>
  Effect.gen(function* () {
    const fields = yield* CustomFields
    const found = yield* fields.locate(team, field.value, read)
    if (!found) return yield* new CustomFieldNotFound({ team: read.member.teamName, fieldId: field.value })
    return CustomFieldInTeamProver.prove([field, team], { team, field, found })
  })
