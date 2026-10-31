import { type ApiKey, type ApiKeyId, ApiKeyNotFound, type DatabaseUnavailable } from "@parley/domain"
import { Effect } from "effect"
import { ApiKeys } from "../services/api-keys.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const OwnApiKeyProver = defineProof("OwnApiKey")

/** API key K belongs to principal P and is bound to team T. */
export interface OwnApiKey<P, T, K> extends Proof<"OwnApiKey", [P, T, K]> {
  readonly member: MemberOf<P, T>
  readonly apiKey: Named<K, ApiKeyId>
  readonly found: ApiKey
}

/** Someone else's key, or a key for another team, is simply not found: no oracle. */
export const proveOwnApiKey = <P, T, K>(
  member: MemberOf<P, T>,
  apiKey: Named<K, ApiKeyId>,
): Effect.Effect<OwnApiKey<P, T, K>, ApiKeyNotFound | DatabaseUnavailable, ApiKeys> =>
  Effect.gen(function* () {
    const keys = yield* ApiKeys
    const found = yield* keys.locateOwn(member, apiKey.value)
    if (!found) return yield* new ApiKeyNotFound({ apiKeyId: apiKey.value })
    return OwnApiKeyProver.prove([member.principal, member.team, apiKey], { member, apiKey, found })
  })
