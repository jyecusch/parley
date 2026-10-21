import { Schema } from "effect"
import { ImportNotFound } from "../errors/imports.ts"
import { ImportId, TeamId } from "../ids.ts"
import { Import } from "../imports.ts"
import { defineTeamOperation } from "../operation.ts"
import { RecordType } from "../record-type.ts"
import { ImportOptions } from "./csv.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneImport = { ...InTeam, importId: ImportId.annotate({ description: "The import, from imports.list." }) }

/** The most rows one import takes (D135). */
export const IMPORT_MAX_ROWS = 100_000

export const startImport = defineTeamOperation({
  name: "imports.start",
  description:
    "Start importing contacts or companies from a CSV file of up to 100,000 rows. Parley imports it in the background (D135); follow it with imports.get. Rows are matched and imported as contacts.import and companies.import do. Rows already imported stay if the import is cancelled.",
  input: Schema.Struct({
    ...InTeam,
    recordType: RecordType.annotate({ title: "Import into", description: "contact or company." }),
    csv: Schema.String.check(Schema.isMaxLength(30_000_000)).annotate({
      title: "CSV",
      description: "The file's text, with a header row. Up to 100,000 rows.",
    }),
    fileName: Schema.optional(
      Schema.String.check(Schema.isMaxLength(255)).annotate({
        title: "File name",
        description: "Shown in the import history.",
      }),
    ),
    ...ImportOptions,
  }),
  output: Import,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/imports" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "records:write"],
})

export const getImport = defineTeamOperation({
  name: "imports.get",
  description:
    "One import: where it is, how many rows it has done, and the rows that failed or were imported with warnings.",
  input: Schema.Struct(OneImport),
  output: Import,
  errors: [ImportNotFound],
  http: { method: "GET", path: "/teams/:teamId/imports/:importId" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const listImports = defineTeamOperation({
  name: "imports.list",
  description: "The team's imports, newest first, without their failed and warning rows (see imports.get).",
  input: Schema.Struct({ ...InTeam, recordType: Schema.optional(RecordType) }),
  output: Schema.Array(Import),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/imports" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const cancelImport = defineTeamOperation({
  name: "imports.cancel",
  description:
    "Stop an import. Rows already imported stay; the rest aren't. An import that has finished is returned unchanged.",
  input: Schema.Struct(OneImport),
  output: Import,
  errors: [ImportNotFound],
  http: { method: "POST", path: "/teams/:teamId/imports/:importId/cancel" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "records:write"],
})
