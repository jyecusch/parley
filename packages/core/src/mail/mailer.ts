import { createHash } from "node:crypto"
import type { DnsRecord } from "@parley/domain"
import {
  EmailBatchReplayUnsafe,
  type EmailError,
  EmailNotConfigured,
  EmailRejected,
  EmailSendingTooFast,
  EmailServiceUnavailable,
} from "@parley/domain"
import { Config, Context, Duration, Effect, Layer, Option, Redacted, Ref, Schema } from "effect"

import { ProviderPacing } from "../services/provider-pacing.ts"

/** One email. The sender comes from configuration unless given. */
export interface OutgoingEmail {
  readonly to: string
  readonly subject: string
  readonly html: string
  readonly text: string
  readonly from?: string
  readonly replyTo?: string
  /** Extra headers, such as List-Unsubscribe (RFC 8058). */
  readonly headers?: Readonly<Record<string, string>>
}

/** A sending domain as the provider sees it (R44). */
export interface ProviderDomain {
  readonly providerId: string
  readonly status: "pending" | "verified" | "failed"
  readonly records: ReadonlyArray<DnsRecord>
}

export interface SentEmail {
  /** The provider's id for the message, for tracing deliveries. */
  readonly providerId: string
}

/** Exact request bytes, including the resolved sender, safe to persist before dispatch. */
export interface PreparedBatch {
  readonly payload: string
  readonly providerIdentity: string
}

export interface DeliverBatchInput extends PreparedBatch {
  readonly idempotencyKey: string
  readonly count: number
  readonly retryUntil: Date
}

/**
 * Sends email (D50). Process tier: one per server. Resend is the default (D15); without a key,
 * messages go to the log and an in-memory outbox, which tests read.
 */
export class Mailer extends Context.Service<
  Mailer,
  {
    readonly send: (email: OutgoingEmail) => Effect.Effect<SentEmail, EmailError>
    /** Sends up to 100 at once where the provider supports it. Results line up with the input. */
    readonly sendBatch: (emails: ReadonlyArray<OutgoingEmail>) => Effect.Effect<ReadonlyArray<SentEmail>, EmailError>
    readonly prepareBatch: (emails: ReadonlyArray<OutgoingEmail>) => Effect.Effect<PreparedBatch, EmailError>
    readonly deliverBatch: (
      input: DeliverBatchInput,
    ) => Effect.Effect<ReadonlyArray<SentEmail>, EmailError | EmailBatchReplayUnsafe>
    /** Messages sent in this process when no provider is configured. Empty with a real provider. */
    readonly outbox: Effect.Effect<ReadonlyArray<OutgoingEmail>>
    /** Registers sending domains with the provider. Without one, every domain counts as verified. */
    readonly domains: {
      readonly create: (domain: string) => Effect.Effect<ProviderDomain, EmailError>
      /** Asks the provider to check the DNS records again, and returns what it found. */
      readonly verify: (providerId: string) => Effect.Effect<ProviderDomain, EmailError>
      readonly remove: (providerId: string) => Effect.Effect<void, EmailError>
    }
  }
>()("@parley/core/Mailer") {
  static readonly layer = Layer.effect(
    Mailer,
    Effect.gen(function* () {
      const apiKey = yield* Config.option(Config.Redacted("RESEND_API_KEY")).pipe(Effect.orDie)
      const from = yield* Config.option(Config.String("EMAIL_FROM")).pipe(Effect.orDie)
      const outbox = yield* Ref.make<ReadonlyArray<OutgoingEmail>>([])

      if (Option.isNone(apiKey)) {
        const record = (email: OutgoingEmail) =>
          Effect.gen(function* () {
            yield* Ref.update(outbox, (sent) => [...sent, email])
            yield* Effect.logInfo(`email (not sent, no RESEND_API_KEY) to ${email.to}: ${email.subject}`)
            return { providerId: `log-${crypto.randomUUID()}` }
          })
        const verified = (providerId: string): ProviderDomain => ({ providerId, status: "verified", records: [] })
        const sent = new Map<string, ReadonlyArray<SentEmail>>()
        return {
          prepareBatch: (emails) => Effect.succeed({ payload: JSON.stringify(emails), providerIdentity: "outbox" }),
          deliverBatch: (input) =>
            Effect.gen(function* () {
              if (input.providerIdentity !== "outbox" || input.retryUntil.getTime() <= Date.now())
                return yield* new EmailBatchReplayUnsafe()
              const prior = sent.get(input.idempotencyKey)
              if (prior) return prior
              const result = yield* Effect.forEach(JSON.parse(input.payload) as OutgoingEmail[], record)
              sent.set(input.idempotencyKey, result)
              return result
            }),
          send: record,
          sendBatch: (emails) => Effect.forEach(emails, record),
          outbox: Ref.get(outbox),
          domains: {
            create: (domain) => Effect.succeed(verified(`log-${domain}`)),
            verify: (providerId) => Effect.succeed(verified(providerId)),
            remove: () => Effect.void,
          },
        }
      }

      const pacing = yield* ProviderPacing
      const key = Redacted.value(apiKey.value)
      const providerIdentity = createHash("sha256").update(key).digest("hex")
      const sender = (email: OutgoingEmail) => email.from ?? Option.getOrUndefined(from)

      /** Resend's errors, in our classes (Q-E8). */
      const classify = (status: number, body: string, retryAfter: string | null): EmailError => {
        if (status === 429) {
          const seconds = retryAfter === null ? Number.NaN : Number(retryAfter)
          return new EmailSendingTooFast({ retryAfter: Duration.seconds(Number.isFinite(seconds) ? seconds : 60) })
        }
        if (status >= 500 || status === 409)
          return new EmailServiceUnavailable({ cause: `status ${status}: ${body.slice(0, 200)}` })
        return new EmailRejected({ reason: `status ${status}: ${body.slice(0, 300)}` })
      }

      const payload = (email: OutgoingEmail) => ({
        from: sender(email),
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        ...(email.headers ? { headers: email.headers } : {}),
      })

      const request = (method: string, path: string, body?: string, idempotencyKey?: string, retryUntil?: Date) =>
        Effect.gen(function* () {
          yield* pacing.wait
          if (retryUntil && retryUntil.getTime() <= Date.now()) return yield* new EmailBatchReplayUnsafe()
          const response = yield* Effect.tryPromise({
            try: async (signal) => {
              const response = await fetch(`https://api.resend.com${path}`, {
                method,
                signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
                headers: {
                  authorization: `Bearer ${key}`,
                  "content-type": "application/json",
                  ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
                },
                ...(body === undefined ? {} : { body }),
              })
              return {
                ok: response.ok,
                status: response.status,
                retryAfter: response.headers.get("retry-after"),
                text: await response.text(),
              }
            },
            catch: (cause) => new EmailServiceUnavailable({ cause }),
          })
          if (!response.ok) return yield* classify(response.status, response.text, response.retryAfter)
          return yield* Effect.try({
            try: () => (response.text ? (JSON.parse(response.text) as unknown) : {}),
            catch: (cause) => new EmailServiceUnavailable({ cause }),
          })
        })

      const post = (path: string, body: unknown) =>
        request("POST", path, JSON.stringify(body)).pipe(Effect.catchTag("EmailBatchReplayUnsafe", Effect.die))
      const ordinaryRequest = (method: string, path: string) =>
        request(method, path).pipe(Effect.catchTag("EmailBatchReplayUnsafe", Effect.die))

      interface ResendDomain {
        readonly id?: string
        readonly status?: string
        readonly records?: ReadonlyArray<{
          readonly type?: string
          readonly name?: string
          readonly value?: string
          readonly priority?: number
          readonly status?: string
        }>
      }
      const statusOf = (status: string | undefined): ProviderDomain["status"] =>
        status === "verified" ? "verified" : status === "failed" ? "failed" : "pending"
      const toDomain = (domain: ResendDomain): ProviderDomain => ({
        providerId: domain.id ?? "",
        status: statusOf(domain.status),
        records: (domain.records ?? []).map((record) => ({
          type: record.type ?? "",
          name: record.name ?? "",
          value: record.value ?? "",
          priority: record.priority ?? null,
          status: statusOf(record.status),
        })),
      })
      const domains = {
        create: (domain: string) =>
          Effect.map(post("/domains", { name: domain }), (result) => toDomain(result as ResendDomain)),
        verify: (providerId: string) =>
          Effect.gen(function* () {
            const path = `/domains/${encodeURIComponent(providerId)}`
            const current = toDomain((yield* ordinaryRequest("GET", path)) as ResendDomain)
            // Asking Resend to verify starts a fresh DNS check, which puts a verified domain back
            // to pending until it finishes, so a verified domain is left alone.
            if (current.status === "verified") return current
            yield* post(`${path}/verify`, {})
            return toDomain((yield* ordinaryRequest("GET", path)) as ResendDomain)
          }),
        remove: (providerId: string) =>
          ordinaryRequest("DELETE", `/domains/${encodeURIComponent(providerId)}`).pipe(Effect.asVoid),
      }

      const requireSender = (emails: ReadonlyArray<OutgoingEmail>) =>
        emails.every((email) => sender(email)) ? Effect.void : Effect.fail(new EmailNotConfigured())

      const send = (email: OutgoingEmail) =>
        Effect.gen(function* () {
          yield* requireSender([email])
          const result = yield* Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.NonEmptyString }))(
            yield* post("/emails", payload(email)),
          ).pipe(Effect.mapError((cause) => new EmailServiceUnavailable({ cause })))
          return { providerId: result.id }
        }).pipe(Effect.withSpan("Mailer.send"))

      const prepareBatch = (emails: ReadonlyArray<OutgoingEmail>) =>
        Effect.gen(function* () {
          yield* requireSender(emails)
          return { payload: JSON.stringify(emails.map(payload)), providerIdentity }
        })
      const deliverBatch = (input: DeliverBatchInput) =>
        Effect.gen(function* () {
          if (input.providerIdentity !== providerIdentity) return yield* new EmailBatchReplayUnsafe()
          const result = yield* request("POST", "/emails/batch", input.payload, input.idempotencyKey, input.retryUntil)
          const decoded = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })) }),
          )(result).pipe(Effect.mapError((cause) => new EmailServiceUnavailable({ cause })))
          if (
            decoded.data.length !== input.count ||
            new Set(decoded.data.map((email) => email.id)).size !== input.count
          )
            return yield* new EmailServiceUnavailable({ cause: "Provider returned the wrong number of email IDs" })
          return decoded.data.map(({ id }) => ({ providerId: id }))
        }).pipe(Effect.withSpan("Mailer.deliverBatch"))
      const sendBatch = (emails: ReadonlyArray<OutgoingEmail>) =>
        Effect.gen(function* () {
          if (emails.length === 0) return []
          const prepared = yield* prepareBatch(emails)
          return yield* deliverBatch({
            ...prepared,
            count: emails.length,
            idempotencyKey: crypto.randomUUID(),
            retryUntil: new Date(Date.now() + 60_000),
          }).pipe(
            Effect.catchTag("EmailBatchReplayUnsafe", () =>
              Effect.fail(new EmailServiceUnavailable({ cause: "Dispatch deadline passed" })),
            ),
          )
        })
      return { send, sendBatch, prepareBatch, deliverBatch, outbox: Effect.succeed([]), domains }
    }),
  )
}
