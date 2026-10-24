import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto"
import { resolveMx } from "node:dns/promises"
import { type Challenge, createChallenge, randomInt, verifySolution } from "altcha-lib"
import { deriveKey } from "altcha-lib/algorithms/pbkdf2"
import { isDisposableEmailDomain } from "disposable-email-domains-js"
import { Config, Context, Effect, Layer, Redacted } from "effect"

/*
 * Bot protection for forms (D147): the signed render token, the built-in proof of work, Turnstile,
 * and email checks. Each is a service so tests can stand in for the network.
 */

/** How long a rendered form may be submitted, and how soon (a person takes a moment). */
export const RENDER_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000
export const RENDER_TOKEN_MIN_AGE_MS = 2000
/** How long a confirmation link works (D146). */
export const CONFIRM_LINK_DAYS = 7
/**
 * The built-in proof of work (ALTCHA, PBKDF2/SHA-256): ALTCHA's recommended difficulty, about a
 * second in the background on an ordinary device. "hard" is ten times that, for an address
 * loading forms far more often than a person would (D147).
 */
const POW_COST = 5_000
const POW_COUNTER = { normal: [5_000, 10_000], hard: [50_000, 100_000] } as const
export type WorkDifficulty = keyof typeof POW_COUNTER

const b64 = (text: string) => Buffer.from(text).toString("base64url")
const unb64 = (text: string) => Buffer.from(text, "base64url").toString("utf8")

export interface RenderTokenFacts {
  readonly formId: string
  readonly issuedAt: number
  readonly nonce: string
}

/** Signs and reads the tokens a form's page carries and the links its emails hold. */
export class FormTokens extends Context.Service<
  FormTokens,
  {
    readonly signRender: (formId: string, issuedAt: number) => string
    readonly readRender: (token: string) => RenderTokenFacts | undefined
    readonly signConfirm: (submissionId: string, expiresAt: number) => string
    /** The submission a confirmation link is for, while it hasn't expired. */
    readonly readConfirm: (token: string, now: number) => string | undefined
    /** A proof-of-work challenge for the browser's ALTCHA widget to solve. */
    readonly challenge: (now: number, difficulty: WorkDifficulty) => Effect.Effect<Challenge>
    /**
     * Whether a solution is right and its challenge unexpired; returns the challenge's signature,
     * for making it single-use. `payload` is the base64 JSON the browser sends.
     */
    readonly verifyWork: (payload: string) => Effect.Effect<string | undefined>
  }
>()("@parley/core/FormTokens") {
  static readonly layer = Layer.effect(
    FormTokens,
    Effect.gen(function* () {
      const auth = yield* Config.Redacted("BETTER_AUTH_SECRET").pipe(Effect.orDie)
      // PBKDF2 iterations per try. Only tests lower it, so they don't spend minutes hashing.
      const cost = yield* Config.Int("FORMS_POW_COST").pipe(Config.withDefault(POW_COST), Effect.orDie)
      // Tokens live at most days, so a rotated sign-in secret only voids the ones in flight.
      const key = (purpose: string) =>
        Buffer.from(hkdfSync("sha256", Redacted.value(auth), "parley-forms", purpose, 32))
      const renderKey = key("render-v1")
      const confirmKey = key("confirm-v1")
      const powKey = key("pow-v2").toString("hex")
      const powDerivedKey = key("pow-v2-key").toString("hex")
      const mac = (secret: Buffer, body: string) => createHmac("sha256", secret).update(body).digest().subarray(0, 18)
      const sign = (secret: Buffer, body: string) => `${b64(body)}.${mac(secret, body).toString("base64url")}`
      const read = (secret: Buffer, token: string) => {
        const [body, signature, extra] = token.split(".")
        if (!body || !signature || extra !== undefined) return undefined
        let text: string
        try {
          text = unb64(body)
        } catch {
          return undefined
        }
        const given = Buffer.from(signature, "base64url")
        const expected = mac(secret, text)
        return given.length === expected.length && timingSafeEqual(given, expected) ? text : undefined
      }
      return {
        signRender: (formId, issuedAt) => sign(renderKey, `${formId}|${issuedAt}|${crypto.randomUUID()}`),
        readRender: (token) => {
          const text = read(renderKey, token)
          const [formId, issued, nonce] = text?.split("|") ?? []
          const issuedAt = Number(issued)
          return formId && nonce && Number.isFinite(issuedAt) ? { formId, issuedAt, nonce } : undefined
        },
        signConfirm: (submissionId, expiresAt) => sign(confirmKey, `${submissionId}|${expiresAt}`),
        readConfirm: (token, now) => {
          const [submissionId, expires] = read(confirmKey, token)?.split("|") ?? []
          return submissionId && Number(expires) > now ? submissionId : undefined
        },
        challenge: (now, difficulty) => {
          const [low, high] = POW_COUNTER[difficulty]
          // Hashing in memory; it only rejects if the runtime has no Web Crypto.
          return Effect.tryPromise(() =>
            createChallenge({
              algorithm: "PBKDF2/SHA-256",
              cost,
              counter: randomInt(high, low),
              deriveKey,
              expiresAt: new Date(now + RENDER_TOKEN_MAX_AGE_MS),
              hmacSignatureSecret: powKey,
              hmacKeySignatureSecret: powDerivedKey,
            }),
          ).pipe(Effect.orDie)
        },
        verifyWork: (payload) =>
          Effect.tryPromise(async () => {
            // The widget's payload: base64 JSON of the challenge and its solution.
            let parsed: { readonly challenge?: Challenge; readonly solution?: { counter: number; derivedKey: string } }
            try {
              parsed = JSON.parse(unb64(payload)) as typeof parsed
            } catch {
              return undefined
            }
            const { challenge, solution } = parsed
            if (!challenge?.signature || !solution) return undefined
            const result = await verifySolution({
              challenge,
              solution,
              deriveKey,
              hmacSignatureSecret: powKey,
              hmacKeySignatureSecret: powDerivedKey,
            })
            return result.verified ? challenge.signature : undefined
          }).pipe(Effect.orElseSucceed(() => undefined)),
      }
    }),
  )
}

/** What Cloudflare said about a Turnstile token. */
export interface TurnstileResult {
  readonly success: boolean
  readonly hostname: string | null
}

/** Checks Turnstile tokens with Cloudflare (siteverify). Tests stand in for it. */
export class Turnstile extends Context.Service<
  Turnstile,
  {
    readonly verify: (input: {
      readonly secret: string
      readonly token: string
      readonly ip: string
      readonly idempotencyKey: string
    }) => Effect.Effect<TurnstileResult>
  }
>()("@parley/core/Turnstile") {
  static readonly layer = Layer.succeed(Turnstile, {
    verify: (input) =>
      Effect.tryPromise(async () => {
        const body = new URLSearchParams({
          secret: input.secret,
          response: input.token,
          remoteip: input.ip,
          idempotency_key: input.idempotencyKey,
        })
        const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          body,
          signal: AbortSignal.timeout(5000),
        })
        const result = (await response.json()) as { success?: boolean; hostname?: string }
        return { success: result.success === true, hostname: result.hostname ?? null }
      }).pipe(
        // Cloudflare unreachable: the token can't be checked, so it doesn't pass.
        Effect.orElseSucceed(() => ({ success: false, hostname: null })),
      ),
  })
}

/** Checks on an email address's domain (D147). Tests stand in for DNS. */
export class EmailChecks extends Context.Service<
  EmailChecks,
  {
    /** False only when DNS says the domain takes no mail; a DNS failure counts as yes. */
    readonly acceptsMail: (domain: string) => Effect.Effect<boolean>
    readonly isDisposable: (domain: string) => boolean
  }
>()("@parley/core/EmailChecks") {
  static readonly layer = Layer.sync(EmailChecks, () => {
    const cache = new Map<string, { readonly accepts: boolean; readonly until: number }>()
    return {
      acceptsMail: (domain) =>
        Effect.tryPromise(async () => {
          const now = Date.now()
          const known = cache.get(domain)
          if (known && known.until > now) return known.accepts
          const accepts = await Promise.race([
            resolveMx(domain).then(
              (records) => records.length > 0,
              // ENOTFOUND / ENODATA: no such domain or no MX. Anything else: don't know, so yes.
              (error: { code?: string }) => !(error.code === "ENOTFOUND" || error.code === "ENODATA"),
            ),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3000)),
          ])
          if (cache.size > 5000) cache.clear()
          cache.set(domain, { accepts, until: now + 60 * 60 * 1000 })
          return accepts
        }).pipe(Effect.orElseSucceed(() => true)),
      isDisposable: (domain) => isDisposableEmailDomain(domain),
    }
  })
}
