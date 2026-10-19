import { DatabaseLive } from "@parley/db"
import { Layer } from "effect"
import { Authenticator, BetterAuth } from "./auth/authenticator.ts"
import { Mailer } from "./mail/mailer.ts"
import { Affiliations } from "./services/affiliations.ts"
import { ApiKeys } from "./services/api-keys.ts"
import { Companies } from "./services/companies.ts"
import { Connections } from "./services/connections.ts"
import { Contacts } from "./services/contacts.ts"
import { CustomFields } from "./services/custom-fields.ts"
import { FileStore } from "./services/file-store.ts"
import { Invitations } from "./services/invitations.ts"
import { Members } from "./services/members.ts"
import { Notes } from "./services/notes.ts"
import { Purge } from "./services/purge.ts"
import { SavedViews } from "./services/saved-views.ts"
import { ServiceAccounts } from "./services/service-accounts.ts"
import { Teams } from "./services/teams.ts"
import { Users } from "./services/users.ts"

export { type AuthenticationFailure, Authenticator, BetterAuth, type Entrypoint } from "./auth/authenticator.ts"
export { type Auth, issuer, mcpResource } from "./auth/better-auth.ts"
export { readFile } from "./files/serve.ts"
export { classifyDecodeError } from "./input/classify.ts"
export { Mailer, type OutgoingEmail } from "./mail/mailer.ts"
export { type Implementation, implementations, type OperationServices } from "./operations/registry.ts"
export type { Principal } from "./principal.ts"
export { FileStore } from "./services/file-store.ts"
export type { Members } from "./services/members.ts"

/** Contacts and companies both do domain matching through Affiliations. */
const Records = Layer.mergeAll(Contacts.layer, Companies.layer, SavedViews.layer).pipe(
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
)

/** Everything operations and authentication need, built once per process. */
export const CoreLive = Authenticator.layer.pipe(
  Layer.provideMerge(Services),
  Layer.provideMerge(BetterAuth.layer),
  Layer.provideMerge(Mailer.layer),
  Layer.provideMerge(DatabaseLive),
)

export { Purge } from "./services/purge.ts"

/** Work the server does on its own schedule, such as purging records deleted 30 days ago (D30). */
export const BackgroundLive = Purge.schedule.pipe(Layer.provide(Purge.layer))
