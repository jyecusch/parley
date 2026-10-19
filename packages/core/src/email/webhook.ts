import { Effect } from "effect"
import { named } from "../proofs/proof.ts"
import { proveProviderEventSigned } from "../proofs/provider-event.ts"
import { DeliveryEvents } from "../services/delivery-events.ts"

/**
 * Handles one webhook request from the email provider (R46). Answers whether it was accepted:
 * unsigned requests are refused, events we don't track are accepted and ignored.
 */
export const receiveDeliveryEvent = (headers: Headers, body: string) =>
  named(body, (body) =>
    Effect.gen(function* () {
      const events = yield* DeliveryEvents
      const signed = yield* proveProviderEventSigned(headers, body)
      if (signed === undefined) return "refused" as const
      if (signed !== "ignored") yield* events.apply(signed)
      return "accepted" as const
    }),
  )
