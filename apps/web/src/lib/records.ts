import type { Filter, Sort, TeamId } from "@parley/domain"
import {
  keepPreviousData,
  type QueryClient,
  type QueryKey,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback, useEffect, useState } from "react"

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
      readonly offset?: number
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
 * An index view's records (D136), fetched by position in blocks of 100, the way the rows on
 * screen need them. `count` is how many match, so a list can be its full height from the start
 * and its scrollbar never resizes; `at` gives the record at a position, or undefined while its
 * block loads. `ensure` asks for the blocks around the rows on screen.
 */
export const useRecordList = <R extends { readonly id: string }>(
  api: RecordApi<R>,
  teamId: TeamId,
  params: ListParams,
  options: { readonly enabled?: boolean; readonly pageSize?: number } = {},
) => {
  const queryClient = useQueryClient()
  const input = listInput(params)
  const blockSize = options.pageSize ?? PAGE_SIZE
  const enabled = options.enabled ?? true
  const key = listKey(api.plural, teamId, { ...input, blockSize, scope: api.scope ?? "team" })
  const keyText = JSON.stringify(key)
  /** The first and last blocks the rows on screen fall in. */
  const [span, setSpan] = useState<readonly [number, number]>([0, 0])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search starts at the top
  useEffect(() => setSpan([0, 0]), [keyText])

  const blockQuery = (block: number) => ({
    queryKey: [...key, block],
    queryFn: () => api.list(teamId, { ...input, limit: blockSize, offset: block * blockSize }),
    enabled,
  })
  // The first block is always wanted: it carries the total. It's its own query so the previous
  // search's rows stay up, dimmed, while a new search loads (useQueries can't keep them).
  const first = useQuery({ ...blockQuery(0), placeholderData: keepPreviousData })
  /** The blocks the rows on screen fall in, and one either side. */
  const others: Array<number> = []
  for (let block = Math.max(1, span[0] - 1); block <= span[1] + 1; block++) others.push(block)
  const results = useQueries({ queries: others.map(blockQuery) })
  const total = first.data?.total ?? null
  const blocks = new Map<number, RecordPage<R>>()
  if (first.data) blocks.set(0, first.data as RecordPage<R>)
  others.forEach((block, index) => {
    const data = results[index]?.data
    if (data) blocks.set(block, data as RecordPage<R>)
  })
  /** A block on screen, or one fetched earlier and still cached. */
  const blockAt = (block: number) => blocks.get(block) ?? queryClient.getQueryData<RecordPage<R>>([...key, block])
  const loaded = [...blocks.entries()].sort(([a], [b]) => a - b)
  const items = loaded.flatMap(([, page]) => page.items)
  const count = total ?? items.length

  const ensure = useCallback(
    (from: number, to: number) => {
      const next = [Math.floor(Math.max(0, from) / blockSize), Math.floor(Math.max(0, to) / blockSize)] as const
      setSpan((current) => (current[0] === next[0] && current[1] === next[1] ? current : next))
    },
    [blockSize],
  )

  return {
    count,
    total,
    /** Every record in the blocks loaded around the screen, in order. */
    items: items as ReadonlyArray<R>,
    at: (index: number): R | undefined => blockAt(Math.floor(index / blockSize))?.items[index % blockSize],
    /** A loaded record's position in the list, or -1. */
    indexOf: (id: string): number => {
      for (const [block, page] of loaded) {
        const index = page.items.findIndex((item) => item.id === id)
        if (index >= 0) return block * blockSize + index
      }
      return -1
    },
    ensure,
    isLoading: first.isLoading,
    isError: first.isError,
    error: first.error,
    /** Showing the previous search's rows while the new search loads. */
    isStale: first.isPlaceholderData,
    refetch: () => queryClient.refetchQueries({ queryKey: key }),
  }
}

type Cached = RecordPage<{ readonly id: string }> | { readonly id: string }

/** Every cached copy of a record type: index view pages, search results and single records. */
const cachedQueries = (queryClient: QueryClient, plural: RecordApi<never>["plural"], teamId: TeamId) =>
  queryClient.getQueriesData<Cached>({ queryKey: recordsKey(plural, teamId) })

const isPage = (data: Cached): data is RecordPage<{ readonly id: string }> => "items" in data

/** A record from any cached list page, so a panel can open before contacts.get answers. */
export const findCached = <R extends { readonly id: string }>(
  queryClient: QueryClient,
  plural: RecordApi<R>["plural"],
  teamId: TeamId,
  id: string,
): R | undefined => {
  for (const [, data] of cachedQueries(queryClient, plural, teamId)) {
    if (!data) continue
    if (!isPage(data)) {
      if (data.id === id) return data as R
      continue
    }
    const found = data.items.find((item) => item.id === id)
    if (found) return found as R
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
  /** A page with the change applied, and how many records it took out. */
  const patchPage = (page: RecordPage<{ readonly id: string }>) => {
    if (!page.items.some((item) => ids.has(item.id))) return { page, removed: 0 }
    let removed = 0
    const items = page.items.flatMap((item) => {
      if (!ids.has(item.id)) return [item]
      const next = change(item as R)
      if (next === undefined) removed++
      return next === undefined ? [] : [next]
    })
    return { page: { ...page, items }, removed }
  }
  // An index view's blocks share one total, so every block of a list takes all its removals.
  const listOf = (key: QueryKey) => (key[2] === "list" ? JSON.stringify(key.slice(0, 4)) : undefined)
  const patched = new Map<QueryKey, Cached>()
  const removedFrom = new Map<string, number>()
  for (const [key, data] of before) {
    if (!data) continue
    if (isPage(data)) {
      const { page, removed } = patchPage(data)
      patched.set(key, page)
      const list = listOf(key) ?? JSON.stringify(key)
      removedFrom.set(list, (removedFrom.get(list) ?? 0) + removed)
    } else if (ids.has(data.id)) {
      const next = change(data as R)
      if (next) patched.set(key, next)
    }
  }
  for (const [key, data] of patched) {
    if (!isPage(data)) {
      queryClient.setQueryData(key, data)
      continue
    }
    const removed = removedFrom.get(listOf(key) ?? JSON.stringify(key)) ?? 0
    queryClient.setQueryData(key, {
      ...data,
      total: data.total === null ? null : Math.max(0, data.total - removed),
    })
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
