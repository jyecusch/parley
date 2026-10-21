import {
  type CustomField,
  type CustomValue,
  type FilterFieldInfo,
  guessMapping,
  IMPORT_FIELDS,
  IMPORT_MAX_ROWS,
  type Import,
  parseCsv,
  type RecordType,
  type Sort,
  type TeamId,
  type UserId,
} from "@parley/domain"
import { type UserText, userText } from "@parley/errors"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { type Person, personLabel, usePeople } from "../lib/people.ts"
import { CustomFieldsSection } from "./custom-fields.tsx"
import { CloseIcon, DisplayIcon, DownloadIcon } from "./icons.tsx"
import { Dialog } from "./settings.tsx"
import {
  Box,
  Button,
  Checkbox,
  ErrorText,
  Field,
  Fieldset,
  FilePicker,
  Hint,
  IconButton,
  Input,
  Menu,
  MenuHeading,
  MenuItem,
  MenuSeparator,
  Notice,
  Option,
  Select,
  TextButton,
} from "./ui/index.ts"

const useDismiss = (open: boolean, close: () => void) => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close()
    }
    document.addEventListener("pointerdown", onPointer)
    return () => document.removeEventListener("pointerdown", onPointer)
  }, [open, close])
  return ref
}

/** The Display menu of an index view (D65): sort, columns, deleted records, and CSV in and out. */
export function DisplayMenu(props: {
  readonly plural: string
  readonly fields: ReadonlyArray<FilterFieldInfo>
  readonly customFields: ReadonlyArray<CustomField>
  readonly sort: Sort | null
  readonly onSort: (sort: Sort | null) => void
  readonly columns: ReadonlyArray<string>
  readonly onColumns: (columns: ReadonlyArray<string>) => void
  /** Optional built-in columns, such as the record owner, by the name the view stores. */
  readonly builtInColumns?: ReadonlyArray<{ readonly ref: string; readonly label: string }>
  readonly showingDeleted: boolean
  readonly onToggleDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <DisplayIcon />
        Display
      </Button>
      {open ? (
        <Menu className="top-full right-0 mt-1 w-72">
          <MenuHeading>Sort</MenuHeading>
          <div className="flex gap-1 px-1.5 pb-1.5">
            <div className="min-w-0 flex-1">
              <Select
                className="h-8 text-sm"
                aria-label="Sort by"
                value={props.sort?.field ?? ""}
                onChange={(event) =>
                  props.onSort(
                    event.target.value
                      ? { field: event.target.value, direction: props.sort?.direction ?? "asc" }
                      : null,
                  )
                }
              >
                <option value="">Recently updated</option>
                {props.fields
                  .filter((field) => field.kind !== "company" && field.kind !== "multi")
                  .map((field) => (
                    <option key={field.field} value={field.field}>
                      {field.label}
                    </option>
                  ))}
              </Select>
            </div>
            {props.sort ? (
              <Button
                size="sm"
                className="h-8"
                aria-label={
                  props.sort.direction === "asc" ? "Ascending; switch to descending" : "Descending; switch to ascending"
                }
                onClick={() =>
                  props.sort &&
                  props.onSort({ ...props.sort, direction: props.sort.direction === "asc" ? "desc" : "asc" })
                }
              >
                {props.sort.direction === "asc" ? "↑" : "↓"}
              </Button>
            ) : null}
          </div>
          {props.customFields.length > 0 || (props.builtInColumns ?? []).length > 0 ? (
            <>
              <MenuSeparator />
              <MenuHeading>Columns</MenuHeading>
              {[
                ...(props.builtInColumns ?? []),
                ...props.customFields.map((field) => ({ ref: `custom:${field.id}`, label: field.name })),
              ].map((column) => {
                const on = props.columns.includes(column.ref)
                return (
                  <MenuItem
                    key={column.ref}
                    onClick={() =>
                      props.onColumns(
                        on ? props.columns.filter((id) => id !== column.ref) : [...props.columns, column.ref],
                      )
                    }
                  >
                    {column.label}
                    {on ? <span className="ml-auto text-subtle">✓</span> : null}
                  </MenuItem>
                )
              })}
            </>
          ) : null}
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              setOpen(false)
              props.onToggleDeleted()
            }}
          >
            Show deleted {props.plural}
            {props.showingDeleted ? <span className="ml-auto text-subtle">✓</span> : null}
          </MenuItem>
        </Menu>
      ) : null}
    </div>
  )
}

/**
 * Export as CSV: what the list is showing (its filter, quick filter and all), or, for contacts, a
 * segment's contacts.
 */
export function ExportMenu(props: {
  readonly singular: string
  readonly plural: string
  readonly showing: number
  readonly filtered: boolean
  readonly onExportShowing: () => void
  readonly segments?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly contactCount: number }>
  readonly onExportSegment?: (segmentId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const segments = props.segments ?? []
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <DownloadIcon className="size-4" />
        Export
      </Button>
      {open ? (
        <Menu className="top-full right-0 mt-1 w-72">
          <MenuHeading>Download as CSV</MenuHeading>
          <MenuItem
            onClick={() => {
              setOpen(false)
              props.onExportShowing()
            }}
          >
            {props.showing === 1
              ? `The 1 ${props.singular} showing`
              : props.filtered
                ? `The ${props.showing} ${props.plural} showing`
                : `All ${props.showing} ${props.plural}`}
          </MenuItem>
          {segments.length > 0 && props.onExportSegment ? (
            <>
              <MenuSeparator />
              <MenuHeading>A segment</MenuHeading>
              {segments.map((segment) => (
                <MenuItem
                  key={segment.id}
                  onClick={() => {
                    setOpen(false)
                    props.onExportSegment?.(segment.id)
                  }}
                >
                  <span className="truncate">{segment.name}</span>
                  <span className="ml-auto text-subtle tabular-nums">{segment.contactCount}</span>
                </MenuItem>
              ))}
            </>
          ) : null}
        </Menu>
      ) : null}
    </div>
  )
}

/** Header actions for an index view with unsaved changes, or an open saved view (D65). */
export function ViewActions(props: {
  readonly viewName: string | undefined
  readonly canDelete: boolean
  readonly dirty: boolean
  readonly onSave: () => void
  readonly onSaveAs: () => void
  readonly onReset: () => void
  readonly onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  if (props.dirty) {
    return (
      <span className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" onClick={props.onReset}>
          Reset
        </Button>
        {props.viewName ? (
          <Button size="sm" onClick={props.onSave}>
            Save
          </Button>
        ) : null}
        <Button size="sm" onClick={props.onSaveAs}>
          {props.viewName ? "Save as new view" : "Save view"}
        </Button>
      </span>
    )
  }
  if (!props.viewName || !props.canDelete) return null
  return confirming ? (
    <span className="flex shrink-0 gap-1">
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Button variant="danger-solid" size="sm" onClick={props.onDelete}>
        Delete view
      </Button>
    </span>
  ) : (
    <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
      Delete view
    </Button>
  )
}

export function SaveViewDialog(props: {
  readonly canShare: boolean
  readonly onClose: () => void
  readonly onSave: (name: string, shared: boolean) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const save = async () => {
    setBusy(true)
    try {
      await props.onSave(name.trim(), shared)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Save view"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            Save view
          </Button>
        </>
      }
    >
      <Field
        label="Name"
        htmlFor="view-name"
        hint="It saves the filters, sort and columns, and appears in the sidebar."
      >
        <Input
          id="view-name"
          type="text"
          maxLength={60}
          placeholder="Renewals this quarter"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void save()
          }}
        />
      </Field>
      {props.canShare ? (
        <Option>
          <Checkbox checked={shared} onChange={(event) => setShared(event.target.checked)} />
          Share with the team
        </Option>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}

/** The most imported text imports.start takes, in characters (D135). */
const IMPORT_MAX_CHARACTERS = 30_000_000

/**
 * Rows as CSV text, quoting only where needed. Unlike export's toCsv it doesn't guard cells that
 * look like formulas, which would change values such as "+61 400 812 337" on their way back in.
 */
const plainCsv = (rows: ReadonlyArray<ReadonlyArray<string>>) =>
  rows
    .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(","))
    .join("\r\n")

/** HubSpot's per-type opt-out columns, "Opted out of email: Product updates" (D127). */
const OPT_OUT = /^opted out of email:\s*(.+)$/i

/** A cell that says yes, as consent columns write it. */
const isTrue = (cell: string) => ["true", "yes", "y", "1"].includes(cell.trim().toLowerCase())
/** A bounce column: a yes, or any reason that isn't a no (D125). */
const isBounce = (cell: string) => {
  const value = cell.trim().toLowerCase()
  return value !== "" && !["false", "no", "n", "0"].includes(value)
}

/** The indexes of the columns mapped to a field. */
const columnsMappedTo = (headers: ReadonlyArray<string>, mapping: Record<string, string>, field: string) =>
  headers.map((header, index) => (mapping[header] === field ? index : -1)).filter((index) => index >= 0)

/**
 * Owner cells that don't match a person the way the server matches them (D123): an email, or a
 * name only one person has. Most common first, with how many rows each is on.
 */
const unknownOwnersIn = (
  table: ReadonlyArray<ReadonlyArray<string>>,
  mapping: Record<string, string>,
  people: ReadonlyArray<Person>,
): ReadonlyArray<readonly [string, number]> => {
  const [headers = [], ...body] = table
  const columns = columnsMappedTo(headers, mapping, "owner")
  if (columns.length === 0) return []
  const counts = new Map<string, number>()
  for (const row of body) {
    for (const column of columns) {
      const cell = row[column]?.trim() ?? ""
      if (cell) counts.set(cell, (counts.get(cell) ?? 0) + 1)
    }
  }
  const known = (cell: string) => {
    const value = cell.toLowerCase()
    if (people.some((person) => person.email?.toLowerCase() === value)) return true
    return people.filter((person) => person.name.toLowerCase() === value).length === 1
  }
  return [...counts.entries()].filter(([cell]) => !known(cell)).sort((a, b) => b[1] - a[1])
}

/** How many rows the consent columns unsubscribe or mark bounced (D125); undefined with none mapped. */
const consentIn = (table: ReadonlyArray<ReadonlyArray<string>>, mapping: Record<string, string>) => {
  const [headers = [], ...body] = table
  const statusColumns = columnsMappedTo(headers, mapping, "subscriptionStatus")
  const unsubscribeColumns = columnsMappedTo(headers, mapping, "unsubscribed")
  const bounceColumns = columnsMappedTo(headers, mapping, "bounced")
  if (statusColumns.length + unsubscribeColumns.length + bounceColumns.length === 0) return undefined
  const says = (row: ReadonlyArray<string>, column: number, values: ReadonlyArray<string>) =>
    values.includes((row[column] ?? "").trim().toLowerCase())
  let unsubscribed = 0
  let bounced = 0
  for (const row of body) {
    if (bounceColumns.some((column) => isBounce(row[column] ?? ""))) bounced++
    else if (
      unsubscribeColumns.some((column) => isTrue(row[column] ?? "")) ||
      statusColumns.some((column) => says(row, column, ["unsubscribed", "no", "n", "false", "0"]))
    )
      unsubscribed++
  }
  return { unsubscribed, bounced }
}

type ImportOptions = {
  readonly set: Record<string, string>
  readonly multiSelect: "add" | "replace"
  readonly owners: Record<string, UserId | null>
}

/**
 * Picks a CSV and shows how its columns map to fields (D62), then starts the import on the server
 * with only the mapped columns, and closes: the list shows its progress (D135).
 */
export function ImportDialog(props: {
  readonly teamId: TeamId
  readonly recordType: RecordType
  readonly plural: string
  readonly customFields: ReadonlyArray<CustomField>
  /** Whether the person may create topics (email:manage), for opt-out columns (D127). */
  readonly canCreateTopics: boolean
  readonly onStarted: (started: Import) => void
  readonly onShowPast: () => void
  readonly onClose: () => void
}) {
  const [csv, setCsv] = useState<string>()
  const [fileName, setFileName] = useState<string>()
  const [mapping, setMapping] = useState<Record<string, string>>({})
  /** Values for every row, by custom field: what a cell would say (option labels, joined by "; "). */
  const [set, setSet] = useState<Record<string, string>>({})
  const [replaceMulti, setReplaceMulti] = useState(false)
  /** Who each unrecognised owner cell means (D127): a person, or no one. */
  const [owners, setOwners] = useState<Record<string, UserId | null>>({})
  /** Opt-out columns whose topic doesn't exist yet, by header, and whether to create it. */
  const [newTopics, setNewTopics] = useState<Record<string, { readonly name: string; readonly create: boolean }>>({})
  const [showSkipped, setShowSkipped] = useState(false)
  const multiFields = props.customFields.filter((field) => field.type === "multi-select")
  const touchesMulti = multiFields.some(
    (field) => Object.values(mapping).includes(`custom:${field.id}`) || set[`custom:${field.id}`],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const people = usePeople(props.teamId).data ?? []
  const topics = useQuery({
    queryKey: ["topics", props.teamId],
    enabled: props.recordType === "contact",
    queryFn: () => call("topics.list", { teamId: props.teamId }),
  })
  const table = useMemo(() => (csv ? parseCsv(csv) : []), [csv])
  const headers = table[0] ?? []
  const body = table.slice(1)
  const rows = body.length
  const tooMany = rows > IMPORT_MAX_ROWS
  const targets = [
    ...IMPORT_FIELDS[props.recordType].map((entry) => ({ field: entry.field as string, label: entry.label as string })),
    ...props.customFields.map((field) => ({ field: `custom:${field.id}`, label: field.name })),
    ...(topics.data ?? []).map((topic) => ({ field: `topic:${topic.id}`, label: `Left topic: ${topic.name}` })),
  ]

  const read = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    load(await file.text())
  }

  /** Takes a file's text: guesses its columns, and finds opt-out columns for existing or new topics. */
  const load = (text: string) => {
    const [fileHeaders = []] = parseCsv(text)
    const guessed = guessMapping(fileHeaders, props.recordType, props.customFields)
    const pending: Record<string, { name: string; create: boolean }> = {}
    if (props.recordType === "contact") {
      for (const header of fileHeaders) {
        const name = OPT_OUT.exec(header.trim())?.[1]?.trim()
        if (!name || guessed[header]) continue
        const topic = topics.data?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())
        if (topic) guessed[header] = `topic:${topic.id}`
        else pending[header] = { name, create: props.canCreateTopics }
      }
    }
    setCsv(text)
    setError(undefined)
    setOwners({})
    setNewTopics(pending)
    setMapping(guessed)
  }

  // Topics that load after the file was read: opt-out columns for them map to them, not to new ones.
  useEffect(() => {
    const known = topics.data ?? []
    const matched = Object.entries(newTopics).flatMap(([header, pending]) => {
      const topic = known.find((entry) => entry.name.toLowerCase() === pending.name.toLowerCase())
      return topic ? [[header, topic.id] as const] : []
    })
    if (matched.length === 0) return
    setMapping((current) => ({
      ...current,
      ...Object.fromEntries(matched.map(([header, id]) => [header, `topic:${id}`])),
    }))
    setNewTopics((current) => {
      const next = { ...current }
      for (const [header] of matched) delete next[header]
      return next
    })
  }, [topics.data, newTopics])

  const unknownOwners = unknownOwnersIn(table, mapping, people)
  const consent = props.recordType === "contact" ? consentIn(table, mapping) : undefined

  const run = async () => {
    if (!csv) return
    setBusy(true)
    setError(undefined)
    // Topics for opt-out columns are made first, so the columns can name them (D127).
    const finalMapping = { ...mapping }
    try {
      for (const [header, pending] of Object.entries(newTopics)) {
        if (!pending.create || !props.canCreateTopics) continue
        const existing = (await call("topics.list", { teamId: props.teamId })).find(
          (topic) => topic.name.toLowerCase() === pending.name.toLowerCase(),
        )
        const topic = existing ?? (await call("topics.create", { teamId: props.teamId, name: pending.name as never }))
        finalMapping[header] = `topic:${topic.id}`
      }
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
      return
    }
    const filled = Object.fromEntries(Object.entries(set).filter(([, value]) => value.trim() !== ""))
    const options: ImportOptions = {
      set: filled,
      multiSelect: replaceMulti ? "replace" : "add",
      owners: Object.fromEntries(unknownOwners.map(([cell]) => [cell, owners[cell] ?? null])),
    }
    // Only the mapped columns go, which keeps a big file's request small.
    const [header = []] = table
    const kept = header.map((_, index) => index).filter((index) => finalMapping[header[index] ?? ""])
    const text = plainCsv(table.map((row) => kept.map((index) => row[index] ?? "")))
    // The server counts characters, and the request's size in bytes (32 MB with the rest of the request).
    if (text.length > IMPORT_MAX_CHARACTERS || new Blob([text]).size > IMPORT_MAX_CHARACTERS) {
      setError(
        userText`The imported columns come to more than 30 MB, which is more than one import takes. Skip columns you don't need, or split the file.`,
      )
      setBusy(false)
      return
    }
    try {
      const started = await call("imports.start", {
        teamId: props.teamId,
        recordType: props.recordType,
        csv: text,
        ...(fileName ? { fileName } : {}),
        mapping: Object.fromEntries(
          kept.map((index) => [header[index] ?? "", finalMapping[header[index] ?? ""] ?? ""]),
        ),
        ...options,
      })
      props.onStarted(started)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  const mappedHeaders = headers.filter((header) => mapping[header])
  const skippedHeaders = headers.filter((header) => !mapping[header])
  const columnRow = (header: string) => (
    <div key={header} className="grid grid-cols-2 items-center gap-2.5">
      {/* The file's own header, as written there, so it reads as quoted rather than as a Parley field. */}
      <span className="truncate text-sm text-muted" title={header}>
        {header}
      </span>
      <Select
        className="h-9"
        aria-label={`Field for ${header}`}
        value={mapping[header] ?? ""}
        onChange={(event) => {
          const next = { ...mapping }
          if (event.target.value) next[header] = event.target.value
          else delete next[header]
          setMapping(next)
        }}
      >
        <option value="">Skip</option>
        {targets.map((target) => (
          <option key={target.field} value={target.field}>
            {target.label}
          </option>
        ))}
      </Select>
    </div>
  )
  const pendingTopics = Object.entries(newTopics)

  return (
    <Dialog
      title={`Import ${props.plural}`}
      onClose={props.onClose}
      className="w-[min(46rem,calc(100%-2rem))]"
      footer={
        <>
          <TextButton className="mr-auto self-center text-sm" onClick={props.onShowPast}>
            Past imports
          </TextButton>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !csv || Object.keys(mapping).length === 0 || tooMany}
            onClick={() => void run()}
          >
            {busy ? "Starting…" : `Import ${rows.toLocaleString()} ${rows === 1 ? "row" : "rows"}`}
          </Button>
        </>
      }
    >
      <Field
        label="CSV file"
        htmlFor="import-file"
        hint={
          <>
            {props.recordType === "contact"
              ? "Rows with an email that's already in Parley update that contact. A Company column links each contact to its company."
              : "Rows with a domain or name that's already in Parley update that company."}{" "}
            Up to {IMPORT_MAX_ROWS.toLocaleString()} rows. Parley imports the file in the background, so you can leave
            the page once it starts.
          </>
        }
      >
        <FilePicker
          id="import-file"
          accept=".csv,text/csv"
          prompt="Choose a CSV file"
          fileName={fileName}
          onFile={(file) => void read(file)}
        />
      </Field>
      {tooMany ? (
        <Notice tone="danger" title="Too many rows">
          This file has {rows.toLocaleString()} rows, and one import takes up to {IMPORT_MAX_ROWS.toLocaleString()}.
          Split it into smaller files and import each.
        </Notice>
      ) : null}
      {headers.length > 0 ? (
        <Fieldset legend="Columns">
          <div className="grid grid-cols-2 gap-2.5 text-sm font-medium text-subtle" aria-hidden="true">
            <span>In your file</span>
            <span>Imports into</span>
          </div>
          {mappedHeaders.length === 0 ? (
            <Hint>No columns are imported yet. Choose a field for each one you want.</Hint>
          ) : null}
          {mappedHeaders.map(columnRow)}
          {skippedHeaders.length > 0 ? (
            <TextButton className="mt-1 text-sm" onClick={() => setShowSkipped((open) => !open)}>
              {showSkipped
                ? "Hide skipped columns"
                : `${skippedHeaders.length} ${skippedHeaders.length === 1 ? "column" : "columns"} skipped. Show them`}
            </TextButton>
          ) : null}
          {showSkipped ? skippedHeaders.map(columnRow) : null}
        </Fieldset>
      ) : null}
      {headers.length > 0 && props.customFields.length > 0 ? (
        <SetOnEveryRow fields={props.customFields} value={set} onChange={setSet} />
      ) : null}
      {headers.length > 0 && touchesMulti ? (
        <Option>
          <Checkbox checked={replaceMulti} onChange={(event) => setReplaceMulti(event.target.checked)} />
          <span>
            Replace values in multi-select fields{" "}
            <span className="text-subtle">
              (otherwise a {props.recordType} that's already in Parley keeps its values and gains these)
            </span>
          </span>
        </Option>
      ) : null}
      {headers.length > 0 && unknownOwners.length > 0 ? (
        <Fieldset legend={props.recordType === "contact" ? "Contact owners" : "Company owners"}>
          <Hint>
            These aren't anyone in the team, such as people who've left. Choose who gets their {props.plural}, or no
            one.
          </Hint>
          {unknownOwners.map(([cell, count]) => (
            <div key={cell} className="grid grid-cols-2 items-center gap-2.5">
              <span className="truncate text-sm" title={cell}>
                {cell} <span className="text-subtle tabular-nums">· {count.toLocaleString()}</span>
              </span>
              <Select
                className="h-9"
                aria-label={`Owner for ${cell}`}
                value={owners[cell] ?? ""}
                onChange={(event) => setOwners({ ...owners, [cell]: (event.target.value || null) as UserId | null })}
              >
                <option value="">No one</option>
                {people.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {personLabel(person)}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </Fieldset>
      ) : null}
      {headers.length > 0 && pendingTopics.length > 0 ? (
        <Fieldset legend="Topics">
          {props.canCreateTopics ? (
            <Hint>
              These columns say who left a kind of email. Parley can make a topic for each, so they stay unsubscribed
              from just that.
            </Hint>
          ) : (
            <Notice tone="warn">
              Some columns say who left a kind of email, but there's no topic for them, and making topics takes
              permission to manage email. Those columns are skipped; ask an admin to add the topics first.
            </Notice>
          )}
          {props.canCreateTopics
            ? pendingTopics.map(([header, pending]) => (
                <Option key={header}>
                  <Checkbox
                    checked={pending.create}
                    onChange={(event) =>
                      setNewTopics({ ...newTopics, [header]: { ...pending, create: event.target.checked } })
                    }
                  />
                  <span>
                    Create topic <b className="font-medium">{pending.name}</b>
                  </span>
                </Option>
              ))
            : null}
        </Fieldset>
      ) : null}
      {headers.length > 0 && props.recordType === "contact" ? (
        consent ? (
          <Notice tone="info" title="Email consent">
            {consent.unsubscribed.toLocaleString()} {consent.unsubscribed === 1 ? "row is" : "rows are"} unsubscribed
            and {consent.bounced.toLocaleString()} bounced. The rest are imported as subscribed. An import never
            subscribes anyone again who left.
          </Notice>
        ) : (
          <Notice tone="warn" title="Everyone new will be subscribed">
            No column says who unsubscribed or bounced, so new contacts are imported as subscribed. Only import people
            who agreed to get your email, or map a consent column above.
          </Notice>
        )
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}

/** Rows listed by their line in the file, with what went wrong. */
export function LineProblems(props: {
  readonly title: string
  readonly lines: ReadonlyArray<{
    readonly line: number
    readonly problems: ReadonlyArray<{ readonly userMessage: string }>
  }>
}) {
  if (props.lines.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium">{props.title}</span>
      <Box className="max-h-64 overflow-auto px-3 py-1.5">
        {props.lines.map((entry) => (
          <p key={entry.line} className="my-1 text-sm">
            <b className="font-medium">Line {entry.line}:</b>{" "}
            <span className="text-subtle">{entry.problems.map((problem) => problem.userMessage).join(" ")}</span>
          </p>
        ))}
      </Box>
    </div>
  )
}

/** Bulk "set a field" on selected records (D71): pick a custom field, then its value. */
export function SetFieldDialog(props: {
  readonly count: number
  readonly noun: string
  readonly fields: ReadonlyArray<CustomField>
  readonly onApply: (field: CustomField, value: CustomValue | null) => Promise<void>
  readonly onClose: () => void
}) {
  const [fieldId, setFieldId] = useState(props.fields[0]?.id ?? "")
  const [busy, setBusy] = useState(false)
  const field = props.fields.find((candidate) => candidate.id === fieldId)
  const [values, setValues] = useState<Record<string, CustomValue>>({})
  return (
    <Dialog
      title={`Set a field on ${props.count} ${props.noun}`}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !field}
            onClick={async () => {
              if (!field) return
              setBusy(true)
              await props.onApply(field, values[field.id] ?? null)
            }}
          >
            {field && values[field.id] === undefined ? "Clear it" : "Set it"}
          </Button>
        </>
      }
    >
      {props.fields.length === 0 ? (
        <Hint>There are no custom fields yet. Add some in Settings → Fields.</Hint>
      ) : (
        <>
          <Field label="Field" htmlFor="bulk-field">
            <Select id="bulk-field" value={fieldId} onChange={(event) => setFieldId(event.target.value)}>
              {props.fields.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
          </Field>
          {field ? (
            <CustomFieldsSection
              fields={[field]}
              values={values}
              onSave={(saved, value) => {
                const next = { ...values }
                if (value === null) delete next[saved.id]
                else next[saved.id] = value
                setValues(next)
              }}
            />
          ) : null}
        </>
      )}
    </Dialog>
  )
}

/**
 * Custom field values to give every imported row (D124), such as which product a file of contacts
 * came from. Kept as the text a CSV cell would hold, so the import reads them the same way.
 */
function SetOnEveryRow(props: {
  readonly fields: ReadonlyArray<CustomField>
  readonly value: Record<string, string>
  readonly onChange: (value: Record<string, string>) => void
}) {
  const chosen = Object.keys(props.value)
  const available = props.fields.filter((field) => !chosen.includes(`custom:${field.id}`))
  const setOne = (target: string, text: string) => props.onChange({ ...props.value, [target]: text })
  const remove = (target: string) => {
    const next = { ...props.value }
    delete next[target]
    props.onChange(next)
  }
  return (
    <Fieldset legend="Set on every row">
      {chosen.map((target) => {
        const field = props.fields.find((entry) => `custom:${entry.id}` === target)
        if (!field) return null
        const text = props.value[target] ?? ""
        const labels = text
          .split(";")
          .map((label) => label.trim())
          .filter(Boolean)
        return (
          <div key={target} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-start gap-2.5">
            <span className="truncate pt-2 text-sm">{field.name}</span>
            {field.type === "multi-select" ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1.5">
                {field.options.map((option) => (
                  <Option key={option.id} className="min-h-6 text-sm">
                    <Checkbox
                      checked={labels.includes(option.label)}
                      onChange={(event) =>
                        setOne(
                          target,
                          (event.target.checked
                            ? [...labels, option.label]
                            : labels.filter((label) => label !== option.label)
                          ).join("; "),
                        )
                      }
                    />
                    {option.label}
                  </Option>
                ))}
              </div>
            ) : field.type === "single-select" ? (
              <Select
                className="h-9"
                aria-label={`Value for ${field.name}`}
                value={text}
                onChange={(event) => setOne(target, event.target.value)}
              >
                <option value="">Choose…</option>
                {field.options.map((option) => (
                  <option key={option.id} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                className="h-9"
                aria-label={`Value for ${field.name}`}
                value={text}
                onChange={(event) => setOne(target, event.target.value)}
              />
            )}
            <IconButton label={`Don't set ${field.name}`} size="xs" onClick={() => remove(target)}>
              <CloseIcon className="size-4" />
            </IconButton>
          </div>
        )
      })}
      {available.length > 0 ? (
        <Select
          className="h-9 self-start"
          aria-label="Add a field to set on every row"
          value=""
          onChange={(event) => event.target.value && setOne(event.target.value, "")}
        >
          <option value="">Add a field…</option>
          {available.map((field) => (
            <option key={field.id} value={`custom:${field.id}`}>
              {field.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Hint>
        For example, which product this file came from. A row's own value wins; multi-select values are combined.
      </Hint>
    </Fieldset>
  )
}
