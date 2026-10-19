import { DatabaseLive } from "@parley/db"
import { Layer } from "effect"
import { Authenticator, BetterAuth } from "./auth/authenticator.ts"
import { Mailer } from "./mail/mailer.ts"
import { Affiliations } from "./services/affiliations.ts"
import { ApiKeys } from "./services/api-keys.ts"
import { CampaignSender } from "./services/campaign-sender.ts"
import { Campaigns } from "./services/campaigns.ts"
import { Companies } from "./services/companies.ts"
import { Connections } from "./services/connections.ts"
import { Contacts } from "./services/contacts.ts"
import { CustomFields } from "./services/custom-fields.ts"
import { DeliveryEvents } from "./services/delivery-events.ts"
import { FileStore } from "./services/file-store.ts"
import { Invitations } from "./services/invitations.ts"
import { Members } from "./services/members.ts"
import { Notes } from "./services/notes.ts"
import { Purge } from "./services/purge.ts"
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
export { classifyDecodeError } from "./input/classify.ts"
export { Mailer, type OutgoingEmail } from "./mail/mailer.ts"
export { type Implementation, implementations, type OperationServices } from "./operations/registry.ts"
export type { Principal } from "./principal.ts"
export type { DeliveryEvents } from "./services/delivery-events.ts"
export { FileStore } from "./services/file-store.ts"
export type { Members } from "./services/members.ts"
export type { Subscriptions } from "./services/subscriptions.ts"
export { UnsubscribeLinks } from "./services/unsubscribe-links.ts"

/** Contacts and companies both do domain matching through Affiliations. */
const Records = Layer.mergeAll(Contacts.layer, Companies.layer, SavedViews.layer, Segments.layer, Templates.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(Affiliations.layer, CustomFields.layer, FileStore.layer)),
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
  Campaigns.layer,
  CampaignSender.layer,
  DeliveryEvents.layer,
).pipe(Layer.provideMerge(UnsubscribeLinks.layer))

/** Everything operations and authentication need, built once per process. */
export const CoreLive = Authenticator.layer.pipe(
  Layer.provideMerge(Services),
  Layer.provideMerge(BetterAuth.layer),
  Layer.provideMerge(Mailer.layer),
  Layer.provideMerge(DatabaseLive),
)

export { CampaignSender } from "./services/campaign-sender.ts"
export { Purge } from "./services/purge.ts"

/** Work the server does on its own schedule, such as purging records deleted 30 days ago (D30). */
export const BackgroundLive = Layer.mergeAll(Purge.schedule.pipe(Layer.provide(Purge.layer)), CampaignSender.schedule)
