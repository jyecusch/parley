import { Schema } from "effect"
import { CustomField, CustomFieldName, CustomFieldType, SelectOption } from "../custom-field.ts"
import { CustomFieldNameTaken, CustomFieldNotFound } from "../errors/custom-fields.ts"
import { CustomFieldId, TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"
import { RecordType } from "../record-type.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneField = { ...InTeam, fieldId: CustomFieldId.annotate({ description: "The field's id, from fields.list." }) }
const Options = Schema.Array(SelectOption).check(Schema.isMaxLength(200)).annotate({
  title: "Options",
  description: "For select fields: the choices, each with a stable id (any short string) and a label.",
})

export const listFields = defineTeamOperation({
  name: "fields.list",
  description:
    "List a team's custom fields, in order, for contacts or companies or both. Set a record's values by field id with contacts.update or companies.update.",
  input: Schema.Struct({ ...InTeam, recordType: Schema.optional(RecordType) }),
  output: Schema.Array(CustomField),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/fields" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createField = defineTeamOperation({
  name: "fields.create",
  description:
    "Add a custom field to contacts or companies. Its name must be new for that record type and not a built-in field's. A field's type can't change later.",
  input: Schema.Struct({
    ...InTeam,
    recordType: RecordType.annotate({ title: "Record type" }),
    name: CustomFieldName.annotate({ title: "Name" }),
    type: CustomFieldType.annotate({ title: "Type" }),
    options: Schema.optional(Options),
  }),
  output: CustomField,
  errors: [CustomFieldNameTaken],
  http: { method: "POST", path: "/teams/:teamId/fields" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["fields:manage"],
})

export const updateField = defineTeamOperation({
  name: "fields.update",
  description:
    "Rename a custom field, reorder it, or change a select field's options. Removing an option clears it from every record.",
  input: Schema.Struct({
    ...OneField,
    name: Schema.optional(CustomFieldName.annotate({ title: "Name" })),
    options: Schema.optional(Options),
    position: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ title: "Position" })),
  }),
  output: CustomField,
  errors: [CustomFieldNotFound, CustomFieldNameTaken],
  http: { method: "PATCH", path: "/teams/:teamId/fields/:fieldId" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["fields:manage"],
})

export const deleteField = defineTeamOperation({
  name: "fields.delete",
  description: "Delete a custom field and its value on every record. This can't be undone.",
  input: Schema.Struct(OneField),
  output: CustomField,
  errors: [CustomFieldNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/fields/:fieldId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["fields:manage"],
})
