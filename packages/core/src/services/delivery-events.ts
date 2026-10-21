import { createHmac, timingSafeEqual } from "node:crypto"
import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable } from "@parley/domain"
import { and, eq, inArray, sql } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import type { SqlError } from "effect/sql"
import type { ProviderEventSigned } from "../proofs/provider-event.ts"
import { classifySqlError } from "./sql-errors.ts"

/** What the email provider told us about one message (R46). */
export interface DeliveryEvent {
  readonly kind: "delivered" | "bounced" | "marked-as-spam"
  readonly providerId: string
}

/** Signatures older than this are refused, so a captured request can't be replayed later. */
const TOLERANCE_SECONDS = 5 * 60

/**
 * Deliveries, bounces and spam reports from Resend's webhook (R46), checked with its Svix
 * signature. Process tier: holds only the signing secret.
 */
export class DeliveryEvents extends Context.Service<
  DeliveryEvents,
  {
    /** Used only by the ProviderEventSigned prover. Undefined when the signature doesn't check out. */
    readonly verify: (headers: Headers, body: string) => DeliveryEvent | "ignored" | undefined
    readonly apply: <E>(event: ProviderEventSigned<E>) => Effect.Effect<void, DatabaseUnavailable>
  }
>()("@parley/core/DeliveryEvents") {
  static readonly layer = Layer.effect(
    DeliveryEvents,
    Effect.gen(function* () {
      const db = yield* Database
      const configured = yield* Config.option(Config.Redacted("RESEND_WEBHOOK_SECRET")).pipe(Effect.orDie)
      const sendsForReal = yield* Config.option(Config.String("RESEND_API_KEY")).pipe(Effect.orDie)
      if (Option.isNone(configured) && Option.isSome(sendsForReal) && sendsForReal.value.trim() !== "") {
        yield* Effect.logWarning(
          "RESEND_WEBHOOK_SECRET isn't set, so bounces and spam reports from Resend are refused and never recorded.",
        )
      }
      const secret = Option.map(configured, (value) =>
        Buffer.from(Redacted.value(value).replace(/^whsec_/, ""), "base64"),
      )
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const verify = (headers: Headers, body: string): DeliveryEvent | "ignored" | undefined => {
        if (Option.isNone(secret)) return undefined
        const id = headers.get("svix-id")
        const timestamp = headers.get("svix-timestamp")
        const signatures = headers.get("svix-signature")
        if (!id || !timestamp || !signatures) return undefined
        if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return undefined
        const expected = createHmac("sha256", secret.value).update(`${id}.${timestamp}.${body}`).digest()
        const valid = signatures.split(" ").some((entry) => {
          const [version, signature] = entry.split(",")
          if (version !== "v1" || !signature) return false
          const given = Buffer.from(signature, "base64")
          return given.length === expected.length && timingSafeEqual(given, expected)
        })
        if (!valid) return undefined
        try {
          const payload = JSON.parse(body) as { type?: string; data?: { email_id?: string } }
          const providerId = payload.data?.email_id
          if (!providerId) return "ignored"
          switch (payload.type) {
            case "email.delivered":
              return { kind: "delivered", providerId }
            case "email.bounced":
              return { kind: "bounced", providerId }
            case "email.complained":
              return { kind: "marked-as-spam", providerId }
            default:
              return "ignored"
          }
        } catch {
          return undefined
        }
      }

      const apply = <E>(signed: ProviderEventSigned<E>) =>
        Effect.gen(function* () {
          const event = signed.event
          const [recipient] = yield* run(
            db.query((d) =>
              d
                .select({
                  id: schema.broadcastRecipients.id,
                  teamId: schema.broadcastRecipients.teamId,
                  contactId: schema.broadcastRecipients.contactId,
                  name: schema.broadcastRecipients.name,
                  status: schema.broadcastRecipients.status,
                  broadcastId: schema.broadcasts.id,
                  broadcastName: schema.broadcasts.name,
                })
                .from(schema.broadcastRecipients)
                .innerJoin(schema.broadcasts, eq(schema.broadcasts.id, schema.broadcastRecipients.broadcastId))
                .where(eq(schema.broadcastRecipients.providerId, event.providerId)),
            ),
          )
          if (!recipient) return
          if (event.kind === "delivered") {
            // Only a sent message becomes delivered; a bounce or complaint that arrived first stands.
            yield* run(
              db.query((d) =>
                d
                  .update(schema.broadcastRecipients)
                  .set({ status: "delivered", updatedAt: sql`now()` })
                  .where(
                    and(eq(schema.broadcastRecipients.id, recipient.id), eq(schema.broadcastRecipients.status, "sent")),
                  ),
              ),
            )
            return
          }
          const kind = event.kind
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .update(schema.broadcastRecipients)
                    .set({ status: kind, updatedAt: sql`now()` })
                    .where(eq(schema.broadcastRecipients.id, recipient.id)),
                )
                if (!recipient.contactId) return
                const contactId = recipient.contactId
                // A spam report outranks a bounce; neither is undone by the other.
                const allowed: Array<"subscribed" | "unsubscribed" | "bounced"> =
                  kind === "bounced" ? ["subscribed", "unsubscribed"] : ["subscribed", "unsubscribed", "bounced"]
                const changed = yield* db.query((d) =>
                  d
                    .update(schema.contacts)
                    .set({ subscriptionStatus: kind, updatedAt: sql`now()` })
                    .where(and(eq(schema.contacts.id, contactId), inArray(schema.contacts.subscriptionStatus, allowed)))
                    .returning({ id: schema.contacts.id }),
                )
                if (changed.length === 0) return
                yield* db.query((d) =>
                  d.insert(schema.activity).values({
                    id: crypto.randomUUID(),
                    teamId: recipient.teamId,
                    recordType: "contact",
                    recordId: contactId,
                    kind: kind,
                    changedFields: [],
                    relatedRecordType: "broadcast",
                    relatedRecordId: recipient.broadcastId,
                    relatedName: recipient.broadcastName,
                    // A bounce is the mail system's doing; a spam report is the recipient's.
                    actorUserId: null,
                    actorName: kind === "bounced" ? "Parley" : recipient.name,
                    viaName: kind === "bounced" ? null : "spam report",
                  }),
                )
              }),
            ),
          )
        }).pipe(Effect.withSpan("DeliveryEvents.apply"))

      return { verify, apply }
    }),
  )
}
