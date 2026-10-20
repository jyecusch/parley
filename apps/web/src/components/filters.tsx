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
import { Button, Checkbox, cn, Hint, Input, Option, Popover, Select } from "./ui/index.ts"

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
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {filter.conditions.map((condition, index) => {
        const info = props.fields.find((field) => field.field === condition.field)
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: conditions are positional
          <span key={index} className="relative inline-flex items-center gap-1">
            {index > 0 ? <span className="text-sm text-subtle">{filter.match === "all" ? "and" : "or"}</span> : null}
            <span
              className={cn(
                "inline-flex h-7 max-w-96 items-center rounded-md bg-fill text-sm",
                checkCondition(condition, props.fields) && "inset-ring inset-ring-danger",
              )}
            >
              <button
                className="h-7 cursor-pointer truncate pr-1 pl-2.5 text-muted"
                type="button"
                onClick={() => setEditing(index)}
              >
                <b className="font-medium text-fg">{info?.label ?? "Unknown field"}</b>{" "}
                {OPERATOR_LABELS[condition.operator]} {describeValue(condition, info, props.companies)}
              </button>
              <button
                className="grid h-7 w-6 shrink-0 cursor-pointer place-items-center rounded-r-md text-subtle hover:bg-hover hover:text-fg"
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
      <span className="relative inline-flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setEditing("new")}>
          <PlusIcon className="size-3.5" />
          Filter
        </Button>
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
        <Button
          variant="ghost"
          size="sm"
          title="Whether every condition must hold, or any one"
          onClick={() => props.onChange({ ...filter, match: filter.match === "all" ? "any" : "all" })}
        >
          Match {filter.match === "all" ? "all" : "any"}
        </Button>
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
    <Popover
      className="top-full left-0 mt-1.5 w-80 max-w-none"
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
      <div className="flex flex-col gap-2.5 p-3">
        <Select
          className="h-9"
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
        </Select>
        <Select
          className="h-9"
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
        </Select>
        {!info || VALUELESS.has(operator) ? null : options.length > 0 ||
          info.kind === "select" ||
          info.kind === "multi" ||
          info.kind === "company" ? (
          <div className="max-h-60 overflow-auto">
            {options.length === 0 ? <Hint>Nothing to choose from.</Hint> : null}
            {options.map((option) => {
              const chosen = Array.isArray(value) && value.includes(option.id)
              return (
                <Option key={option.id}>
                  <Checkbox
                    checked={chosen}
                    onChange={() => {
                      const current = Array.isArray(value) ? value : []
                      setValue(chosen ? current.filter((id) => id !== option.id) : [...current, option.id])
                    }}
                  />
                  {option.label}
                </Option>
              )
            })}
          </div>
        ) : operator === "in-last-days" || info.kind === "number" ? (
          <Input
            className="h-9"
            type="number"
            aria-label="Value"
            step="any"
            autoFocus
            value={typeof value === "number" ? value : ""}
            onChange={(event) => setValue(event.target.value === "" ? undefined : Number(event.target.value))}
          />
        ) : info.kind === "date" ? (
          <Input
            className="h-9"
            type="date"
            aria-label="Value"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : (
          <Input
            className="h-9"
            type="text"
            aria-label="Value"
            autoFocus
            value={typeof value === "string" ? value : ""}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={problem !== undefined} onClick={() => props.onSave(condition)}>
          {props.initial ? "Update" : "Add filter"}
        </Button>
      </div>
    </Popover>
  )
}
