import type { Import, ImportId, RecordType, TeamId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { absolute, ago } from "../lib/time.ts"
import { LineProblems } from "./index-view.tsx"
import { Dialog } from "./settings.tsx"
import { Badge, Button, cn, ErrorText, Hint, Skeleton } from "./ui/index.ts"

/** Imports that are still going (D135). */
const isActive = (entry: Import) =>
  entry.status === "queued" || entry.status === "running" || entry.status === "fetching-logos"

export const importsKey = (teamId: TeamId, recordType: RecordType) => ["imports", teamId, recordType] as const

/** A record type's imports, newest first: polled every 2 seconds while one is going. */
export const useImports = (teamId: TeamId, recordType: RecordType) =>
  useQuery({
    queryKey: importsKey(teamId, recordType),
    queryFn: () => call("imports.list", { teamId, recordType }),
    refetchInterval: (query) => (query.state.data?.some(isActive) ? 2000 : false),
  })

/**
 * Imports this browser has seen going, so their finished banner shows once they're done, even
 * after the tab was closed. Dismissing a banner forgets its import.
 */
const seenKey = (teamId: TeamId) => `parley.imports-seen.${teamId}`
const readSeen = (teamId: TeamId): ReadonlyArray<string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(seenKey(teamId)) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}
const writeSeen = (teamId: TeamId, ids: ReadonlyArray<string>) => {
  try {
    localStorage.setItem(seenKey(teamId), JSON.stringify(ids.slice(-50)))
  } catch {
    // Without storage, a finished banner shows only in the tab that saw the import going.
  }
}

const count = (value: number) => value.toLocaleString()

/** "4,980 created, 150 updated, 36 not imported, 12 with warnings". */
const outcome = (entry: Import) =>
  [
    `${count(entry.created)} created`,
    `${count(entry.updated)} updated`,
    entry.failedCount > 0 ? `${count(entry.failedCount)} not imported` : undefined,
    entry.warningCount > 0 ? `${count(entry.warningCount)} with warnings` : undefined,
  ]
    .filter(Boolean)
    .join(", ")

const fileOf = (entry: Import) => entry.fileName ?? "a CSV file"

function ProgressBar(props: { readonly done: number; readonly total: number; readonly label: string }) {
  const percent = props.total > 0 ? Math.min(100, (props.done / props.total) * 100) : 0
  return (
    <div
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={props.total}
      aria-valuenow={props.done}
      className="h-1.5 overflow-hidden rounded-full bg-fill"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

/**
 * The imports going on for a list, each with its progress and Cancel, and then what happened
 * (D135). `onRecordsChanged` refreshes the list: every 10 seconds while an import runs, and when
 * it finishes.
 */
export function ImportBanners(props: {
  readonly teamId: TeamId
  readonly recordType: RecordType
  readonly plural: string
  readonly canWrite: boolean
  readonly onRecordsChanged: () => void
}) {
  const imports = useImports(props.teamId, props.recordType)
  const list = imports.data ?? []
  const active = list.filter(isActive)
  const [seen, setSeen] = useState<ReadonlyArray<string>>(() => readSeen(props.teamId))
  const [results, setResults] = useState<ImportId>()
  const refresh = useRef(props.onRecordsChanged)
  refresh.current = props.onRecordsChanged
  const activeIds = active.map((entry) => entry.id).join(",")

  // Remembers imports going now; refreshes the list when one this tab watched has stopped.
  const watching = useRef(new Set<string>())
  useEffect(() => {
    const now = new Set(activeIds ? activeIds.split(",") : [])
    const stopped = [...watching.current].some((id) => !now.has(id))
    watching.current = now
    if (stopped) refresh.current()
    if (now.size === 0) return
    setSeen((current) => {
      const added = [...now].filter((id) => !current.includes(id))
      if (added.length === 0) return current
      const next = [...current, ...added]
      writeSeen(props.teamId, next)
      return next
    })
  }, [activeIds, props.teamId])

  // New rows show up in the list as the import goes.
  useEffect(() => {
    if (!activeIds) return
    const timer = window.setInterval(() => refresh.current(), 10_000)
    return () => window.clearInterval(timer)
  }, [activeIds])

  const dismiss = (id: ImportId) => {
    const next = seen.filter((entry) => entry !== id)
    setSeen(next)
    writeSeen(props.teamId, next)
  }
  const finished = list.filter((entry) => !isActive(entry) && seen.includes(entry.id))

  if (active.length === 0 && finished.length === 0) return null
  return (
    <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
      {active.map((entry) => (
        <ImportProgress key={entry.id} teamId={props.teamId} entry={entry} canWrite={props.canWrite} />
      ))}
      {finished.map((entry) => (
        <ImportFinished
          key={entry.id}
          entry={entry}
          onResults={() => setResults(entry.id)}
          onDismiss={() => dismiss(entry.id)}
        />
      ))}
      {results ? (
        <ImportResultsDialog
          teamId={props.teamId}
          importId={results}
          plural={props.plural}
          onClose={() => setResults(undefined)}
        />
      ) : null}
    </div>
  )
}

function ImportProgress(props: { readonly teamId: TeamId; readonly entry: Import; readonly canWrite: boolean }) {
  const { entry } = props
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const cancel = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await call("imports.cancel", { teamId: props.teamId, importId: entry.id })
      await queryClient.invalidateQueries({ queryKey: importsKey(props.teamId, entry.recordType) })
      setConfirming(false)
    } catch (failure) {
      setError(messageOf(failure))
    }
    setBusy(false)
  }
  const logos = entry.status === "fetching-logos" && entry.logos ? entry.logos : undefined
  const text =
    entry.status === "queued"
      ? `Waiting to import ${fileOf(entry)} · ${count(entry.totalRows)} rows`
      : logos
        ? `Fetching logos for ${fileOf(entry)} · ${count(logos.done)} of ${count(logos.total)}`
        : `Importing ${fileOf(entry)} · ${count(entry.processedRows)} of ${count(entry.totalRows)} rows`
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-fill px-3.5 py-2.5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 truncate font-medium tabular-nums" title={text}>
          {text}
        </span>
        {props.canWrite && !confirming ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Cancel import
          </Button>
        ) : null}
      </div>
      <ProgressBar
        label={logos ? "Logos fetched" : "Rows imported"}
        done={logos ? logos.done : entry.processedRows}
        total={logos ? logos.total : entry.totalRows}
      />
      {confirming ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex-1 text-sm">
            Cancel this import? The {count(entry.created + entry.updated)} rows already imported stay.
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Keep importing
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void cancel()}>
            {busy ? "Cancelling…" : "Cancel import"}
          </Button>
        </div>
      ) : (
        <Hint>You can leave this page; the import carries on.</Hint>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  )
}

function ImportFinished(props: {
  readonly entry: Import
  readonly onResults: () => void
  readonly onDismiss: () => void
}) {
  const { entry } = props
  const text =
    entry.status === "finished"
      ? `Imported ${fileOf(entry)}: ${outcome(entry)}.`
      : entry.status === "cancelled"
        ? `Cancelled the import of ${fileOf(entry)}: ${outcome(entry)}.`
        : `The import of ${fileOf(entry)} stopped before it finished: ${outcome(entry)}. ${entry.error ?? ""} Import the file again to finish; rows already imported are only updated.`
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3.5 py-2.5",
        entry.status === "failed" ? "bg-danger-soft" : entry.failedCount > 0 ? "bg-warn-soft" : "bg-ok-soft",
      )}
      role="status"
    >
      <span className="min-w-0 flex-1 tabular-nums">{text}</span>
      {entry.failedCount + entry.warningCount > 0 ? (
        <Button size="sm" variant="ghost" onClick={props.onResults}>
          See results
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={props.onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}

/** One import's outcome, with the rows not imported and those imported with warnings (D135). */
function ImportResults(props: { readonly teamId: TeamId; readonly importId: ImportId }) {
  const detail = useQuery({
    queryKey: ["import", props.teamId, props.importId],
    queryFn: () => call("imports.get", { teamId: props.teamId, importId: props.importId }),
    refetchInterval: (query) => (query.state.data && isActive(query.state.data) ? 2000 : false),
  })
  if (detail.isError) return <ErrorText>{messageOf(detail.error)}</ErrorText>
  const entry = detail.data
  if (!entry) return <Skeleton className="h-5 w-2/3" />
  const capped = (shown: number, total: number) =>
    total > shown ? (
      <Hint>
        Showing the first {count(shown)} of {count(total)}.
      </Hint>
    ) : null
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0">
        <span className="font-medium">{fileOf(entry)}</span>
        <span className="text-subtle">
          {" "}
          · {entry.startedByName ? `${entry.startedByName}, ` : ""}
          {absolute(entry.createdAt)}
        </span>
      </p>
      <p className="m-0 tabular-nums">
        {isActive(entry)
          ? `${count(entry.processedRows)} of ${count(entry.totalRows)} rows so far: ${outcome(entry)}.`
          : `${count(entry.totalRows)} rows: ${outcome(entry)}.`}
        {entry.status === "cancelled" ? " The import was cancelled." : ""}
        {entry.status === "failed" ? ` The import stopped before it finished. ${entry.error ?? ""}` : ""}
      </p>
      <LineProblems title="Not imported" lines={entry.failed} />
      {capped(entry.failed.length, entry.failedCount)}
      <LineProblems title="Imported with warnings" lines={entry.warnings} />
      {capped(entry.warnings.length, entry.warningCount)}
    </div>
  )
}

export function ImportResultsDialog(props: {
  readonly teamId: TeamId
  readonly importId: ImportId
  readonly plural: string
  readonly onClose: () => void
}) {
  return (
    <Dialog
      title="Import results"
      onClose={props.onClose}
      className="w-[min(46rem,calc(100%-2rem))]"
      footer={
        <Button variant="primary" onClick={props.onClose}>
          Done
        </Button>
      }
    >
      <ImportResults teamId={props.teamId} importId={props.importId} />
    </Dialog>
  )
}

const STATUS_LABEL: Record<Import["status"], string> = {
  queued: "Waiting",
  running: "Importing",
  "fetching-logos": "Fetching logos",
  finished: "Finished",
  cancelled: "Cancelled",
  failed: "Stopped",
}

/** A list's past imports, newest first, each opening its results (D135). */
export function PastImportsDialog(props: {
  readonly teamId: TeamId
  readonly recordType: RecordType
  readonly plural: string
  readonly onClose: () => void
}) {
  const imports = useImports(props.teamId, props.recordType)
  const [open, setOpen] = useState<ImportId>()
  return (
    <Dialog
      title={open ? "Import results" : `Past imports of ${props.plural}`}
      onClose={props.onClose}
      className="w-[min(46rem,calc(100%-2rem))]"
      footer={
        <>
          {open ? (
            <Button variant="ghost" onClick={() => setOpen(undefined)}>
              Back
            </Button>
          ) : null}
          <Button variant="primary" onClick={props.onClose}>
            Done
          </Button>
        </>
      }
    >
      {open ? (
        <ImportResults teamId={props.teamId} importId={open} />
      ) : imports.isError ? (
        <ErrorText>{messageOf(imports.error)}</ErrorText>
      ) : !imports.data ? (
        <Skeleton className="h-5 w-2/3" />
      ) : imports.data.length === 0 ? (
        <Hint>No {props.plural} have been imported yet.</Hint>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {imports.data.map((entry) => (
            <li key={entry.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                className="-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-hover"
                onClick={() => setOpen(entry.id)}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-fg">{fileOf(entry)}</span>
                  <span className="truncate text-sm text-subtle tabular-nums" title={absolute(entry.createdAt)}>
                    {entry.startedByName ? `${entry.startedByName} · ` : ""}
                    {ago(entry.createdAt)} · {isActive(entry) ? `${count(entry.processedRows)} of ` : ""}
                    {count(entry.totalRows)} rows · {outcome(entry)}
                  </span>
                </span>
                <Badge tone={entry.status === "failed" ? "danger" : "neutral"}>{STATUS_LABEL[entry.status]}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
