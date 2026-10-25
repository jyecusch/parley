import { isUuid } from "@parley/domain"

/*
 * Page cursors: opaque to callers, so they can change. Keyset cursors point after a row by its
 * time and id; with a custom sort, pages are by position instead ("o:<offset>"). Anything that
 * isn't a cursor we made reads as the first page, never as a bad value reaching the query.
 */

/** Deep offsets get slower; past this many records a filter is the better tool. */
export const MAX_OFFSET = 1_000_000

/** A cursor pointing after the row with this time and id. */
export const encodeCursor = (at: Date, id: string) => btoa(`${at.toISOString()}|${id}`)

/** The time and id a cursor points after, or undefined when it isn't one of ours. */
export const decodeCursor = (cursor: string): { readonly at: Date; readonly id: string } | undefined => {
  try {
    const [iso, id] = atob(cursor).split("|")
    const at = new Date(iso ?? "")
    return id && isUuid(id) && !Number.isNaN(at.getTime()) ? { at, id } : undefined
  } catch {
    return undefined
  }
}

export const encodeOffset = (offset: number) => btoa(`o:${offset}`)

export const decodeOffset = (cursor: string | undefined): number => {
  if (!cursor) return 0
  try {
    const text = atob(cursor)
    const offset = text.startsWith("o:") ? Number(text.slice(2)) : 0
    return Number.isInteger(offset) && offset > 0 ? Math.min(offset, MAX_OFFSET) : 0
  } catch {
    return 0
  }
}
