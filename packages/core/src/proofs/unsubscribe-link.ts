import { UnsubscribeLinkInvalid } from "@parley/domain"
import { Effect } from "effect"
import { type UnsubscribeLinkFacts, UnsubscribeLinks } from "../services/unsubscribe-links.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const UnsubscribeLinkValidProver = defineProof("UnsubscribeLinkValid")

/**
 * Link L was signed by Parley, so whoever holds it may change the subscriptions it names (R39).
 * It's the only authority the unsubscribe page has: recipients don't sign in.
 */
export interface UnsubscribeLinkValid<L> extends Proof<"UnsubscribeLinkValid", [L]> {
  readonly facts: UnsubscribeLinkFacts
}

export const proveUnsubscribeLinkValid = <L>(
  link: Named<L, string>,
): Effect.Effect<UnsubscribeLinkValid<L>, UnsubscribeLinkInvalid, UnsubscribeLinks> =>
  Effect.gen(function* () {
    const links = yield* UnsubscribeLinks
    const facts = links.read(link.value)
    if (!facts) return yield* new UnsubscribeLinkInvalid()
    return { ...UnsubscribeLinkValidProver.prove(link), facts }
  })
