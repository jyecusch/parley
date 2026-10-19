import { Schema } from "effect"
import { Role } from "../access.ts"
import { SignInRequired } from "../errors/access.ts"
import { TeamId } from "../ids.ts"
import { defineOperation, defineTeamOperation } from "../operation.ts"

export const Team = Schema.Struct({
  id: TeamId,
  name: Schema.String,
  /** The principal's role in this team. */
  role: Role,
  /** Whether contacts without a picture show their Gravatar (D77). Off by default. */
  gravatar: Schema.Boolean,
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
  errors: [SignInRequired],
  http: { method: "POST", path: "/teams" },
  hints: { readOnly: false, destructive: false, idempotent: false },
})

export const updateTeam = defineTeamOperation({
  name: "teams.update",
  description: "Rename a team, or change its settings. Owners only.",
  input: Schema.Struct({
    teamId: TeamId.annotate({ description: "The team, from teams.list." }),
    name: Schema.optional(
      Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80)).annotate({
        title: "Team name",
      }),
    ),
    gravatar: Schema.optional(
      Schema.Boolean.annotate({
        title: "Gravatar",
        description: "Show contacts' Gravatar pictures, looked up by their primary email (D77).",
      }),
    ),
  }),
  output: Team,
  errors: [],
  http: { method: "PATCH", path: "/teams/:teamId" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["team:manage"],
})
