import { createHmac, timingSafeEqual } from "node:crypto"
import type { CampaignId, ContactId, TeamId, TopicId } from "@parley/domain"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"

/** What an unsubscribe link is about. A test send's link changes nothing (R45). */
export interface UnsubscribeLinkFacts {
  readonly teamId: TeamId
  readonly contactId: ContactId | null
  readonly topicId: TopicId | null
  readonly campaignId: CampaignId | null
  readonly test: boolean
}

interface Payload {
  readonly t: string
  readonly c?: string
  readonly p?: string
  readonly m?: string
  readonly x?: 1
}

const encode = (text: string) => Buffer.from(text).toString("base64url")

/**
 * Signs and reads unsubscribe links (R39). Process tier: holds only the secret. Links never expire,
 * because anti-spam law needs them to keep working after the email is sent.
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
      const own = yield* Config.option(Config.Redacted("UNSUBSCRIBE_SECRET")).pipe(Effect.orDie)
      const auth = yield* Config.Redacted("BETTER_AUTH_SECRET").pipe(Effect.orDie)
      const base = yield* Config.String("BETTER_AUTH_URL").pipe(Effect.orDie)
      const secret = Redacted.value(Option.getOrElse(own, () => auth))
      const mac = (body: string) =>
        createHmac("sha256", secret).update(`parley-unsubscribe:${body}`).digest().subarray(0, 16)

      return {
        sign: (facts) => {
          const payload: Payload = {
            t: facts.teamId,
            ...(facts.contactId ? { c: facts.contactId } : {}),
            ...(facts.topicId ? { p: facts.topicId } : {}),
            ...(facts.campaignId ? { m: facts.campaignId } : {}),
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
          const expected = mac(body)
          const given = Buffer.from(signature, "base64url")
          if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
          try {
            const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload
            if (typeof payload.t !== "string") return undefined
            return {
              teamId: payload.t as TeamId,
              contactId: (payload.c ?? null) as ContactId | null,
              topicId: (payload.p ?? null) as TopicId | null,
              campaignId: (payload.m ?? null) as CampaignId | null,
              test: payload.x === 1,
            }
          } catch {
            return undefined
          }
        },
      }
    }),
  )
}
