import { DatabaseLive } from "@parley/db"
import { Layer } from "effect"
import { Authenticator, BetterAuth } from "./auth/authenticator.ts"
import { EmailChecks, FormTokens, Turnstile } from "./forms/protection.ts"
import { Mailer } from "./mail/mailer.ts"
import { Affiliations } from "./services/affiliations.ts"
import { ApiKeys } from "./services/api-keys.ts"
import { BroadcastSender } from "./services/broadcast-sender.ts"
import { Broadcasts } from "./services/broadcasts.ts"
import { Companies } from "./services/companies.ts"
import { Connections } from "./services/connections.ts"
import { Contacts } from "./services/contacts.ts"
import { CustomFields } from "./services/custom-fields.ts"
import { DeliveryEvents } from "./services/delivery-events.ts"
import { EmailImages } from "./services/email-images.ts"
import { EmailStyles } from "./services/email-styles.ts"
import { Encryption } from "./services/encryption.ts"
import { FileStore } from "./services/file-store.ts"
import { FormRuntimeLive } from "./services/form-runtime-live.ts"
import { FormSubmissions } from "./services/form-submissions.ts"
import { Forms } from "./services/forms.ts"
import { ImportRunner } from "./services/import-runner.ts"
import { Imports } from "./services/imports.ts"
import { Invitations } from "./services/invitations.ts"
import { MemberChanges } from "./services/member-changes.ts"
import { Members } from "./services/members.ts"
import { Notes } from "./services/notes.ts"
import { Purge } from "./services/purge.ts"
import { RateLimiter } from "./services/rate-limiter.ts"
import { SavedViews } from "./services/saved-views.ts"
import { Segments } from "./services/segments.ts"
import { Sending } from "./services/sending.ts"
import { ServiceAccounts } from "./services/service-accounts.ts"
import { Subscriptions } from "./services/subscriptions.ts"
import { Teams } from "./services/teams.ts"
import { Templates } from "./services/templates.ts"
import { Topics } from "./services/topics.ts"
import { UnsubscribeLinks } from "./services/unsubscribe-links.ts"
import { Users } from "./services/users.ts"

export { type AuthenticationFailure, Authenticator, BetterAuth, type Entrypoint } from "./auth/authenticator.ts"
export { type Auth, issuer, mcpResource } from "./auth/better-auth.ts"
export { PublicUrl } from "./config/public-url.ts"
export { unsubscribeApply, unsubscribePage } from "./email/unsubscribe.ts"
export { receiveDeliveryEvent } from "./email/webhook.ts"
export { readFile } from "./files/serve.ts"
export { EmailChecks, FormTokens, Turnstile } from "./forms/protection.ts"
export { classifyDecodeError } from "./input/classify.ts"
export { Mailer, type OutgoingEmail } from "./mail/mailer.ts"
export { type Implementation, implementations, type OperationServices } from "./operations/registry.ts"
export type { Principal } from "./principal.ts"
export type { DeliveryEvents } from "./services/delivery-events.ts"
export { EmailImages } from "./services/email-images.ts"
export { Encryption } from "./services/encryption.ts"
export { FileStore } from "./services/file-store.ts"
export * from "./services/form-runtime.ts"
export { Forms } from "./services/forms.ts"
export type { Members } from "./services/members.ts"
export { RateLimiter } from "./services/rate-limiter.ts"
export type { Subscriptions } from "./services/subscriptions.ts"
export { UnsubscribeLinks } from "./services/unsubscribe-links.ts"
export { Users } from "./services/users.ts"

/** Contacts and companies both do domain matching through Affiliations. */
const Records = Layer.mergeAll(
  Contacts.layer,
  Companies.layer,
  SavedViews.layer,
  Segments.layer,
  Templates.layer,
  EmailStyles.layer,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(Affiliations.layer, CustomFields.layer, EmailImages.layer).pipe(Layer.provideMerge(FileStore.layer)),
  ),
)

const Services = Layer.mergeAll(
  Records,
  Members.layer,
  Invitations.layer,
  Notes.layer,
  Purge.layer,
  Users.layer,
  Teams.layer,
  ApiKeys.layer,
  Connections.layer,
  ServiceAccounts.layer,
  Topics.layer,
  Sending.layer,
  Subscriptions.layer,
  Broadcasts.layer,
  BroadcastSender.layer,
  DeliveryEvents.layer,
  Imports.layer,
).pipe(Layer.provideMerge(Layer.mergeAll(UnsubscribeLinks.layer, RateLimiter.layer, MemberChanges.layer)))

/** Forms (D144–D150), built on the services: their submissions write contacts as any change does. */
const formsLive = (outside: Layer.Layer<Turnstile | EmailChecks>) =>
  Layer.mergeAll(Forms.layer, FormRuntimeLive).pipe(
    Layer.provideMerge(FormSubmissions.layer),
    Layer.provideMerge(Layer.mergeAll(Encryption.layer, FormTokens.layer, outside)),
  )

/**
 * Everything operations and authentication need, built once per process. `outside` stands in for
 * the network calls forms make (Cloudflare Turnstile, DNS), which tests replace.
 */
export const coreLiveWith = (outside: Layer.Layer<Turnstile | EmailChecks>) =>
  Authenticator.layer.pipe(
    // The runner imports rows as any operation would, so it is built on every service.
    Layer.provideMerge(ImportRunner.layer),
    Layer.provideMerge(formsLive(outside)),
    Layer.provideMerge(Services),
    Layer.provideMerge(BetterAuth.layer),
    Layer.provideMerge(Mailer.layer),
    Layer.provideMerge(DatabaseLive),
  )

export const CoreLive = coreLiveWith(Layer.mergeAll(Turnstile.layer, EmailChecks.layer))

export { BroadcastSender } from "./services/broadcast-sender.ts"
export { ImportRunner } from "./services/import-runner.ts"
export { Purge } from "./services/purge.ts"

/** Work the server does on its own schedule, such as purging records deleted 30 days ago (D30). */
export const BackgroundLive = Layer.mergeAll(
  Encryption.reencrypt,
  Purge.schedule.pipe(Layer.provide(Purge.layer)),
  BroadcastSender.schedule,
  ImportRunner.schedule,
)
