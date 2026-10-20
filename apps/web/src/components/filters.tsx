import {
  checkCondition,
  type Filter,
  type FilterCondition,
  type FilterFieldInfo,
  type FilterOperator,
  type FilterValue,
  OPERATOR_LABELS,
  OPERATORS_BY_KIND,
  VALUELESS,
} from "@parley/domain"
import { useEffect, useRef, useState } from "react"
import { CloseIcon, PlusIcon } from "./icons.tsx"

/** A choice for select and company values. */
export interface ValueOption {
  readonly id: string
  readonly label: string
}

/**
 * The filter bar of an index view (D65): one chip per condition, a way to add one, and all/any when
 * there are several. Shared by saved views and v2 segments, which use the same filter model (D59).
 */
export function FilterBar(props: {
  readonly fields: ReadonlyArray<FilterFieldInfo>
  readonly filter: Filter
  readonly onChange: (filter: Filter) => void
  /** The companies to choose from for a contact's Company condition. */
  readonly companies?: ReadonlyArray<ValueOption>
}) {
  const [editing, setEditing] = useState<number | "new">()
  const { filter } = props
  const update = (conditions: ReadonlyArray<FilterCondition>) => props.onChange({ ...filter, conditions })

  return (
    <div className="fbar">
      {filter.conditions.map((condition, index) => {
        const info = props.fields.find((field) => field.field === condition.field)
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: conditions are positional
          <span key={index} className="fchip-wrap">
            {index > 0 ? <span className="fjoin sm-t">{filter.match === "all" ? "and" : "or"}</span> : null}
            <span className={`fchip sm-t ${checkCondition(condition, props.fields) ? "bad" : ""}`}>
              <button className="fchip-b" type="button" onClick={() => setEditing(index)}>
                <b>{info?.label ?? "Unknown field"}</b> {OPERATOR_LABELS[condition.operator]}{" "}
                {describeValue(condition, info, props.companies)}
              </button>
              <button
                className="fchip-x"
                type="button"
                aria-label={`Remove filter on ${info?.label ?? "field"}`}
                onClick={() => update(filter.conditions.filter((_, other) => other !== index))}
              >
                <CloseIcon className="size-3" />
              </button>
            </span>
            {editing === index && info ? (
              <ConditionEditor
                fields={props.fields}
                initial={condition}
                companies={props.companies ?? []}
                onClose={() => setEditing(undefined)}
                onSave={(next) => {
                  update(filter.conditions.map((other, at) => (at === index ? next : other)))
                  setEditing(undefined)
                }}
              />
            ) : null}
          </span>
        )
      })}
      <span className="fchip-wrap">
        <button className="btn ghost sm" type="button" onClick={() => setEditing("new")}>
          <PlusIcon className="size-3.5" />
          Filter
        </button>
        {editing === "new" ? (
          <ConditionEditor
            fields={props.fields}
            initial={undefined}
            companies={props.companies ?? []}
            onClose={() => setEditing(undefined)}
            onSave={(next) => {
              update([...filter.conditions, next])
              setEditing(undefined)
            }}
          />
        ) : null}
      </span>
      {filter.conditions.length > 1 ? (
        <button
          className="btn ghost sm"
          type="button"
          title="Whether every condition must hold, or any one"
          onClick={() => props.onChange({ ...filter, match: filter.match === "all" ? "any" : "all" })}
        >
          Match {filter.match === "all" ? "all" : "any"}
        </button>
      ) : null}
    </div>
  )
}

const describeValue = (
  condition: FilterCondition,
  info: FilterFieldInfo | undefined,
  companies: ReadonlyArray<ValueOption> | undefined,
): string => {
  if (VALUELESS.has(condition.operator)) return ""
  const value = condition.value
  if (condition.operator === "in-last-days") return `${value} days`
  if (Array.isArray(value)) {
    const options: ReadonlyArray<ValueOption> = info?.options ?? companies ?? []
    return value.map((id) => options.find((option) => option.id === id)?.label ?? "?").join(", ")
  }
  return String(value ?? "")
}

const defaultValue = (info: FilterFieldInfo, operator: FilterOperator): FilterValue | undefined => {
  if (VALUELESS.has(operator)) return undefined
  if (operator === "in-last-days") return 7
  if (info.kind === "number") return 0
  if (info.kind === "select" || info.kind === "multi" || info.kind === "company") return []
  if (info.kind === "date") return new Date().toISOString().slice(0, 10)
  return ""
}

/** A popover to pick a field, a comparison and a value. */
function ConditionEditor(props: {
  readonly fields: ReadonlyArray<FilterFieldInfo>
  readonly initial: FilterCondition | undefined
  readonly companies: ReadonlyArray<ValueOption>
  readonly onSave: (condition: FilterCondition) => void
  readonly onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [field, setField] = useState(props.initial?.field ?? props.fields[0]?.field ?? "")
  const info = props.fields.find((entry) => entry.field === field)
  const operators = info ? OPERATORS_BY_KIND[info.kind] : []
  const [operator, setOperator] = useState<FilterOperator>(props.initial?.operator ?? operators[0] ?? "contains")
  const [value, setValue] = useState<FilterValue | undefined>(props.initial?.value)
  const { onClose } = props

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener("pointerdown", onPointer)
    return () => document.removeEventListener("pointerdown", onPointer)
  }, [onClose])

  const condition: FilterCondition = {
    field,
    operator,
    ...(value !== undefined && !VALUELESS.has(operator) ? { value } : {}),
  }
  const problem = checkCondition(condition, props.fields)
  const options: ReadonlyArray<ValueOption> = info?.kind === "company" ? props.companies : (info?.options ?? [])

  return (
    <div
      className="pop fpop"
      role="dialog"
      aria-label="Filter"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          onClose()
        }
        if (event.key === "Enter" && !problem && (event.target as HTMLElement).tagName !== "BUTTON")
          props.onSave(condition)
      }}
    >
      <div className="fpop-b">
        <select
          className="fsel"
          aria-label="Field"
          value={field}
          onChange={(event) => {
            const next = props.fields.find((entry) => entry.field === event.target.value)
            if (!next) return
            const nextOperator = OPERATORS_BY_KIND[next.kind][0] ?? "contains"
            setField(next.field)
            setOperator(nextOperator)
            setValue(defaultValue(next, nextOperator))
          }}
        >
          {props.fields.map((entry) => (
            <option key={entry.field} value={entry.field}>
              {entry.label}
            </option>
          ))}
        </select>
        <select
          className="fsel"
          aria-label="Comparison"
          value={operator}
          onChange={(event) => {
            const next = event.target.value as FilterOperator
            setOperator(next)
            if (info && (next === "in-last-days" || operator === "in-last-days" || VALUELESS.has(operator))) {
              setValue(defaultValue(info, next))
            }
          }}
        >
          {operators.map((entry) => (
            <option key={entry} value={entry}>
              {OPERATOR_LABELS[entry]}
            </option>
          ))}
        </select>
        {!info || VALUELESS.has(operator) ? null : options.length > 0 ||
          info.kind === "select" ||
          info.kind === "multi" ||
          info.kind === "company" ? (
          <div className="fopts">
            {options.length === 0 ? <p className="hint sm-t">Nothing to choose from.</p> : null}
            {options.map((option) => {
              const chosen = Array.isArray(value) && value.includes(option.id)
              return (
                <label key={option.id} className="opt">
                  <input
                    className="cb shown"
                    type="checkbox"
                    checked={chosen}
                    onChange={() => {
                      const current = Array.isArray(value) ? value : []
                      setValue(chosen ? current.filter((id) => id !== option.id) : [...current, option.id])
                    }}
                  />
                  {option.label}
                </label>
              )
            })}
          </div>
        ) : operator === "in-last-days" || info.kind === "number" ? (
          <input
            className="inp"
            type="number"
            aria-label="Value"
            step="any"
            // biome-ignore lint/a11y/noAutofocus: the person is about to type the value
            autoFocus
            value={typeof value === "number" ? value : ""}
            onChange={(event) => setValue(event.target.value === "" ? undefined : Number(event.target.value))}
          />
        ) : info.kind === "date" ? (
          <input
            className="inp"
            type="date"
            aria-label="Value"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : (
          <input
            className="inp"
            type="text"
            aria-label="Value"
            // biome-ignore lint/a11y/noAutofocus: the person is about to type the value
            autoFocus
            value={typeof value === "string" ? value : ""}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </div>
      <div className="dlg-f">
        <button className="btn ghost sm" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary sm"
          type="button"
          disabled={problem !== undefined}
          onClick={() => props.onSave(condition)}
        >
          {props.initial ? "Update" : "Add filter"}
        </button>
      </div>
    </div>
  )
}
