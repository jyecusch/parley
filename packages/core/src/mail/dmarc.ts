import { Resolver } from "node:dns/promises"
import type { DnsRecord } from "@parley/domain"
import { Context, Effect, Option } from "effect"
import { getDomain } from "tldts"

/** The DMARC policy we suggest for a sending domain that has none (D170). */
export const DMARC_POLICY = "v=DMARC1; p=quarantine;"

/** Looks up a name's TXT DNS records. Tests swap it so they never reach DNS. */
export const TxtLookup = Context.Reference<(name: string, signal: AbortSignal) => Promise<ReadonlyArray<string>>>(
  "@parley/core/TxtLookup",
  {
    defaultValue: () => async (name, signal) => {
      const resolver = new Resolver({ timeout: 2_000, tries: 2 })
      signal.addEventListener("abort", () => resolver.cancel())
      return (await resolver.resolveTxt(name)).map((parts) => parts.join(""))
    },
  },
)

/** The DMARC record published at a name, if any. A lookup that fails counts as none. */
const publishedAt = (name: string) =>
  Effect.gen(function* () {
    const lookup = yield* TxtLookup
    const texts = yield* Effect.tryPromise((signal) => lookup(name, signal)).pipe(Effect.timeout("5 seconds"))
    return Option.fromNullishOr(texts.find((text) => /^v=DMARC1\b/i.test(text.trim())))
  }).pipe(Effect.orElseSucceed(() => Option.none<string>()))

/**
 * A sending domain's DMARC record (D170). One that's published, on the domain or on its
 * organizational domain (which DMARC falls back to), is shown as found and never replaced;
 * otherwise we suggest ours.
 */
export const dmarcRecord = (domain: string): Effect.Effect<DnsRecord> =>
  Effect.gen(function* () {
    const organizational = getDomain(domain)
    for (const name of [domain, ...(organizational && organizational !== domain ? [organizational] : [])]) {
      const published = yield* publishedAt(`_dmarc.${name}`)
      if (Option.isSome(published))
        return { type: "TXT", name: `_dmarc.${name}`, value: published.value, priority: null, status: "verified" }
    }
    return { type: "TXT", name: `_dmarc.${domain}`, value: DMARC_POLICY, priority: null, status: "pending" }
  })
