import {
  type CustomField,
  type CustomValue,
  type FilterFieldInfo,
  guessMapping,
  IMPORT_FIELDS,
  type ImportResult,
  parseCsv,
  type RecordType,
  type Sort,
} from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useEffect, useRef, useState } from "react"
import { messageOf } from "../lib/client.ts"
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
  Hint,
  IconButton,
  Input,
  Menu,
  MenuHeading,
  MenuItem,
  MenuSeparator,
  Option,
  Select,
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

/** Picks a CSV, shows how its columns map to fields, imports, and reports what happened (D62). */
export function ImportDialog(props: {
  readonly recordType: RecordType
  readonly plural: string
  readonly customFields: ReadonlyArray<CustomField>
  readonly onImport: (
    csv: string,
    mapping: Record<string, string>,
    options: { readonly set: Record<string, string>; readonly multiSelect: "add" | "replace" },
  ) => Promise<ImportResult>
  readonly onClose: () => void
}) {
  const [csv, setCsv] = useState<string>()
  const [mapping, setMapping] = useState<Record<string, string>>({})
  /** Values for every row, by custom field: what a cell would say (option labels, joined by "; "). */
  const [set, setSet] = useState<Record<string, string>>({})
  const [replaceMulti, setReplaceMulti] = useState(false)
  const multiFields = props.customFields.filter((field) => field.type === "multi-select")
  const touchesMulti = multiFields.some(
    (field) => Object.values(mapping).includes(`custom:${field.id}`) || set[`custom:${field.id}`],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const [result, setResult] = useState<ImportResult>()
  const headers = csv ? (parseCsv(csv)[0] ?? []) : []
  const rows = csv ? Math.max(0, parseCsv(csv).length - 1) : 0
  const targets = [
    ...IMPORT_FIELDS[props.recordType].map((entry) => ({ field: entry.field as string, label: entry.label as string })),
    ...props.customFields.map((field) => ({ field: `custom:${field.id}`, label: field.name })),
  ]

  const read = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    setCsv(text)
    setResult(undefined)
    setMapping(guessMapping(parseCsv(text)[0] ?? [], props.recordType, props.customFields))
  }

  const run = async () => {
    if (!csv) return
    setBusy(true)
    setError(undefined)
    try {
      const filled = Object.fromEntries(Object.entries(set).filter(([, value]) => value.trim() !== ""))
      setResult(await props.onImport(csv, mapping, { set: filled, multiSelect: replaceMulti ? "replace" : "add" }))
    } catch (failure) {
      setError(messageOf(failure))
    }
    setBusy(false)
  }

  return (
    <Dialog
      title={`Import ${props.plural}`}
      onClose={props.onClose}
      footer={
        result ? (
          <Button variant="primary" onClick={props.onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !csv || Object.keys(mapping).length === 0}
              onClick={() => void run()}
            >
              {busy ? "Importing…" : `Import ${rows} ${rows === 1 ? "row" : "rows"}`}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0">
            {result.created} created, {result.updated} updated
            {result.failed.length > 0 ? `, ${result.failed.length} not imported` : ""}.
          </p>
          {result.failed.length > 0 ? (
            <Box className="max-h-64 overflow-auto px-3 py-1.5">
              {result.failed.map((failure) => (
                <p key={failure.line} className="my-1 text-sm">
                  <b className="font-medium">Line {failure.line}:</b>{" "}
                  <span className="text-subtle">
                    {failure.problems.map((problem) => problem.userMessage).join(" ")}
                  </span>
                </p>
              ))}
            </Box>
          ) : null}
        </div>
      ) : (
        <>
          <Field
            label="CSV file"
            htmlFor="import-file"
            hint={
              <>
                {props.recordType === "contact"
                  ? "Rows with an email that's already in Parley update that contact. A Company column links each contact to its company."
                  : "Rows with a domain or name that's already in Parley update that company."}{" "}
                Up to 5,000 rows.
              </>
            }
          >
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void read(event.target.files?.[0])}
            />
          </Field>
          {headers.length > 0 ? (
            <Fieldset legend="Columns">
              {headers.map((header) => (
                <div key={header} className="grid grid-cols-2 items-center gap-2.5">
                  <span className="truncate text-sm">{header}</span>
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
              ))}
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
          {error ? <ErrorText>{error}</ErrorText> : null}
        </>
      )}
    </Dialog>
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
