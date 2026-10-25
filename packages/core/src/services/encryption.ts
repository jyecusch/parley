import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto"
import { Database, schema } from "@parley/db"
import { and, eq, isNotNull } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import { rotatingSecret } from "../config/rotating-secret.ts"

/**
 * "v1.", the key's id, ".", then base64url of a 12-byte IV, the ciphertext and the 16-byte tag.
 * The id says which key encrypted it, so keys can be rotated (D152).
 */
const PREFIX = "v1."

const KEY_HELP = "32 random bytes, base64 (openssl rand -base64 32)"

/** A key's id: the start of its SHA-256, so values can name their key without revealing it. */
const keyId = (key: Buffer): string => createHash("sha256").update(key).digest("base64url").slice(0, 8)

const parseKey = (name: string, value: string): Buffer => {
  const bytes = Buffer.from(value.trim(), "base64")
  if (bytes.length !== 32) throw new Error(`${name} must be ${KEY_HELP}`)
  return bytes
}

/**
 * Encrypts secrets Parley stores for teams, such as a Turnstile secret key (D147): AES-256-GCM.
 * Process tier: holds only the keys.
 *
 * The encryption key is PARLEY_ENCRYPTION_KEY (in development it falls back to one derived from the
 * sign-in secret). To rotate it (D152), move the old key to PARLEY_ENCRYPTION_KEYS_PREVIOUS
 * (comma-separated) and set a new one: values encrypted with a previous key still decrypt, and
 * `reencrypt` moves them to the new key at startup. Once that has run, the previous key can go.
 */
export class Encryption extends Context.Service<
  Encryption,
  {
    /** Encrypts with the current key. */
    readonly encrypt: (plaintext: string) => string
    /** Undefined when no key Parley has encrypted the value. */
    readonly decrypt: (stored: string) => string | undefined
    /** Whether a value was encrypted with the current key, so needs nothing on rotation. */
    readonly isCurrent: (stored: string) => boolean
  }
>()("@parley/core/Encryption") {
  static readonly layer = Layer.effect(
    Encryption,
    Effect.gen(function* () {
      // In production the key can't be the sign-in secret: rotating that would make stored secrets
      // unreadable, since nothing would know to keep the old one.
      const { current: own, previous } = yield* rotatingSecret(
        "PARLEY_ENCRYPTION_KEY",
        "PARLEY_ENCRYPTION_KEYS_PREVIOUS",
        `${KEY_HELP}.`,
      )
      const auth = yield* Config.Redacted("BETTER_AUTH_SECRET").pipe(Effect.orDie)
      const current = Option.match(own, {
        onSome: (value) => parseKey("PARLEY_ENCRYPTION_KEY", value),
        onNone: () => Buffer.from(hkdfSync("sha256", Redacted.value(auth), "parley", "parley-encryption-v1", 32)),
      })
      const retired = previous.map((entry) => parseKey("Each key in PARLEY_ENCRYPTION_KEYS_PREVIOUS", entry))
      const currentId = keyId(current)
      const keys = new Map([...retired, current].map((key) => [keyId(key), key]))

      const open = (key: Buffer, raw: Buffer): string | undefined => {
        try {
          const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12))
          decipher.setAuthTag(raw.subarray(raw.length - 16))
          return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8")
        } catch {
          return undefined
        }
      }
      return {
        encrypt: (plaintext) => {
          const iv = randomBytes(12)
          const cipher = createCipheriv("aes-256-gcm", current, iv)
          const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
          return `${PREFIX}${currentId}.${Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url")}`
        },
        decrypt: (stored) => {
          if (!stored.startsWith(PREFIX)) return undefined
          const [id, payload] = stored.slice(PREFIX.length).split(".")
          const key = id ? keys.get(id) : undefined
          return key && payload ? open(key, Buffer.from(payload, "base64url")) : undefined
        },
        isCurrent: (stored) => stored.startsWith(`${PREFIX}${currentId}.`),
      }
    }),
  )

  /**
   * Moves every stored secret to the current key (D152), once at startup. A value no key opens is
   * left as it is and logged: its key was removed before this ran.
   */
  static readonly reencrypt = Layer.effectDiscard(
    Effect.gen(function* () {
      const encryption = yield* Encryption
      const db = yield* Database
      const rows = yield* db.query((d) =>
        d
          .select({ teamId: schema.formSettings.teamId, secret: schema.formSettings.turnstileSecret })
          .from(schema.formSettings)
          .where(isNotNull(schema.formSettings.turnstileSecret)),
      )
      let moved = 0
      for (const row of rows) {
        const stored = row.secret
        if (!stored || encryption.isCurrent(stored)) continue
        const plaintext = encryption.decrypt(stored)
        if (plaintext === undefined) {
          yield* Effect.logWarning(
            `A team's Turnstile secret is encrypted with a key Parley no longer has: ${row.teamId}`,
          )
          continue
        }
        // Only if it hasn't changed meanwhile, as another server may be doing the same.
        yield* db.query((d) =>
          d
            .update(schema.formSettings)
            .set({ turnstileSecret: encryption.encrypt(plaintext) })
            .where(and(eq(schema.formSettings.teamId, row.teamId), eq(schema.formSettings.turnstileSecret, stored))),
        )
        moved++
      }
      if (moved > 0) yield* Effect.logInfo(`Re-encrypted ${moved} stored secrets with the current encryption key`)
    }).pipe(
      Effect.catch((error) =>
        Effect.logError("Re-encrypting stored secrets failed; it runs again at the next start", error),
      ),
    ),
  )
}
