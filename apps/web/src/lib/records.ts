import type { Filter, Sort, TeamId } from "@parley/domain"
import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  type QueryKey,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useState } from "react"

/**
 * Contacts and companies in the browser (D136): pages from the server, never the whole team. Every
 * query about a record type sits under `[plural, teamId]`, so one invalidation refreshes them all,
 * and edits patch every cached copy at once (D53), rolling back on error.
 */

/** A page from contacts.list or companies.list. */
export interface RecordPage<R> {
  readonly items: ReadonlyArray<R>
  readonly nextCursor: string | null
  readonly total: number | null
}

/** What an index view asks the server for: its search box, filter and sort. */
export interface ListParams {
  readonly search: string
  readonly filter: Filter
  readonly sort: Sort | null
}

/** How the browser reaches one record type's operations. */
export interface RecordApi<R extends { readonly id: string }> {
  readonly plural: "contacts" | "companies"
  /** Which records `list` covers, when not the whole team, such as one segment's contacts. */
  readonly scope?: string
  readonly list: (
    teamId: TeamId,
    input: {
      readonly search?: string
      readonly filter?: Filter
      readonly sort?: Sort
      readonly cursor?: string
      readonly limit: number
    },
  ) => Promise<RecordPage<R>>
  readonly get: (teamId: TeamId, id: string) => Promise<R>
}

export const PAGE_SIZE = 100

export const recordsKey = (plural: RecordApi<never>["plural"], teamId: TeamId): QueryKey => [plural, teamId]
const listKey = (plural: RecordApi<never>["plural"], teamId: TeamId, params: unknown): QueryKey => [
  plural,
  teamId,
  "list",
  params,
]
const oneKey = (plural: RecordApi<never>["plural"], teamId: TeamId, id: string): QueryKey => [plural, teamId, "one", id]

const listInput = (params: ListParams) => ({
  ...(params.search.trim() ? { search: params.search.trim() } : {}),
  ...(params.filter.conditions.length > 0 ? { filter: params.filter } : {}),
  ...(params.sort ? { sort: params.sort } : {}),
})

/** A value that settles `delay` ms after it stops changing, for search boxes. */
export const useDebounced = <T>(value: T, delay = 250): T => {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}

/**
 * An index view's records, 100 at a time (D136). `items` is what's loaded so far; `total` is how
 * many match, from the first page.
 */
export const useRecordList = <R extends { readonly id: string }>(
  api: RecordApi<R>,
  teamId: TeamId,
  params: ListParams,
  options: { readonly enabled?: boolean; readonly pageSize?: number } = {},
) => {
  const input = listInput(params)
  const pageSize = options.pageSize ?? PAGE_SIZE
  const query = useInfiniteQuery({
    queryKey: listKey(api.plural, teamId, { ...input, pageSize, scope: api.scope ?? "team" }),
    queryFn: ({ pageParam }) =>
      api.list(teamId, { ...input, limit: pageSize, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  })
  const pages = query.data?.pages ?? []
  return {
    items: pages.flatMap((page) => page.items) as ReadonlyArray<R>,
    total: pages[0]?.total ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    /** Showing the previous search's rows while the new search loads. */
    isStale: query.isPlaceholderData,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
    },
    refetch: () => query.refetch(),
  }
}

type Cached =
  | InfiniteData<RecordPage<{ readonly id: string }>>
  | RecordPage<{ readonly id: string }>
  | { readonly id: string }

/** Every cached copy of a record type: index view pages, search results and single records. */
const cachedQueries = (queryClient: QueryClient, plural: RecordApi<never>["plural"], teamId: TeamId) =>
  queryClient.getQueriesData<Cached>({ queryKey: recordsKey(plural, teamId) })

const isPaged = (data: Cached): data is InfiniteData<RecordPage<{ readonly id: string }>> => "pages" in data
const isPage = (data: Cached): data is RecordPage<{ readonly id: string }> => "items" in data

/** The pages a cached query holds: an index view's, a search's one, or none for a single record. */
const pagesOf = (data: Cached): ReadonlyArray<RecordPage<{ readonly id: string }>> =>
  isPaged(data) ? data.pages : isPage(data) ? [data] : []

/** A record from any cached list page, so a panel can open before contacts.get answers. */
export const findCached = <R extends { readonly id: string }>(
  queryClient: QueryClient,
  plural: RecordApi<R>["plural"],
  teamId: TeamId,
  id: string,
): R | undefined => {
  for (const [, data] of cachedQueries(queryClient, plural, teamId)) {
    if (!data) continue
    if (!isPage(data) && !isPaged(data)) {
      if (data.id === id) return data as R
      continue
    }
    for (const page of pagesOf(data)) {
      const found = page.items.find((item) => item.id === id)
      if (found) return found as R
    }
  }
  return undefined
}

/** One record, by id (D136): from contacts.get or companies.get, starting from a cached copy. */
export const useRecord = <R extends { readonly id: string }>(
  api: RecordApi<R>,
  teamId: TeamId,
  id: string | undefined,
) => {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: oneKey(api.plural, teamId, id ?? ""),
    queryFn: () => api.get(teamId, id ?? ""),
    enabled: id !== undefined,
    // A cached copy shows at once and counts as stale, so the record is fetched anyway.
    initialData: () => (id ? findCached<R>(queryClient, api.plural, teamId, id) : undefined),
    initialDataUpdatedAt: 0,
  })
}

/**
 * Records matching what someone types, for pickers and search (D136): the first `limit` matches
 * from the server, or the most recently updated when nothing is typed.
 */
export const useRecordSearch = <R extends { readonly id: string }>(
  api: RecordApi<R>,
  teamId: TeamId,
  text: string,
  options: { readonly limit?: number; readonly enabled?: boolean } = {},
) => {
  const search = useDebounced(text.trim(), 200)
  const limit = options.limit ?? 20
  const query = useQuery({
    queryKey: [api.plural, teamId, "search", search, limit],
    queryFn: () => api.list(teamId, { ...(search ? { search } : {}), limit }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  })
  return {
    items: (query.data?.items ?? []) as ReadonlyArray<R>,
    isLoading: query.isLoading,
    /** Still searching for what was just typed. */
    isSearching: query.isFetching || search !== text.trim(),
  }
}

/** Records by id, such as the companies a filter names, each from its own cache entry. */
export const useRecordsById = <R extends { readonly id: string }>(
  api: RecordApi<R>,
  teamId: TeamId,
  ids: ReadonlyArray<string>,
): ReadonlyMap<string, R> => {
  const queryClient = useQueryClient()
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: oneKey(api.plural, teamId, id),
      queryFn: () => api.get(teamId, id),
      placeholderData: () => findCached<R>(queryClient, api.plural, teamId, id),
      staleTime: 60_000,
    })),
  })
  const found = new Map<string, R>()
  for (const result of results) if (result.data) found.set(result.data.id, result.data)
  return found
}

/**
 * Changes cached records in place: `change` gets each cached copy whose id is in `ids` and
 * returns the new one, or undefined to take it out of lists. Returns an undo for a failed save.
 */
export const patchCached = <R extends { readonly id: string }>(
  queryClient: QueryClient,
  plural: RecordApi<R>["plural"],
  teamId: TeamId,
  ids: ReadonlySet<string>,
  change: (record: R) => R | undefined,
): (() => void) => {
  const before = cachedQueries(queryClient, plural, teamId)
  /** A page with the change applied, its total less the records taken out. */
  const patchPage = (page: RecordPage<{ readonly id: string }>) => {
    if (!page.items.some((item) => ids.has(item.id))) return page
    let removed = 0
    const items = page.items.flatMap((item) => {
      if (!ids.has(item.id)) return [item]
      const next = change(item as R)
      if (next === undefined) removed++
      return next === undefined ? [] : [next]
    })
    return { ...page, items, total: page.total === null ? null : page.total - removed }
  }
  for (const [key, data] of before) {
    if (!data) continue
    if (isPaged(data)) {
      // Only the first page carries the total, so it takes every page's removals.
      const patched = data.pages.map(patchPage)
      const removed = data.pages.reduce((sum, page, index) => {
        const after = patched[index]
        return sum + page.items.length - (after?.items.length ?? page.items.length)
      }, 0)
      const [first, ...rest] = patched
      const total = data.pages[0]?.total ?? null
      queryClient.setQueryData(key, {
        ...data,
        pages: first ? [{ ...first, total: total === null ? null : total - removed }, ...rest] : patched,
      })
    } else if (isPage(data)) {
      queryClient.setQueryData(key, patchPage(data))
    } else if (ids.has(data.id)) {
      const next = change(data as R)
      if (next) queryClient.setQueryData(key, next)
    }
  }
  return () => {
    for (const [key, data] of before) queryClient.setQueryData(key, data)
  }
}

/** Puts the server's copy of a record into every cached copy. */
export const writeCached = <R extends { readonly id: string }>(
  queryClient: QueryClient,
  plural: RecordApi<R>["plural"],
  teamId: TeamId,
  record: R,
) => {
  patchCached<R>(queryClient, plural, teamId, new Set([record.id]), () => record)
}

/** Refetches every list and record of a type, after a change the browser can't patch itself. */
export const refreshRecords = (queryClient: QueryClient, plural: RecordApi<never>["plural"], teamId: TeamId) =>
  queryClient.invalidateQueries({ queryKey: recordsKey(plural, teamId) })
