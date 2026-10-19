import { FileNotFound, type TeamId } from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanReadRecords } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { FileStore, isFileKey } from "../services/file-store.ts"

/**
 * A file, for a principal who can read records in the team its key starts with. Every other
 * failure reads as not found, so a key never reveals which teams exist.
 */
export const readFile = (principal: Principal, key: string) =>
  !isFileKey(key)
    ? Effect.fail(new FileNotFound())
    : named(principal, key.split("/")[0] as TeamId, (principal, team) =>
        Effect.gen(function* () {
          const files = yield* FileStore
          const member = yield* proveMemberOf(principal, team)
          yield* proveCanReadRecords(member)
          const file = yield* files.get(key)
          if (!file) return yield* new FileNotFound()
          return file
        }),
      ).pipe(
        Effect.catchTags({
          NotATeamMember: () => Effect.fail(new FileNotFound()),
          ApiKeyNotValidForTeam: () => Effect.fail(new FileNotFound()),
          ConnectionNotValidForTeam: () => Effect.fail(new FileNotFound()),
        }),
      )
