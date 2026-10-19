import { Schema } from "effect"
import { Role } from "../access.ts"
import { TeamCreationNeedsSignIn } from "../errors/access.ts"
import { TeamId } from "../ids.ts"
import { defineOperation } from "../operation.ts"

export const Team = Schema.Struct({
  id: TeamId,
  name: Schema.String,
  /** The principal's role in this team. */
  role: Role,
})
export type Team = typeof Team.Type

export const listTeams = defineOperation({
  name: "teams.list",
  description:
    "List the teams you can work in, with your role in each. Every other operation needs a teamId from this list.",
  input: Schema.Struct({}),
  output: Schema.Array(Team),
  errors: [],
  http: { method: "GET", path: "/teams" },
  hints: { readOnly: true, destructive: false, idempotent: true },
})

export const createTeam = defineOperation({
  name: "teams.create",
  description: "Create a team. You become its owner. Only a signed-in user can do this, not an API key.",
  input: Schema.Struct({
    name: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80)).annotate({
      title: "Team name",
    }),
  }),
  output: Team,
  errors: [TeamCreationNeedsSignIn],
  http: { method: "POST", path: "/teams" },
  hints: { readOnly: false, destructive: false, idempotent: false },
})
