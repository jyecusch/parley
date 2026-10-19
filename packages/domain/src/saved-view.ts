import { Schema } from "effect"
import { Filter, Sort } from "./filter.ts"
import { SavedViewId, UserId } from "./ids.ts"
import { RecordType } from "./record-type.ts"

const Timestamp = Schema.String.annotate({ description: "ISO 8601 timestamp" })

/** A named filter, sort and set of columns for an index view (D59, D60). */
export const SavedView = Schema.Struct({
  id: SavedViewId,
  recordType: RecordType,
  name: Schema.String,
  /** Shared with the team, or personal to its owner (D60). */
  shared: Schema.Boolean,
  ownerUserId: Schema.NullOr(UserId),
  ownerName: Schema.String,
  filter: Filter,
  sort: Schema.NullOr(Sort),
  /** Extra columns, as filter fields ("custom:<id>"), in order. */
  columns: Schema.Array(Schema.String),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type SavedView = typeof SavedView.Type

export const SavedViewName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(60))
