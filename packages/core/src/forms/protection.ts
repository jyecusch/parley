import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto"
import { resolveMx } from "node:dns/promises"
import { type Challenge, createChallenge, randomInt, verifySolution } from "altcha-lib"
import { deriveKey } from "altcha-lib/algorithms/pbkdf2"
import { isDisposableEmailDomain } from "disposable-email-domains-js"
import { Cache, Config, Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { type JWTPayload, jwtVerify, SignJWT } from "jose"

/*
 * Bot protection for forms (D147): the signed render token, the built-in proof of work, Turnstile,
 * and email checks. Each is a service so tests can stand in for the network.
 */

/** How long a rendered form may be submitted, and how soon (a person takes a moment). */
export const RENDER_TOKEN_MAX_AGE = Duration.hours(2)
export const RENDER_TOKEN_MIN_AGE = Duration.seconds(2)
/** How long a confirmation link works (D146). */
export const CONFIRM_LINK_DAYS = 7
export const CONFIRM_LINK_AGE = Duration.days(CONFIRM_LINK_DAYS)
/**
 * The built-in proof of work (ALTCHA, PBKDF2/SHA-256): ALTCHA's recommended difficulty, about a
 * second in the background on an ordinary device. "hard" is ten times that, for an address
 * loading forms far more often than a person would (D147).
 */
const POW_COST = 5_000
const POW_COUNTER = { normal: [5_000, 10_000], hard: [50_000, 100_000] } as const
export type WorkDifficulty = keyof typeof POW_COUNTER

export interface RenderTokenFacts {
  readonly formId: string
  readonly issuedAt: number
  readonly nonce: string
}

/** A render token's claims: the form, when it was issued, and a nonce that makes it single-use. */
const RenderClaims = Schema.Struct({ sub: Schema.String, iat: Schema.Number, jti: Schema.String })
/** A confirmation link's claims: the submission it confirms (its expiry, jose checks). */
const ConfirmClaims = Schema.Struct({ sub: Schema.String })

/** Signs and reads the tokens a form's page carries and the links its emails hold. */
export class FormTokens extends Context.Service<
  FormTokens,
  {
    readonly signRender: (formId: string, issuedAt: number) => Effect.Effect<string>
    readonly readRender: (token: string) => Effect.Effect<RenderTokenFacts | undefined>
    readonly signConfirm: (submissionId: string, expiresAt: number) => Effect.Effect<string>
    /** The submission a confirmation link is for, while it hasn't expired. */
    readonly readConfirm: (token: string, now: number) => Effect.Effect<string | undefined>
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
      const renderKey = key("render-v2")
      const confirmKey = key("confirm-v2")
      const legacyConfirmKey = key("confirm-v1")
      const powKey = key("pow-v2").toString("hex")
      const powDerivedKey = key("pow-v2-key").toString("hex")

      /** Signs claims as a JWT (HS256); jose does the encoding, signing and expiry. HMAC in memory can't fail. */
      const sign = (secret: Uint8Array, claims: JWTPayload) =>
        Effect.tryPromise(() => new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).sign(secret)).pipe(
          Effect.orDie,
        )
      /** A JWT's claims if its signature is ours and it hasn't expired, decoded by `claims`. */
      const read = <A>(secret: Uint8Array, token: string, claims: Schema.Decoder<A>, now?: number) =>
        Effect.tryPromise(() =>
          jwtVerify(token, secret, {
            algorithms: ["HS256"],
            ...(now === undefined ? {} : { currentDate: new Date(now) }),
          }),
        ).pipe(
          Effect.flatMap((verified) => Schema.decodeUnknownEffect(claims)(verified.payload)),
          Effect.option,
          Effect.map(Option.getOrUndefined),
        )

      /**
       * Confirmation links sent before jose: `<base64url body>.<18-byte HMAC>`, body
       * `<submission id>|<expiry ms>`. Sent links work 7 days, so this reader goes after 2026-11-02.
       */
      const readLegacyConfirm = (token: string, now: number) => {
        const [body, signature, extra] = token.split(".")
        if (!body || !signature || extra !== undefined) return undefined
        const text = Buffer.from(body, "base64url").toString("utf8")
        const given = Buffer.from(signature, "base64url")
        const expected = createHmac("sha256", legacyConfirmKey).update(text).digest().subarray(0, 18)
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
        const [submissionId, expires] = text.split("|")
        return submissionId && Number(expires) > now ? submissionId : undefined
      }

      return {
        signRender: (formId, issuedAt) =>
          sign(renderKey, { sub: formId, iat: Math.floor(issuedAt / 1000), jti: crypto.randomUUID() }),
        readRender: (token) =>
          // Its age is checked by the caller, which tells "too old" apart from "not ours".
          read(renderKey, token, RenderClaims).pipe(
            Effect.map((claims) =>
              claims ? { formId: claims.sub, issuedAt: claims.iat * 1000, nonce: claims.jti } : undefined,
            ),
          ),
        signConfirm: (submissionId, expiresAt) =>
          sign(confirmKey, { sub: submissionId, exp: Math.floor(expiresAt / 1000) }),
        readConfirm: (token, now) =>
          token.split(".").length === 3
            ? read(confirmKey, token, ConfirmClaims, now).pipe(Effect.map((claims) => claims?.sub))
            : Effect.sync(() => readLegacyConfirm(token, now)),
        challenge: (now, difficulty) => {
          const [low, high] = POW_COUNTER[difficulty]
          // Hashing in memory; it only rejects if the runtime has no Web Crypto.
          return Effect.tryPromise(() =>
            createChallenge({
              algorithm: "PBKDF2/SHA-256",
              cost,
              counter: randomInt(high, low),
              deriveKey,
              expiresAt: new Date(now + Duration.toMillis(RENDER_TOKEN_MAX_AGE)),
              hmacSignatureSecret: powKey,
              hmacKeySignatureSecret: powDerivedKey,
            }),
          ).pipe(Effect.orDie)
        },
        verifyWork: (payload) =>
          // Buffer reads standard and URL-safe base64 alike.
          Schema.decodeUnknownEffect(WorkPayload)(Buffer.from(payload, "base64").toString("utf8")).pipe(
            Effect.flatMap(({ challenge, solution }) =>
              Effect.tryPromise(() =>
                verifySolution({
                  // The rest of the challenge altcha-lib checks against its signature.
                  challenge: challenge as unknown as Challenge,
                  solution,
                  deriveKey,
                  hmacSignatureSecret: powKey,
                  hmacKeySignatureSecret: powDerivedKey,
                }),
              ).pipe(Effect.map((result) => (result.verified ? challenge.signature : undefined))),
            ),
            Effect.orElseSucceed(() => undefined),
          ),
      }
    }),
  )
}

/** The ALTCHA widget's payload, once out of its base64: JSON of the challenge (all of it, for verifying) and its solution. */
const WorkPayload = Schema.fromJsonString(
  Schema.Struct({
    challenge: Schema.StructWithRest(Schema.Struct({ signature: Schema.String }), [
      Schema.Record(Schema.String, Schema.Unknown),
    ]),
    solution: Schema.Struct({ counter: Schema.Number, derivedKey: Schema.String }),
  }),
)

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
  static readonly layer = Layer.effect(
    EmailChecks,
    Effect.gen(function* () {
      // An hour per domain, for the 5,000 seen most recently.
      const mx = yield* Cache.make({
        capacity: 5000,
        timeToLive: Duration.hours(1),
        lookup: (domain: string) =>
          Effect.tryPromise(() => resolveMx(domain)).pipe(
            Effect.map((records) => records.length > 0),
            // ENOTFOUND / ENODATA: no such domain or no MX. Anything else: don't know, so yes.
            Effect.catch((failure) => {
              const code = (failure.cause as { code?: string } | undefined)?.code
              return Effect.succeed(!(code === "ENOTFOUND" || code === "ENODATA"))
            }),
            // A slow DNS server isn't the visitor's fault.
            Effect.timeoutOrElse({ duration: Duration.seconds(3), orElse: () => Effect.succeed(true) }),
          ),
      })
      return {
        acceptsMail: (domain) => Cache.get(mx, domain),
        isDisposable: (domain) => isDisposableEmailDomain(domain),
      }
    }),
  )
}
