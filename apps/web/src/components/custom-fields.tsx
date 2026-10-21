import { type CustomField, type CustomValue, checkCustomValue } from "@parley/domain"
import { useState } from "react"
import { formatValue } from "../lib/custom-fields.ts"
import { EmptyValue, propertyFieldsetClass, toE164, ValueLine } from "./record.tsx"
import { Button as PlainButton } from "./ui/button.tsx"
import {
  Checkbox,
  Chip,
  ErrorText,
  InlineInput,
  Option,
  PropertyRow,
  propertyValueClass,
  Section,
  Select,
} from "./ui/index.ts"

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
    <Section>
      {props.fields.map((field) => (
        <CustomFieldRow key={field.id} field={field} value={props.values[field.id]} onSave={props.onSave} />
      ))}
    </Section>
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
      <PropertyRow label={field.name} htmlFor={id}>
        <div className="flex h-8 items-center">
          <Checkbox
            id={id}
            checked={value === true}
            onChange={(event) => props.onSave(field, event.target.checked ? true : null)}
          />
        </div>
      </PropertyRow>
    )
  }

  if (field.type === "single-select") {
    return (
      <PropertyRow label={field.name} htmlFor={id}>
        <Select
          variant="inline"
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => props.onSave(field, event.target.value || null)}
        >
          <option value="">Empty</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </PropertyRow>
    )
  }

  if (field.type === "multi-select") {
    const chosen = new Set(Array.isArray(value) ? value : [])
    return (
      <PropertyRow label={field.name}>
        {editing ? (
          <fieldset
            className={propertyFieldsetClass}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(false)
            }}
          >
            <legend className="sr-only">{field.name}</legend>
            {field.options.map((option, index) => (
              <Option key={option.id}>
                <Checkbox
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
              </Option>
            ))}
          </fieldset>
        ) : (
          <PlainButton
            variant={null}
            size={null}
            className={propertyValueClass}
            type="button"
            onClick={() => setEditing(true)}
          >
            {chosen.size > 0 ? (
              <span className="flex flex-wrap gap-1">
                {field.options
                  .filter((option) => chosen.has(option.id))
                  .map((option) => (
                    <Chip key={option.id} className="text-sm">
                      {option.label}
                    </Chip>
                  ))}
              </span>
            ) : (
              <EmptyValue />
            )}
          </PlainButton>
        )}
      </PropertyRow>
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
      <PropertyRow label={field.name} htmlFor={id}>
        <div className="flex min-w-0 flex-col">
          <InlineInput
            id={id}
            type={inputType(field)}
            step={field.type === "number" ? "any" : undefined}
            defaultValue={typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
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
          {error ? <ErrorText className="my-1">{error}</ErrorText> : null}
        </div>
      </PropertyRow>
    )
  }

  const shown = formatValue(field, value)
  return (
    <PropertyRow label={field.name}>
      <PlainButton
        variant={null}
        size={null}
        className={propertyValueClass}
        type="button"
        onClick={() => setEditing(true)}
      >
        {shown ? <ValueLine value={shown} /> : <EmptyValue />}
      </PlainButton>
    </PropertyRow>
  )
}

/** A custom value in a table cell. */
export function CustomCell(props: { readonly field: CustomField; readonly value: CustomValue | undefined }) {
  const shown = formatValue(props.field, props.value)
  return shown ? <span title={shown}>{shown}</span> : <span className="text-subtle">—</span>
}
