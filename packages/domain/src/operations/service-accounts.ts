import { Schema } from "effect"
import { TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"
import { ServiceAccount } from "../service-account.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }

export const listServiceAccounts = defineTeamOperation({
  name: "serviceAccounts.list",
  description: "List a team's service accounts, the non-human members that agents and API keys can act as.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(ServiceAccount),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/service-accounts" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: [],
})

export const createServiceAccount = defineTeamOperation({
  name: "serviceAccounts.create",
  description:
    "Create a service account in a team, with a role. Agents can then be connected as it, so their changes are attributed to it rather than to a person.",
  input: Schema.Struct({
    ...InTeam,
    name: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(60)).annotate({
      title: "Name",
      description: 'Shown in activity: "Sync bot".',
    }),
    role: Schema.optional(
      Schema.Literals(["admin", "member"]).annotate({ title: "Role", description: 'Defaults to "member".' }),
    ),
  }),
  output: ServiceAccount,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/service-accounts" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["service-accounts:manage"],
})

export { deleteServiceAccount, updateServiceAccount } from "./service-accounts-manage.ts"
