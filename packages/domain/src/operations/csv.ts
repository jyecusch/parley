import { Schema } from "effect"
import { FieldProblem } from "../errors/input.ts"
import { Filter } from "../filter.ts"
import { TeamId } from "../ids.ts"
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
})
export type ImportResult = typeof ImportResult.Type

const exportInput = Schema.Struct({
  ...InTeam,
  filter: Schema.optional(Filter),
  ids: Schema.optional(
    Schema.Array(Schema.String)
      .check(Schema.isMaxLength(10_000))
      .annotate({ title: "Records", description: "Export only these ids, such as a selection." }),
  ),
})

const importInput = Schema.Struct({
  ...InTeam,
  csv: Schema.String.check(Schema.isMaxLength(5_000_000)).annotate({
    title: "CSV",
    description: "The file's text, with a header row. Up to 5,000 rows.",
  }),
  mapping: Schema.optional(
    Schema.Record(Schema.String, Schema.String).annotate({
      title: "Column mapping",
      description:
        'Which field each column (by header) fills, like {"Work email":"email","Plan":"custom:<field id>"}. Columns left out are skipped. Without a mapping, Parley guesses from the headers.',
    }),
  ),
})

export const exportContacts = defineTeamOperation({
  name: "contacts.export",
  description:
    "Export contacts as CSV: all of them, those matching a filter, or a given list. Custom fields are included as columns.",
  input: exportInput,
  output: ExportResult,
  errors: [],
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
  hints: { readOnly: false, destructive: false, idempotent: false },
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
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "records:write"],
})
