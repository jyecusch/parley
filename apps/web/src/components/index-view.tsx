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
import { DisplayIcon } from "./icons.tsx"
import { Dialog } from "./settings.tsx"

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
  readonly showingDeleted: boolean
  readonly onToggleDeleted: () => void
  readonly onExport: () => void
  readonly onImport: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="btn ghost sm trail-btn" type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <DisplayIcon />
        Display
      </button>
      {open ? (
        <div className="menu" style={{ right: 0, top: 30, width: 240 }}>
          <p className="menu-h sm-t">Sort</p>
          <div style={{ display: "flex", gap: 4, padding: "0 6px 6px" }}>
            <select
              className="fsel"
              aria-label="Sort by"
              style={{ margin: 0, boxShadow: "inset 0 0 0 1px var(--control)" }}
              value={props.sort?.field ?? ""}
              onChange={(event) =>
                props.onSort(
                  event.target.value ? { field: event.target.value, direction: props.sort?.direction ?? "asc" } : null,
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
            </select>
            {props.sort ? (
              <button
                className="btn sm"
                type="button"
                aria-label={
                  props.sort.direction === "asc" ? "Ascending; switch to descending" : "Descending; switch to ascending"
                }
                onClick={() =>
                  props.sort &&
                  props.onSort({ ...props.sort, direction: props.sort.direction === "asc" ? "desc" : "asc" })
                }
              >
                {props.sort.direction === "asc" ? "↑" : "↓"}
              </button>
            ) : null}
          </div>
          {props.customFields.length > 0 ? (
            <>
              <div className="menu-sep" />
              <p className="menu-h sm-t">Columns</p>
              {props.customFields.map((field) => {
                const ref = `custom:${field.id}`
                const on = props.columns.includes(ref)
                return (
                  <button
                    key={field.id}
                    className="menu-i"
                    type="button"
                    onClick={() =>
                      props.onColumns(on ? props.columns.filter((id) => id !== ref) : [...props.columns, ref])
                    }
                  >
                    {field.name}
                    {on ? <span className="hint">✓</span> : null}
                  </button>
                )
              })}
            </>
          ) : null}
          <div className="menu-sep" />
          <button
            className="menu-i"
            type="button"
            onClick={() => {
              setOpen(false)
              props.onToggleDeleted()
            }}
          >
            Show deleted {props.plural}
            {props.showingDeleted ? <span className="hint">✓</span> : null}
          </button>
          <button
            className="menu-i"
            type="button"
            onClick={() => {
              setOpen(false)
              props.onExport()
            }}
          >
            Export CSV
          </button>
          <button
            className="menu-i"
            type="button"
            onClick={() => {
              setOpen(false)
              props.onImport()
            }}
          >
            Import CSV…
          </button>
        </div>
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
      <span className="view-actions">
        <button className="btn ghost sm" type="button" onClick={props.onReset}>
          Reset
        </button>
        {props.viewName ? (
          <button className="btn sm" type="button" onClick={props.onSave}>
            Save
          </button>
        ) : null}
        <button className="btn sm" type="button" onClick={props.onSaveAs}>
          {props.viewName ? "Save as new view" : "Save view"}
        </button>
      </span>
    )
  }
  if (!props.viewName || !props.canDelete) return null
  return confirming ? (
    <span className="view-actions">
      <button className="btn ghost sm" type="button" onClick={() => setConfirming(false)}>
        Cancel
      </button>
      <button className="btn sm danger-solid" type="button" onClick={props.onDelete}>
        Delete view
      </button>
    </span>
  ) : (
    <button className="btn ghost sm" type="button" onClick={() => setConfirming(true)}>
      Delete view
    </button>
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
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" disabled={busy || !name.trim()} onClick={() => void save()}>
            Save view
          </button>
        </>
      }
    >
      <div className="fld">
        <label className="fl" htmlFor="view-name">
          Name
        </label>
        <input
          id="view-name"
          className="inp"
          type="text"
          maxLength={60}
          placeholder="Renewals this quarter"
          // biome-ignore lint/a11y/noAutofocus: the dialog's only text field
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void save()
          }}
        />
        <p className="hint sm-t">It saves the filters, sort and columns, and appears in the sidebar.</p>
      </div>
      {props.canShare ? (
        <label className="opt">
          <input
            className="cb shown"
            type="checkbox"
            checked={shared}
            onChange={(event) => setShared(event.target.checked)}
          />
          Share with the team
        </label>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}

/** Picks a CSV, shows how its columns map to fields, imports, and reports what happened (D62). */
export function ImportDialog(props: {
  readonly recordType: RecordType
  readonly plural: string
  readonly customFields: ReadonlyArray<CustomField>
  readonly onImport: (csv: string, mapping: Record<string, string>) => Promise<ImportResult>
  readonly onClose: () => void
}) {
  const [csv, setCsv] = useState<string>()
  const [mapping, setMapping] = useState<Record<string, string>>({})
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
      setResult(await props.onImport(csv, mapping))
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
          <button className="btn primary" type="button" onClick={props.onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn ghost" type="button" onClick={props.onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={busy || !csv || Object.keys(mapping).length === 0}
              onClick={() => void run()}
            >
              {busy ? "Importing…" : `Import ${rows} ${rows === 1 ? "row" : "rows"}`}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="fld">
          <p style={{ margin: 0 }}>
            {result.created} created, {result.updated} updated
            {result.failed.length > 0 ? `, ${result.failed.length} not imported` : ""}.
          </p>
          {result.failed.length > 0 ? (
            <div className="box" style={{ maxHeight: 220, overflow: "auto", padding: "6px 10px" }}>
              {result.failed.map((failure) => (
                <p key={failure.line} className="sm-t" style={{ margin: "4px 0" }}>
                  <b style={{ fontWeight: 470 }}>Line {failure.line}:</b>{" "}
                  <span className="c-muted">{failure.problems.map((problem) => problem.userMessage).join(" ")}</span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="fld">
            <label className="fl" htmlFor="import-file">
              CSV file
            </label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void read(event.target.files?.[0])}
            />
            <p className="hint sm-t">
              {props.recordType === "contact"
                ? "Rows with an email that's already in Parley update that contact. A Company column links each contact to its company."
                : "Rows with a domain or name that's already in Parley update that company."}{" "}
              Up to 5,000 rows.
            </p>
          </div>
          {headers.length > 0 ? (
            <fieldset className="fld">
              <legend>Columns</legend>
              {headers.map((header) => (
                <div
                  key={header}
                  style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" }}
                >
                  <span className="sm-t" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {header}
                  </span>
                  <select
                    className="fsel"
                    aria-label={`Field for ${header}`}
                    style={{ margin: 0, boxShadow: "inset 0 0 0 1px var(--control)" }}
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
                  </select>
                </div>
              ))}
            </fieldset>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
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
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy || !field}
            onClick={async () => {
              if (!field) return
              setBusy(true)
              await props.onApply(field, values[field.id] ?? null)
            }}
          >
            {field && values[field.id] === undefined ? "Clear it" : "Set it"}
          </button>
        </>
      }
    >
      {props.fields.length === 0 ? (
        <p className="hint">There are no custom fields yet. Add some in Settings → Fields.</p>
      ) : (
        <>
          <div className="fld">
            <label className="fl" htmlFor="bulk-field">
              Field
            </label>
            <select
              id="bulk-field"
              className="fsel"
              style={{ margin: 0, boxShadow: "inset 0 0 0 1px var(--control)" }}
              value={fieldId}
              onChange={(event) => setFieldId(event.target.value)}
            >
              {props.fields.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </div>
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
