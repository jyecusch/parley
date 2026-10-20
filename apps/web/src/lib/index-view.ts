import type { FieldValue, Filter, RecordType, SavedView, SavedViewId, Sort, TeamId } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { call } from "./client.ts"
import { readColumns, writeColumns } from "./custom-fields.ts"

export const EMPTY_FILTER: Filter = { match: "all", conditions: [] }

/** What an index view shows: its filter, sort and extra columns. A saved view stores exactly this. */
export interface ViewState {
  readonly filter: Filter
  readonly sort: Sort | null
  readonly columns: ReadonlyArray<string>
}

/** The built-in view of the contacts the signed-in person owns (D123): `?view=mine` on Contacts. */
export const MY_CONTACTS_VIEW = "mine"

/** The filter of "My contacts": contact owner is this person. */
export const myContactsFilter = (userId: string): Filter => ({
  match: "all",
  conditions: [{ field: "owner", operator: "is-any-of", value: [userId] }],
})

export const useSavedViews = (teamId: TeamId) =>
  useQuery({ queryKey: ["saved-views", teamId], queryFn: () => call("savedViews.list", { teamId }) })

/**
 * The state of an index view: from its saved view when one is open, else the defaults, plus any
 * unsaved changes. Changes show "Save view" or "Save" and "Reset" in the header (D65).
 */
export const useIndexView = (
  teamId: TeamId,
  recordType: RecordType,
  viewId: string | undefined,
  /** The signed-in person, for built-in views about them ("My contacts"). */
  userId?: string,
) => {
  const queryClient = useQueryClient()
  const views = useSavedViews(teamId)
  const view = viewId ? views.data?.find((candidate) => candidate.id === viewId) : undefined
  /** A built-in view: not saved, so it has a name and a filter but nothing to update or delete. */
  const builtInName = recordType === "contact" && viewId === MY_CONTACTS_VIEW && userId ? "My contacts" : undefined
  const base: ViewState = useMemo(
    () =>
      view
        ? { filter: view.filter, sort: view.sort, columns: view.columns }
        : {
            filter: builtInName && userId ? myContactsFilter(userId) : EMPTY_FILTER,
            sort: null,
            columns: readColumns(teamId, recordType),
          },
    [view, teamId, recordType, builtInName, userId],
  )
  const [draft, setDraft] = useState<ViewState>(base)
  // Opening another view, or the view changing underneath, starts from what's saved.
  const baseKey = view ? `${view.id}:${view.updatedAt}` : `${builtInName ?? "none"}:${recordType}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the saved state itself changes
  useEffect(() => setDraft(base), [baseKey])

  const dirty =
    JSON.stringify(draft.filter) !== JSON.stringify(base.filter) ||
    JSON.stringify(draft.sort) !== JSON.stringify(base.sort)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["saved-views", teamId] })

  return {
    views: (views.data ?? []).filter((candidate) => candidate.recordType === recordType),
    view,
    /** The open view's name: a saved view's, or a built-in one's. */
    viewName: view?.name ?? builtInName,
    state: draft,
    dirty,
    setFilter: (filter: Filter) => setDraft((current) => ({ ...current, filter })),
    setSort: (sort: Sort | null) => setDraft((current) => ({ ...current, sort })),
    /** Columns save at once: to the open view, or to this browser without one. */
    setColumns: async (columns: ReadonlyArray<string>) => {
      setDraft((current) => ({ ...current, columns }))
      if (view) {
        await call("savedViews.update", { teamId, viewId: view.id as SavedViewId, columns })
        await refresh()
      } else writeColumns(teamId, recordType, columns)
    },
    reset: () => setDraft(base),
    save: async () => {
      if (!view) return undefined
      const saved = await call("savedViews.update", {
        teamId,
        viewId: view.id as SavedViewId,
        filter: draft.filter,
        sort: draft.sort,
        columns: draft.columns,
      })
      await refresh()
      return saved
    },
    saveAs: async (name: string, shared: boolean): Promise<SavedView> => {
      const saved = await call("savedViews.create", {
        teamId,
        recordType,
        name,
        shared,
        filter: draft.filter,
        sort: draft.sort,
        columns: draft.columns,
      })
      await refresh()
      return saved
    },
    remove: async () => {
      if (!view) return
      await call("savedViews.delete", { teamId, viewId: view.id as SavedViewId })
      await refresh()
    },
  }
}

/** Compares two records by a sort field, the way the server orders them: empty values last. */
export const compareBy =
  <R>(read: (record: R) => (field: string) => FieldValue, sort: Sort) =>
  (a: R, b: R): number => {
    const left = read(a)(sort.field)
    const right = read(b)(sort.field)
    const empty = (value: FieldValue) => value === null || value === "" || (Array.isArray(value) && value.length === 0)
    if (empty(left) && empty(right)) return 0
    if (empty(left)) return 1
    if (empty(right)) return -1
    const order =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(Array.isArray(left) ? left[0] : left).localeCompare(
            String(Array.isArray(right) ? right[0] : right),
            undefined,
            {
              sensitivity: "base",
            },
          )
    return sort.direction === "asc" ? order : -order
  }

/** Downloads text as a file, such as an export. */
export const download = (name: string, text: string, type = "text/csv") => {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
