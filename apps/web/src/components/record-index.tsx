import type { Matching, Selection } from "@parley/domain"
import { useVirtualizer } from "@tanstack/react-virtual"
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { Skeleton, TextButton } from "./ui/index.ts"

/*
 * What the contacts and companies index views share (D136, D137): rows drawn only while on screen,
 * and a selection that is either picked rows or every record matching the view.
 */

/** A list row's height: `Td` is h-10. */
const ROW_HEIGHT = 40

/**
 * Draws only the rows near the screen, inside a scrolling table (D136). `count` is every row the
 * list has, loaded or not, so the table is its full height from the start; `onRange` hears which
 * rows are on screen, to load them. Render `rows` between the two spacers.
 */
export const useVirtualRows = (props: {
  readonly count: number
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly onRange: (first: number, last: number) => void
  /** Rows taller than a list row's 40px, such as companies' with their domain. */
  readonly rowHeight?: number
  /** What the rows are, such as the search, filter and sort: a change starts back at the top. */
  readonly resetKey?: string
}) => {
  const rowHeight = props.rowHeight ?? ROW_HEIGHT
  const virtualizer = useVirtualizer({
    count: props.count,
    getScrollElement: () => props.scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 15,
  })
  const rows = virtualizer.getVirtualItems()
  const firstIndex = rows[0]?.index ?? 0
  const lastIndex = rows.at(-1)?.index ?? 0
  const { onRange, resetKey, scrollRef } = props
  // Before paint, so the new rows never show at the old position. The virtualizer is told too: it
  // puts back its own position whenever the table's scrolling box is drawn afresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the rows change
  useLayoutEffect(() => {
    if (resetKey === undefined) return
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    virtualizer.scrollToOffset(0)
  }, [resetKey])
  useEffect(() => onRange(firstIndex, lastIndex), [firstIndex, lastIndex, onRange])
  return {
    rows,
    before: rows[0]?.start ?? 0,
    after: Math.max(0, virtualizer.getTotalSize() - (rows.at(-1)?.end ?? 0)),
    /** Brings a row into view, for the keyboard cursor. */
    scrollTo: (index: number) => virtualizer.scrollToIndex(index, { align: "auto" }),
  }
}

/** The empty space standing in for rows above or below the screen. */
export function SpacerRow(props: { readonly height: number }) {
  if (props.height <= 0) return null
  return (
    <tr>
      <td colSpan={99} style={{ height: props.height, padding: 0, border: 0 }} />
    </tr>
  )
}

/** A row whose record is still loading: the height of a real one, so nothing below it moves. */
export function PlaceholderRow(props: { readonly height?: number }) {
  return (
    <tr aria-hidden style={{ height: props.height ?? ROW_HEIGHT }}>
      <td colSpan={99} className="px-4">
        <Skeleton className="w-40 max-w-full" />
      </td>
    </tr>
  )
}

/** Picked rows by id, or every record matching the index view (D137). */
export type Picked = { readonly kind: "ids"; readonly ids: ReadonlySet<string> } | { readonly kind: "matching" }

const NONE: Picked = { kind: "ids", ids: new Set() }

/** The most ids one call takes; bigger picks go in several calls. */
export const IDS_PER_CALL = 1000

export const chunksOf = <T,>(items: ReadonlyArray<T>, size = IDS_PER_CALL): Array<ReadonlyArray<T>> => {
  const chunks: Array<ReadonlyArray<T>> = []
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size))
  return chunks
}

/**
 * An index view's selection. Changing the search or filter (`matching`) clears it, so "all
 * matching" never means records the person can't see.
 */
export const useSelection = (props: {
  readonly loadedIds: ReadonlyArray<string>
  readonly total: number | null
  readonly matching: Matching
}) => {
  const [picked, setPicked] = useState<Picked>(NONE)
  const matchingKey = JSON.stringify(props.matching)
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear when the search or filter changes
  useEffect(() => setPicked(NONE), [matchingKey])

  const count = picked.kind === "matching" ? (props.total ?? props.loadedIds.length) : picked.ids.size
  const isPicked = useCallback((id: string) => picked.kind === "matching" || picked.ids.has(id), [picked])
  const allLoaded = props.loadedIds.length > 0 && props.loadedIds.every(isPicked)
  const someLoaded = !allLoaded && props.loadedIds.some(isPicked)

  return useMemo(
    () => ({
      picked,
      count,
      isPicked,
      allLoaded,
      someLoaded,
      /** "Select all N matching" is offered when every loaded row is picked but not every match is. */
      canPickAllMatching: picked.kind === "ids" && allLoaded && props.total !== null && props.total > picked.ids.size,
      toggle: (id: string) =>
        setPicked((current) => {
          // Unpicking one row of "all matching" leaves the other loaded rows picked.
          const ids = new Set(current.kind === "matching" ? props.loadedIds : current.ids)
          if (ids.has(id)) ids.delete(id)
          else ids.add(id)
          return { kind: "ids", ids }
        }),
      toggleAllLoaded: () => setPicked(allLoaded ? NONE : { kind: "ids", ids: new Set(props.loadedIds) }),
      pickAllMatching: () => setPicked({ kind: "matching" }),
      clear: () => setPicked(NONE),
      /** The picked ids, when rows were picked one by one; undefined for "all matching". */
      ids: picked.kind === "ids" ? [...picked.ids] : undefined,
      /** The selection as the server takes it, in calls of up to 1,000 ids. */
      selections: (): Array<Selection> =>
        picked.kind === "matching"
          ? [{ matching: props.matching }]
          : chunksOf([...picked.ids]).map((ids) => ({ ids: [...ids] })),
    }),
    [picked, count, isPicked, allLoaded, someLoaded, props.total, props.loadedIds, props.matching],
  )
}

export type SelectionState = ReturnType<typeof useSelection>

/** The selection bar's count, with "Select all N matching" when there are more (D137). */
export function SelectionCount(props: {
  readonly selection: SelectionState
  readonly total: number | null
  readonly plural: string
}) {
  const { selection } = props
  return (
    <span className="mr-1.5 text-muted tabular-nums">
      <b className="font-medium text-fg">{selection.count.toLocaleString()}</b>{" "}
      {selection.picked.kind === "matching" ? `${props.plural} selected, all matching` : "selected"}
      {selection.canPickAllMatching && props.total !== null ? (
        <>
          {" · "}
          <TextButton className="text-sm" onClick={selection.pickAllMatching}>
            Select all {props.total.toLocaleString()} matching
          </TextButton>
        </>
      ) : null}
    </span>
  )
}
