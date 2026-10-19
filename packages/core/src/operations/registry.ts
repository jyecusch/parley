import type { OperationError, OperationInput, OperationName, OperationOutput, Operations } from "@parley/domain"
import type { Effect } from "effect"
import type { Principal } from "../principal.ts"
import type { Contacts } from "../services/contacts.ts"
import type { Members } from "../services/members.ts"
import type { Teams } from "../services/teams.ts"
import * as contacts from "./contacts.ts"
import * as teams from "./teams.ts"

/** The services operations run on. Entrypoints provide CoreLive. */
export type OperationServices = Contacts | Members | Teams

export type Implementation<Name extends OperationName> = (
  principal: Principal,
  input: OperationInput<Operations[Name]>,
) => Effect.Effect<OperationOutput<Operations[Name]>, OperationError<Operations[Name]>, OperationServices>

/**
 * Every operation's implementation. The mapped type makes a missing operation, an extra error,
 * or a wrong output a compile error.
 */
export const implementations: { readonly [Name in OperationName]: Implementation<Name> } = {
  "teams.list": teams.list,
  "teams.create": teams.create,
  "contacts.list": contacts.list,
  "contacts.get": contacts.get,
  "contacts.create": contacts.create,
  "contacts.update": contacts.update,
  "contacts.delete": contacts.remove,
  "contacts.restore": contacts.restore,
  "contacts.activity": contacts.activity,
}
