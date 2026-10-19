import type { UnsubscribeChange } from "@parley/domain"
import { Effect } from "effect"
import { named } from "../proofs/proof.ts"
import { proveUnsubscribeLinkValid } from "../proofs/unsubscribe-link.ts"
import { Subscriptions } from "../services/subscriptions.ts"

/** What the public unsubscribe page shows for a link (R39). The link is the only authority. */
export const unsubscribePage = (token: string) =>
  named(token, (token) =>
    Effect.gen(function* () {
      const subscriptions = yield* Subscriptions
      const link = yield* proveUnsubscribeLinkValid(token)
      return yield* subscriptions.page(link)
    }),
  )

/** Applies a change from the unsubscribe page, or RFC 8058's one-click POST. */
export const unsubscribeApply = (token: string, change: UnsubscribeChange) =>
  named(token, (token) =>
    Effect.gen(function* () {
      const subscriptions = yield* Subscriptions
      const link = yield* proveUnsubscribeLinkValid(token)
      return yield* subscriptions.apply(link, change)
    }),
  )
