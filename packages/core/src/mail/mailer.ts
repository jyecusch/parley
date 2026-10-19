import {
  type EmailError,
  EmailNotConfigured,
  EmailRejected,
  EmailSendingTooFast,
  EmailServiceUnavailable,
} from "@parley/domain"
import { Config, Context, Duration, Effect, Layer, Option, Redacted, Ref } from "effect"

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

export interface SentEmail {
  /** The provider's id for the message, for tracing deliveries. */
  readonly providerId: string
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
    /** Messages sent in this process when no provider is configured. Empty with a real provider. */
    readonly outbox: Effect.Effect<ReadonlyArray<OutgoingEmail>>
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
        return {
          send: record,
          sendBatch: (emails) => Effect.forEach(emails, record),
          outbox: Ref.get(outbox),
        }
      }

      const key = Redacted.value(apiKey.value)
      const sender = (email: OutgoingEmail) => email.from ?? Option.getOrUndefined(from)

      /** Resend's errors, in our classes (Q-E8). */
      const classify = (status: number, body: string, retryAfter: string | null): EmailError => {
        if (status === 429) {
          const seconds = Number(retryAfter)
          return new EmailSendingTooFast({ retryAfter: Duration.seconds(Number.isFinite(seconds) ? seconds : 60) })
        }
        if (status >= 500) return new EmailServiceUnavailable({ cause: `status ${status}: ${body.slice(0, 200)}` })
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

      const post = (path: string, body: unknown) =>
        Effect.callback<unknown, EmailError>((resume) => {
          fetch(`https://api.resend.com${path}`, {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: JSON.stringify(body),
          }).then(
            async (response) => {
              const text = await response.text()
              if (!response.ok) {
                resume(Effect.fail(classify(response.status, text, response.headers.get("retry-after"))))
                return
              }
              try {
                resume(Effect.succeed(JSON.parse(text) as unknown))
              } catch {
                resume(Effect.succeed({}))
              }
            },
            (cause) => resume(Effect.fail(new EmailServiceUnavailable({ cause }))),
          )
        })

      const requireSender = (emails: ReadonlyArray<OutgoingEmail>) =>
        emails.every((email) => sender(email)) ? Effect.void : Effect.fail(new EmailNotConfigured())

      const send = (email: OutgoingEmail) =>
        Effect.gen(function* () {
          yield* requireSender([email])
          const result = (yield* post("/emails", payload(email))) as { readonly id?: string }
          return { providerId: result.id ?? "" }
        }).pipe(Effect.withSpan("Mailer.send"))

      const sendBatch = (emails: ReadonlyArray<OutgoingEmail>) =>
        Effect.gen(function* () {
          if (emails.length === 0) return []
          yield* requireSender(emails)
          const result = (yield* post("/emails/batch", emails.map(payload))) as {
            readonly data?: ReadonlyArray<{ readonly id?: string }>
          }
          return emails.map((_, index) => ({ providerId: result.data?.[index]?.id ?? "" }))
        }).pipe(Effect.withSpan("Mailer.sendBatch"))

      return { send, sendBatch, outbox: Effect.succeed([]) }
    }),
  )
}
