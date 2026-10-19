import { DatabaseLive } from "@parley/db"
import { Layer } from "effect"
import { Authenticator, BetterAuth } from "./auth/authenticator.ts"
import { ApiKeys } from "./services/api-keys.ts"
import { Contacts } from "./services/contacts.ts"
import { Members } from "./services/members.ts"
import { Teams } from "./services/teams.ts"
import { Users } from "./services/users.ts"

export { type AuthenticationFailure, Authenticator, BetterAuth } from "./auth/authenticator.ts"
export type { Auth } from "./auth/better-auth.ts"
export { classifyDecodeError } from "./input/classify.ts"
export { type Implementation, implementations, type OperationServices } from "./operations/registry.ts"
export type { Principal } from "./principal.ts"

const Services = Layer.mergeAll(Contacts.layer, Members.layer, Users.layer, Teams.layer, ApiKeys.layer)

/** Everything operations and authentication need, built once per process. */
export const CoreLive = Authenticator.layer.pipe(
  Layer.provideMerge(Services),
  Layer.provideMerge(BetterAuth.layer),
  Layer.provideMerge(DatabaseLive),
)
