import { UserText } from "@parley/errors"
import { Schema } from "effect"
import { FieldProblem } from "./errors/input.ts"
import { ImportId } from "./ids.ts"
import { RecordType } from "./record-type.ts"

const Timestamp = Schema.String.annotate({ description: "ISO 8601 timestamp" })

/** Where an import is (D135). Logos are fetched after the rows, while "fetching-logos". */
export const ImportStatus = Schema.Literals(["queued", "running", "fetching-logos", "finished", "canceled", "failed"])
export type ImportStatus = typeof ImportStatus.Type

/** A row with problems, by its line in the file (the header is line 1). */
export const ImportProblemRow = Schema.Struct({ line: Schema.Number, problems: Schema.Array(FieldProblem) })

/**
 * One import of contacts or companies, run in the background (D135). `failed` and `warnings` are
 * filled only by imports.get, and keep at most the first 1,000 rows of each.
 */
export const Import = Schema.Struct({
  id: ImportId,
  recordType: RecordType,
  status: ImportStatus,
  fileName: Schema.NullOr(Schema.String),
  totalRows: Schema.Number,
  /** Rows looked at so far, whatever happened to them. */
  processedRows: Schema.Number,
  created: Schema.Number,
  updated: Schema.Number,
  failedCount: Schema.Number,
  warningCount: Schema.Number,
  /** Logos to fetch from the file's logo column, and how many are done (companies only). */
  logos: Schema.NullOr(Schema.Struct({ total: Schema.Number, done: Schema.Number })),
  failed: Schema.Array(ImportProblemRow),
  warnings: Schema.Array(ImportProblemRow),
  startedByName: Schema.NullOr(Schema.String),
  /** Why it stopped, when its status is "failed". */
  error: Schema.NullOr(UserText.schema),
  createdAt: Timestamp,
  finishedAt: Schema.NullOr(Timestamp),
})
export type Import = typeof Import.Type
