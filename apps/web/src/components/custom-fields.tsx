import { type CustomField, type CustomValue, checkCustomValue } from "@parley/domain"
import { useState } from "react"
import { formatValue } from "../lib/custom-fields.ts"
import { toE164 } from "./record.tsx"

/**
 * A record's custom fields, each editable in place (D73). Saving hands back the new value, or null
 * to clear it; the caller turns that into a patch.
 */
export function CustomFieldsSection(props: {
  readonly fields: ReadonlyArray<CustomField>
  readonly values: Readonly<Record<string, CustomValue>>
  readonly onSave: (field: CustomField, value: CustomValue | null) => void
}) {
  if (props.fields.length === 0) return null
  return (
    <section className="sec">
      {props.fields.map((field) => (
        <CustomFieldRow key={field.id} field={field} value={props.values[field.id]} onSave={props.onSave} />
      ))}
    </section>
  )
}

const inputType = (field: CustomField) => {
  switch (field.type) {
    case "number":
      return "number"
    case "date":
      return "date"
    case "url":
      return "url"
    case "email":
      return "email"
    case "phone":
      return "tel"
    default:
      return "text"
  }
}

/** What someone typed, as a value for the field, or a reason it can't be one. */
const parse = (field: CustomField, raw: string): { value: CustomValue | null } | { error: string } => {
  const text = raw.trim()
  if (!text) return { value: null }
  let value: CustomValue = text
  if (field.type === "number") value = Number(text)
  if (field.type === "phone") value = toE164(text)
  if (field.type === "url" && !/^https?:\/\//i.test(text)) value = `https://${text}`
  const problem = checkCustomValue(field, value)
  if (!problem) return { value }
  if (field.type === "number") return { error: "Enter a number." }
  if (field.type === "date") return { error: "Choose a date." }
  if (field.type === "email") return { error: "Enter a full email address, like jane@example.com." }
  if (field.type === "phone") return { error: "Enter the number with its country code, like +61 400 812 337." }
  if (field.type === "url") return { error: "Enter a web address, like acme.com." }
  return { error: "This is too long for this field." }
}

function CustomFieldRow(props: {
  readonly field: CustomField
  readonly value: CustomValue | undefined
  readonly onSave: (field: CustomField, value: CustomValue | null) => void
}) {
  const { field, value } = props
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string>()
  const id = `cf-${field.id}`

  if (field.type === "checkbox") {
    return (
      <div className="field">
        <label className="flabel sm-t" htmlFor={id}>
          {field.name}
        </label>
        <div className="fval" style={{ cursor: "default" }}>
          <input
            id={id}
            className="cb shown"
            type="checkbox"
            checked={value === true}
            onChange={(event) => props.onSave(field, event.target.checked ? true : null)}
          />
        </div>
      </div>
    )
  }

  if (field.type === "single-select") {
    return (
      <div className="field">
        <label className="flabel sm-t" htmlFor={id}>
          {field.name}
        </label>
        <div className="fval" style={{ padding: "0 6px" }}>
          <select
            id={id}
            className="fsel"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => props.onSave(field, event.target.value || null)}
          >
            <option value="">Empty</option>
            {field.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  if (field.type === "multi-select") {
    const chosen = new Set(Array.isArray(value) ? value : [])
    return (
      <div className="field">
        <span className="flabel sm-t">{field.name}</span>
        {editing ? (
          <fieldset
            className="fval"
            style={{ border: 0, minInlineSize: 0, cursor: "default" }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(false)
            }}
          >
            <legend className="vh">{field.name}</legend>
            {field.options.map((option, index) => (
              <label key={option.id} className="opt">
                <input
                  className="cb shown"
                  type="checkbox"
                  // biome-ignore lint/a11y/noAutofocus: the person just opened this field to choose
                  autoFocus={index === 0}
                  checked={chosen.has(option.id)}
                  onChange={() => {
                    const next = field.options
                      .map((o) => o.id)
                      .filter((o) => (o === option.id ? !chosen.has(o) : chosen.has(o)))
                    props.onSave(field, next.length > 0 ? next : null)
                  }}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        ) : (
          <button className="fval" type="button" onClick={() => setEditing(true)}>
            {chosen.size > 0 ? (
              <span className="chips">
                {field.options
                  .filter((option) => chosen.has(option.id))
                  .map((option) => (
                    <span key={option.id} className="chip sm-t">
                      {option.label}
                    </span>
                  ))}
              </span>
            ) : (
              <span className="empty-v">Empty</span>
            )}
          </button>
        )}
      </div>
    )
  }

  if (editing) {
    const commit = (raw: string) => {
      const parsed = parse(field, raw)
      if ("error" in parsed) return setError(parsed.error)
      setError(undefined)
      setEditing(false)
      if (JSON.stringify(parsed.value) !== JSON.stringify(value ?? null)) props.onSave(field, parsed.value)
    }
    return (
      <div className="field">
        <label className="flabel sm-t" htmlFor={id}>
          {field.name}
        </label>
        <div className="fval" style={{ padding: "0 6px" }}>
          <input
            id={id}
            className="finp"
            type={inputType(field)}
            step={field.type === "number" ? "any" : undefined}
            defaultValue={typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
            // biome-ignore lint/a11y/noAutofocus: the person just clicked this field to edit it
            autoFocus
            aria-invalid={error ? true : undefined}
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(event.currentTarget.value)
              if (event.key === "Escape") {
                event.stopPropagation()
                setError(undefined)
                setEditing(false)
              }
            }}
          />
          {error ? <p className="ferr sm-t">{error}</p> : null}
        </div>
      </div>
    )
  }

  const shown = formatValue(field, value)
  return (
    <div className="field">
      <span className="flabel sm-t">{field.name}</span>
      <button className="fval" type="button" onClick={() => setEditing(true)}>
        {shown ? (
          <span className="fline">
            <span className="t">{shown}</span>
          </span>
        ) : (
          <span className="empty-v">Empty</span>
        )}
      </button>
    </div>
  )
}

/** A custom value in a table cell. */
export function CustomCell(props: { readonly field: CustomField; readonly value: CustomValue | undefined }) {
  const shown = formatValue(props.field, props.value)
  return shown ? <span title={shown}>{shown}</span> : <span className="c-none">—</span>
}
