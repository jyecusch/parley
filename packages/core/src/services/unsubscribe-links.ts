import { createHmac, timingSafeEqual } from "node:crypto"
import type { BroadcastId, ContactId, TeamId, TopicId } from "@parley/domain"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { PublicUrl } from "../config/public-url.ts"
import { rotatingSecret } from "../config/rotating-secret.ts"

/** What an unsubscribe link is about. A test send's link changes nothing (R45). */
export interface UnsubscribeLinkFacts {
  readonly teamId: TeamId
  readonly contactId: ContactId | null
  readonly topicId: TopicId | null
  readonly broadcastId: BroadcastId | null
  readonly test: boolean
}

/** A link's payload: team, contact, topic, broadcast and test flag, in one letter each to keep links short. */
const Payload = Schema.Struct({
  t: Schema.String,
  c: Schema.optional(Schema.String),
  p: Schema.optional(Schema.String),
  m: Schema.optional(Schema.String),
  x: Schema.optional(Schema.Literal(1)),
})
type Payload = typeof Payload.Type
const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(Payload))

const encode = (text: string) => Buffer.from(text).toString("base64url")

/**
 * Signs and reads unsubscribe links (R39). Process tier: holds only the secrets. Links never expire,
 * because anti-spam law needs them to keep working after the email is sent.
 *
 * The secret is UNSUBSCRIBE_SECRET. To rotate it (D152), move the old one to
 * UNSUBSCRIBE_SECRETS_PREVIOUS (comma-separated) and set a new one: new links are signed with the
 * new secret, and links signed with a previous one still work. Sent links can't be re-signed, so
 * keep a previous secret as long as its emails' links should work: well past the 30 days
 * anti-spam law asks for.
 */
export class UnsubscribeLinks extends Context.Service<
  UnsubscribeLinks,
  {
    /** The token for a link. */
    readonly sign: (facts: UnsubscribeLinkFacts) => string
    /** The public page for a token, and the one-click address for List-Unsubscribe. */
    readonly urls: (token: string) => { readonly page: string; readonly oneClick: string }
    /** Used only by the UnsubscribeLinkValid prover. */
    readonly read: (token: string) => UnsubscribeLinkFacts | undefined
  }
>()("@parley/core/UnsubscribeLinks") {
  static readonly layer = Layer.effect(
    UnsubscribeLinks,
    Effect.gen(function* () {
      // Links already sent must keep working (R39), so a changed secret stays in the previous ones.
      const { current, previous: retired } = yield* rotatingSecret(
        "UNSUBSCRIBE_SECRET",
        "UNSUBSCRIBE_SECRETS_PREVIOUS",
        "to change it later, keep the old one in UNSUBSCRIBE_SECRETS_PREVIOUS.",
      )
      const auth = yield* Config.Redacted("BETTER_AUTH_SECRET").pipe(Effect.orDie)
      const base = yield* PublicUrl.pipe(Effect.orDie)
      const secret = Option.getOrElse(current, () => Redacted.value(auth))
      const macWith = (key: string, body: string) =>
        createHmac("sha256", key).update(`parley-unsubscribe:${body}`).digest().subarray(0, 16)
      const mac = (body: string) => macWith(secret, body)
      /** Whether any secret, current or previous, signed `body` as `given`. */
      const signed = (body: string, given: Buffer) =>
        [secret, ...retired].some((key) => {
          const expected = macWith(key, body)
          return given.length === expected.length && timingSafeEqual(given, expected)
        })

      return {
        sign: (facts) => {
          const payload: Payload = {
            t: facts.teamId,
            ...(facts.contactId ? { c: facts.contactId } : {}),
            ...(facts.topicId ? { p: facts.topicId } : {}),
            ...(facts.broadcastId ? { m: facts.broadcastId } : {}),
            ...(facts.test ? { x: 1 as const } : {}),
          }
          const body = encode(JSON.stringify(payload))
          return `${body}.${mac(body).toString("base64url")}`
        },
        urls: (token) => {
          const origin = base.replace(/\/$/, "")
          return { page: `${origin}/unsubscribe/${token}`, oneClick: `${origin}/api/unsubscribe/${token}` }
        },
        read: (token) => {
          const [body, signature, extra] = token.split(".")
          if (!body || !signature || extra !== undefined) return undefined
          if (!signed(body, Buffer.from(signature, "base64url"))) return undefined
          const payload = decodePayload(Buffer.from(body, "base64url").toString())
          if (Option.isNone(payload)) return undefined
          const { t, c, p, m, x } = payload.value
          return {
            teamId: t as TeamId,
            contactId: (c ?? null) as ContactId | null,
            topicId: (p ?? null) as TopicId | null,
            broadcastId: (m ?? null) as BroadcastId | null,
            test: x === 1,
          }
        },
      }
    }),
  )
}
