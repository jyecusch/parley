/*
 * Classes shared by the record lists (contacts and companies), for the columns and cells their
 * tables have in common.
 */

/** Columns that a narrow list drops before anything scrolls sideways. */
export const wideColumnClass = "@max-3xl/content:hidden"

/** The selection checkbox's column. */
export const checkCellClass = "w-11 pr-0 pl-4"

/** A date column, such as Created or Updated. */
export const dateColumnClass = "w-26"

/** A custom field's column. */
export const customColumnClass = "w-42"

/** A date cell's text. */
export const dateCellClass = "text-subtle tabular-nums"

/** The button that opens a record from its row: its mark, then its name, underlined on hover. */
export const nameButtonClass =
  "group/name flex max-w-full min-w-0 cursor-pointer items-center gap-2.5 text-left font-medium focus-visible:-outline-offset-2"

/** The name inside `nameButtonClass`. */
export const nameTextClass = "truncate decoration-line-strong underline-offset-3 group-hover/name:underline"
