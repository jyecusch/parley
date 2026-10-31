import { Effect } from "effect"
import { type DeliveryEvent, DeliveryEvents } from "../services/delivery-events.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const ProviderEventSignedProver = defineProof("ProviderEventSigned")

/** Request body E was signed by the email provider with our webhook secret (R46). */
export interface ProviderEventSigned<E> extends Proof<"ProviderEventSigned", [E]> {
  readonly event: DeliveryEvent
}

/** Undefined when the request isn't the provider's, or is about something we don't track. */
export const proveProviderEventSigned = <E>(
  headers: Headers,
  body: Named<E, string>,
): Effect.Effect<ProviderEventSigned<E> | "ignored" | undefined, never, DeliveryEvents> =>
  Effect.gen(function* () {
    const events = yield* DeliveryEvents
    const event = events.verify(headers, body.value)
    if (event === undefined || event === "ignored") return event
    const signed: ProviderEventSigned<E> = ProviderEventSignedProver.prove([body], { event })
    return signed
  })
