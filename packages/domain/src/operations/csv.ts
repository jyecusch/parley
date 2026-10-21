import { Schema } from "effect"
import { SegmentNotFound } from "../errors/broadcasts.ts"
import { FieldProblem } from "../errors/input.ts"
import { Filter } from "../filter.ts"
import { SegmentId, TeamId, UserId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }

export const ExportResult = Schema.Struct({
  /** The records as CSV, with a header row. */
  csv: Schema.String,
  count: Schema.Number,
})

export const ImportResult = Schema.Struct({
  created: Schema.Number,
  updated: Schema.Number,
  /** Rows that weren't imported, by their line in the file (the header is line 1), and why. */
  failed: Schema.Array(Schema.Struct({ line: Schema.Number, problems: Schema.Array(FieldProblem) })),
  /** Rows imported without a value that couldn't be used, such as an unknown owner (D126). */
  warnings: Schema.Array(Schema.Struct({ line: Schema.Number, problems: Schema.Array(FieldProblem) })),
})
export type ImportResult = typeof ImportResult.Type

const exportInput = Schema.Struct({
  ...InTeam,
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(200)).annotate({ title: "Search" })),
  filter: Schema.optional(Filter),
  ids: Schema.optional(
    Schema.Array(Schema.String)
      .check(Schema.isMaxLength(10_000))
      .annotate({ title: "Records", description: "Export only these ids, such as a selection." }),
  ),
})

/** How a file's columns become fields, shared by contacts.import, companies.import and imports.start. */
export const ImportOptions = {
  mapping: Schema.optional(
    Schema.Record(Schema.String, Schema.String).annotate({
      title: "Column mapping",
      description:
        'Which field each column (by header) fills, like {"Work email":"email","Plan":"custom:<field id>"}, or "topic:<topic id>" for a column that\'s true when the contact left that topic (D127). Columns left out are skipped. Without a mapping, Parley guesses from the headers.',
    }),
  ),
  set: Schema.optional(
    Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(2000))).annotate({
      title: "Set on every row",
      description:
        'Values for every imported row, keyed like mapping targets and written as a cell would be, like {"custom:<field id>":"Suga Cloud"}. A row\'s own value wins, except for multi-select fields, where both are kept.',
    }),
  ),
  owners: Schema.optional(
    Schema.Record(Schema.String, Schema.NullOr(UserId)).annotate({
      title: "Record owners",
      description:
        'Who an owner cell means, by its text, like {"Matt Stoll (Deactivated User)":"<userId>"}, or null for no one. Cells not listed match a member by email or unique name; otherwise the row is imported without an owner, with a warning (D126, D127).',
    }),
  ),
  multiSelect: Schema.optional(
    Schema.Literals(["add", "replace"]).annotate({
      title: "Multi-select fields",
      description:
        "When a row updates an existing record: add (the default) keeps its values and adds the row's; replace uses only the row's.",
    }),
  ),
}

const importInput = Schema.Struct({
  ...InTeam,
  csv: Schema.String.check(Schema.isMaxLength(5_000_000)).annotate({
    title: "CSV",
    description: "The file's text, with a header row. Up to 5,000 rows. For a bigger file, use imports.start.",
  }),
  ...ImportOptions,
})

export const exportContacts = defineTeamOperation({
  name: "contacts.export",
  description:
    "Export contacts as CSV: all of them, those matching a filter, a segment's contacts, or a given list. Custom fields are included as columns.",
  input: Schema.Struct({
    ...exportInput.fields,
    segmentId: Schema.optional(
      SegmentId.annotate({
        title: "Segment",
        description: "Export only this segment's contacts (from segments.list). Combines with filter and ids.",
      }),
    ),
  }),
  output: ExportResult,
  errors: [SegmentNotFound],
  http: { method: "POST", path: "/teams/:teamId/contacts/export" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const importContacts = defineTeamOperation({
  name: "contacts.import",
  description:
    "Import contacts from CSV. A row whose email belongs to a contact updates that contact; other rows create contacts. A Company column affiliates each contact (creating the company if needed), with Title as the title. Bad rows are reported and skipped; the rest are imported. Import never subscribes an existing contact again who unsubscribed, bounced or marked mail as spam.",
  input: importInput,
  output: ImportResult,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/contacts/import" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "records:write"],
})

export const exportCompanies = defineTeamOperation({
  name: "companies.export",
  description: "Export companies as CSV: all of them, those matching a filter, or a given list.",
  input: exportInput,
  output: ExportResult,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/companies/export" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const importCompanies = defineTeamOperation({
  name: "companies.import",
  description:
    "Import companies from CSV. A row whose domain belongs to a company, or failing that whose name matches one exactly, updates it; other rows create companies. Bad rows are reported and skipped.",
  input: importInput,
  output: ImportResult,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/companies/import" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "records:write"],
})
