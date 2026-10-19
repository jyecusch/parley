import { Schema } from "effect"
import { ServiceAccountNotFound } from "../errors/service-accounts.ts"
import { TeamId, UserId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"
import { ServiceAccount } from "../service-account.ts"

const OneServiceAccount = {
  teamId: TeamId.annotate({ description: "The team, from teams.list." }),
  serviceAccountId: UserId.annotate({ description: "The service account's id, from serviceAccounts.list." }),
}

export const updateServiceAccount = defineTeamOperation({
  name: "serviceAccounts.update",
  description: "Rename a service account or change its role.",
  input: Schema.Struct({
    ...OneServiceAccount,
    name: Schema.optional(
      Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(60)).annotate({
        title: "Name",
      }),
    ),
    role: Schema.optional(Schema.Literals(["admin", "member"]).annotate({ title: "Role" })),
  }),
  output: ServiceAccount,
  errors: [ServiceAccountNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/service-accounts/:serviceAccountId" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["service-accounts:manage"],
})

export const deleteServiceAccount = defineTeamOperation({
  name: "serviceAccounts.delete",
  description:
    "Delete a service account. Its API keys and connections stop working at once. Its activity and notes stay, under its name.",
  input: Schema.Struct(OneServiceAccount),
  output: ServiceAccount,
  errors: [ServiceAccountNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/service-accounts/:serviceAccountId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["service-accounts:manage"],
})
