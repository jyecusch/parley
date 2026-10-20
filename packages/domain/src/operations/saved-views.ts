import { Schema } from "effect"
import { SavedViewNotFound } from "../errors/saved-views.ts"
import { Filter, Sort } from "../filter.ts"
import { SavedViewId, TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"
import { RecordType } from "../record-type.ts"
import { SavedView, SavedViewName } from "../saved-view.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneView = { ...InTeam, viewId: SavedViewId.annotate({ description: "The view's id, from savedViews.list." }) }
const Columns = Schema.Array(Schema.String.check(Schema.isMaxLength(80)))
  .check(Schema.isMaxLength(40))
  .annotate({ title: "Columns", description: 'Extra columns, like "custom:<field id>", in order.' })

export const listSavedViews = defineTeamOperation({
  name: "savedViews.list",
  description:
    "List the saved views you can use: the team's shared ones and your own. Pass a view's filter and sort to contacts.list or companies.list.",
  input: Schema.Struct({ ...InTeam, recordType: Schema.optional(RecordType) }),
  output: Schema.Array(SavedView),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/saved-views" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createSavedView = defineTeamOperation({
  name: "savedViews.create",
  description:
    "Save a filter, sort and columns as a named view. Personal unless shared; sharing with the team needs records:write.",
  input: Schema.Struct({
    ...InTeam,
    recordType: RecordType.annotate({ title: "Record type" }),
    name: SavedViewName.annotate({ title: "Name" }),
    shared: Schema.optional(Schema.Boolean.annotate({ title: "Shared with the team" })),
    filter: Schema.optional(Filter),
    sort: Schema.optional(Schema.NullOr(Sort)),
    columns: Schema.optional(Columns),
  }),
  output: SavedView,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/saved-views" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read"],
})

export const updateSavedView = defineTeamOperation({
  name: "savedViews.update",
  description: "Change a saved view. Your own personal views, or shared views if you have records:write.",
  input: Schema.Struct({
    ...OneView,
    name: Schema.optional(SavedViewName.annotate({ title: "Name" })),
    shared: Schema.optional(Schema.Boolean.annotate({ title: "Shared with the team" })),
    filter: Schema.optional(Filter),
    sort: Schema.optional(Schema.NullOr(Sort)),
    columns: Schema.optional(Columns),
  }),
  output: SavedView,
  errors: [SavedViewNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/saved-views/:viewId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read"],
})

export const deleteSavedView = defineTeamOperation({
  name: "savedViews.delete",
  description: "Delete a saved view. Your own personal views, or shared views if you have records:write.",
  input: Schema.Struct(OneView),
  output: SavedView,
  errors: [SavedViewNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/saved-views/:viewId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read"],
})
