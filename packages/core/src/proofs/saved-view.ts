import {
  type DatabaseUnavailable,
  type RecordType,
  type SavedView,
  type SavedViewId,
  SavedViewNotFound,
  type TeamId,
} from "@parley/domain"
import { Effect } from "effect"
import { SavedViews } from "../services/saved-views.ts"
import type { MemberOf } from "./member-of.ts"
import { type PermissionError, requirePermission } from "./permissions.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const SavedViewEditableProver = defineProof("SavedViewEditable")

/**
 * P may change saved view V in team T: it's P's own personal view, or it's shared and P has
 * records:write (D60). `canShare` says whether P may also change who it's shared with.
 */
export interface SavedViewEditable<P, T, V> extends Proof<"SavedViewEditable", [P, T, V]> {
  readonly team: Named<T, TeamId>
  readonly view: Named<V, SavedViewId>
  readonly found: SavedView
  readonly recordType: RecordType
  readonly canShare: boolean
}

export const proveSavedViewEditable = <P, T, V>(
  member: MemberOf<P, T>,
  view: Named<V, SavedViewId>,
): Effect.Effect<SavedViewEditable<P, T, V>, SavedViewNotFound | PermissionError | DatabaseUnavailable, SavedViews> =>
  Effect.gen(function* () {
    const views = yield* SavedViews
    const found = yield* views.locate(member, view.value)
    if (!found) return yield* new SavedViewNotFound({ team: member.teamName, viewId: view.value })
    const canWrite = yield* Effect.match(requirePermission(member, "records:write"), {
      onFailure: () => false,
      onSuccess: () => true,
    })
    const owned = found.ownerUserId === member.principal.value.userId
    // Someone else's shared view: only with records:write, and that's the error if they lack it.
    if (found.shared && !owned && !canWrite) yield* requirePermission(member, "records:write")
    return SavedViewEditableProver.prove([member.principal, member.team, view], {
      team: member.team,
      view,
      found,
      recordType: found.recordType,
      canShare: canWrite,
    })
  })
