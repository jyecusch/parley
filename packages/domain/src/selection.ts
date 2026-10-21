import { Schema } from "effect"
import { Filter } from "./filter.ts"

/** An index view's search and filter: what "all matching" means (D137). */
export const Matching = Schema.Struct({
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(200)).annotate({ title: "Search" })),
  filter: Schema.optional(Filter),
}).annotate({
  title: "Matching",
  description: "Every record matching this search and filter, as the list operation would return them.",
})
export type Matching = typeof Matching.Type

/**
 * The records an action applies to (D137): the ids picked, up to 1,000, or every record matching
 * a search and filter.
 */
export const Selection = Schema.Union([
  Schema.Struct({
    ids: Schema.Array(Schema.String)
      .check(Schema.isMinLength(1), Schema.isMaxLength(1000))
      .annotate({ title: "Records", description: "Record ids, up to 1,000." }),
  }),
  Schema.Struct({ matching: Matching }),
]).annotate({
  title: "Selection",
  description: 'Either {"ids":[...]} or {"matching":{"search":"...","filter":{...}}} for every matching record.',
})
export type Selection = typeof Selection.Type

/** What an action on a selection did. */
export const SelectionResult = Schema.Struct({ count: Schema.Number })
export type SelectionResult = typeof SelectionResult.Type

/** What deleting a selection did; `deletedAt` restores exactly those records (D137). */
export const DeletedSelection = Schema.Struct({
  count: Schema.Number,
  deletedAt: Schema.String.annotate({ description: "ISO 8601 timestamp shared by every record deleted" }),
})
export type DeletedSelection = typeof DeletedSelection.Type
