import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { CustomField, FORM_SET_FIELDS, FormContactField, FormContent, FormField } from "@parley/domain"
import { type ReactNode, useState } from "react"
import { fieldKey } from "../form-view.tsx"
import { CloseIcon, GripIcon, PlusIcon } from "../icons.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx"
import {
  Checkbox,
  cn,
  Field,
  Fieldset,
  IconButton,
  InfoTip,
  Input,
  Option,
  Select,
  Textarea,
  TextButton,
} from "../ui/index.ts"
import {
  CONTACT_FIELD_LABELS,
  type ContentChange,
  consentFields,
  inputFields,
  MoveButtons,
  setValueProblem,
} from "./shared.tsx"

/** Contact fields "Set on every submission" can fill, as import targets name them. */
const SET_TARGETS: ReadonlyArray<{ readonly key: (typeof FORM_SET_FIELDS)[number]; readonly label: string }> = [
  { key: "company", label: "Company" },
  { key: "title", label: "Job title" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
]

export function FieldsPanel(props: {
  readonly content: FormContent
  readonly customFields: ReadonlyArray<CustomField>
  readonly onChange: ContentChange
}) {
  const { content, onChange } = props
  const inputs = inputFields(content)
  const setInputs = (next: ReadonlyArray<FormField>) =>
    onChange((current) => ({ ...current, fields: [...next, ...consentFields(current)] }))
  const update = (index: number, change: Partial<FormField>) =>
    setInputs(inputs.map((field, i) => (i === index ? ({ ...field, ...change } as FormField) : field)))
  const move = (from: number, to: number) => {
    if (to < 0 || to >= inputs.length || from === to) return
    const next = [...inputs]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    setInputs(next)
  }
  const used = new Set(inputs.map(fieldKey))
  const contactOptions = (Object.keys(CONTACT_FIELD_LABELS) as Array<FormContactField>).filter(
    (field) => field !== "email" && !used.has(field),
  )
  const customOptions = props.customFields.filter((field) => !used.has(`custom:${field.id}`))

  return (
    <div className="flex flex-col gap-5">
      <Fieldset legend="Copy" section>
        <Field label="Title" htmlFor="form-title">
          <Input
            id="form-title"
            maxLength={120}
            value={content.title}
            onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Description" htmlFor="form-description">
          <Textarea
            id="form-description"
            rows={2}
            maxLength={500}
            value={content.description}
            onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Button" htmlFor="form-button">
            <Input
              id="form-button"
              maxLength={60}
              value={content.submitLabel}
              onChange={(event) => onChange((current) => ({ ...current, submitLabel: event.target.value }))}
            />
          </Field>
          <Field
            label="Fine print"
            htmlFor="form-fine-print"
            info="The line under the button. Your privacy policy link follows it, if the team has one (Settings → Forms)."
          >
            <Input
              id="form-fine-print"
              maxLength={300}
              value={content.finePrint}
              onChange={(event) => onChange((current) => ({ ...current, finePrint: event.target.value }))}
            />
          </Field>
        </div>
      </Fieldset>

      <Fieldset
        legend="Fields"
        section
        info="Every answer is saved to the contact. Consent boxes for topics are under Topics."
      >
        <SortableFields
          fields={inputs}
          customFields={props.customFields}
          onMove={move}
          onUpdate={update}
          onRemove={(index) => setInputs(inputs.filter((_, i) => i !== index))}
        />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <TextButton className="self-start">
                <PlusIcon className="size-3.5" />
                Add field
              </TextButton>
            }
          />
          <DropdownMenuContent className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Contact fields</DropdownMenuLabel>
              {contactOptions.map((field) => (
                <DropdownMenuItem
                  key={field}
                  onClick={() =>
                    setInputs([
                      ...inputs,
                      { kind: "contact", field, label: CONTACT_FIELD_LABELS[field], required: false },
                    ])
                  }
                >
                  {CONTACT_FIELD_LABELS[field]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {customOptions.length > 0 ? (
              <DropdownMenuGroup>
                <DropdownMenuLabel>Custom fields</DropdownMenuLabel>
                {customOptions.map((field) => (
                  <DropdownMenuItem
                    key={field.id}
                    onClick={() =>
                      setInputs([...inputs, { kind: "custom", fieldId: field.id, label: field.name, required: false }])
                    }
                  >
                    <span className="truncate">{field.name}</span>
                    <span className="ml-auto text-sm text-subtle">{field.type.replace("-", " ")}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </Fieldset>

      <Fieldset legend="Captured automatically" section>
        <div className="flex items-center gap-1">
          <Option>
            <Checkbox
              checked={content.captureTracking}
              onChange={(event) => onChange((current) => ({ ...current, captureTracking: event.target.checked }))}
            />
            Page and tracking parameters
          </Option>
          <InfoTip label="page and tracking parameters">
            The page the form is on and its UTM parameters, plus ad click IDs when the site passes them (Embed →
            Tracking). Each submission shows where it came from.
          </InfoTip>
        </div>
      </Fieldset>

      <SetOnEverySubmission content={content} customFields={props.customFields} onChange={onChange} />
    </div>
  )
}

/** Fixed values every submission gets (D144), such as Source = Launch page. */
function SetOnEverySubmission(props: {
  readonly content: FormContent
  readonly customFields: ReadonlyArray<CustomField>
  readonly onChange: ContentChange
}) {
  const entries = Object.entries(props.content.set)
  const targets = [
    ...SET_TARGETS,
    ...props.customFields.map((field) => ({ key: `custom:${field.id}`, label: field.name })),
  ]
  const write = (next: ReadonlyArray<readonly [string, string]>) =>
    props.onChange((current) => ({ ...current, set: Object.fromEntries(next) }))
  const free = targets.filter((target) => !(target.key in props.content.set))
  return (
    <Fieldset
      legend="Set on every submission"
      section
      info="Values every submission's contact gets, such as Source = Website footer. The visitor's own answer wins."
    >
      {entries.map(([key, value], index) => (
        <div key={key} className="flex items-center gap-2">
          <Select
            aria-label="Field"
            className="flex-1"
            value={key}
            onChange={(event) =>
              write(entries.map((entry, i) => (i === index ? ([event.target.value, entry[1]] as const) : entry)))
            }
          >
            {targets
              .filter((target) => target.key === key || !(target.key in props.content.set))
              .map((target) => (
                <option key={target.key} value={target.key}>
                  {target.label}
                </option>
              ))}
          </Select>
          <SetValueInput
            target={key}
            customField={props.customFields.find((field) => `custom:${field.id}` === key)}
            value={value}
            onChange={(next) => write(entries.map((entry, i) => (i === index ? ([entry[0], next] as const) : entry)))}
          />
          <IconButton size="xs" label="Remove" onClick={() => write(entries.filter((_, i) => i !== index))}>
            <CloseIcon className="size-4" />
          </IconButton>
        </div>
      ))}
      {free.length > 0 ? (
        <TextButton className="self-start" onClick={() => write([...entries, [free[0]?.key ?? "", ""] as const])}>
          <PlusIcon className="size-3.5" />
          Add value
        </TextButton>
      ) : null}
    </Fieldset>
  )
}

/** A fixed value's input, shaped by what it sets: a custom field's options, a number, a date, yes or no. */
function SetValueInput(props: {
  readonly target: string
  readonly customField: CustomField | undefined
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  const field = props.customField
  const common = { "aria-label": "Value", className: "flex-1" }
  if (field?.type === "single-select" || field?.type === "multi-select" || field?.type === "checkbox") {
    const options =
      field.type === "checkbox"
        ? [
            { id: "true", label: "Yes" },
            { id: "false", label: "No" },
          ]
        : field.options
    return (
      <Select {...common} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        <option value="" disabled>
          Choose…
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    )
  }
  return (
    <Input
      {...common}
      type={field?.type === "number" ? "number" : field?.type === "date" ? "date" : "text"}
      maxLength={500}
      value={props.value}
      aria-invalid={setValueProblem(props.target, props.value) ? true : undefined}
      onChange={(event) => props.onChange(event.target.value)}
    />
  )
}

/**
 * The fields as cards to reorder (dnd-kit): drag a card by its grip, focus the grip and use Space
 * and the arrow keys, or use its Move up and Move down buttons (no dragging needed). The dragged card follows the pointer, tilted, while a faded copy holds
 * its place. Email stays first: the form always asks it first (D144).
 */
function SortableFields(props: {
  readonly fields: ReadonlyArray<FormField>
  readonly customFields: ReadonlyArray<CustomField>
  readonly onMove: (from: number, to: number) => void
  readonly onUpdate: (index: number, change: Partial<FormField>) => void
  readonly onRemove: (index: number) => void
}) {
  const sensors = useSensors(
    // A few pixels of movement before a drag starts, so clicking the grip doesn't drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [active, setActive] = useState<string>()
  const keys = props.fields.map(fieldKey)
  const labelOf = (key: string | number) => props.fields.find((field) => fieldKey(field) === key)?.label ?? "Field"
  const [first, ...rest] = props.fields
  const activeIndex = active === undefined ? -1 : keys.indexOf(active)
  const activeField = activeIndex >= 0 ? props.fields[activeIndex] : undefined
  const card = (field: FormField, index: number, handle?: ReactNode) => (
    <FieldCard
      field={field}
      customFields={props.customFields}
      handle={handle}
      // Email stays first, so the others move among positions 1 and on.
      move={
        index === 0 ? undefined : { index: index - 1, count: rest.length, onMove: (to) => props.onMove(index, to + 1) }
      }
      onUpdate={(change) => props.onUpdate(index, change)}
      onRemove={() => props.onRemove(index)}
    />
  )
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setActive(String(event.active.id))}
      onDragCancel={() => setActive(undefined)}
      onDragEnd={(event) => {
        setActive(undefined)
        if (!event.over || event.active.id === event.over.id) return
        props.onMove(keys.indexOf(String(event.active.id)), keys.indexOf(String(event.over.id)))
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "To move a field, press Space, then the arrow keys, then Space again to drop it or Escape to cancel.",
        },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over ? `${labelOf(active.id)} is now at position ${keys.indexOf(String(over.id)) + 1}.` : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `${labelOf(active.id)} dropped at position ${keys.indexOf(String(over.id)) + 1}.`
              : `${labelOf(active.id)} dropped.`,
          onDragCancel: ({ active }) => `Moving ${labelOf(active.id)} canceled.`,
        },
      }}
    >
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {first ? <li>{card(first, 0)}</li> : null}
        <SortableContext items={keys.slice(1)} strategy={verticalListSortingStrategy}>
          {rest.map((field, offset) => (
            <SortableField key={fieldKey(field)} id={fieldKey(field)} label={field.label}>
              {(handle) => card(field, offset + 1, handle)}
            </SortableField>
          ))}
        </SortableContext>
      </ol>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeField ? (
          <div className="rotate-2 cursor-grabbing rounded-lg bg-raised shadow-pop motion-reduce:rotate-0">
            {card(activeField, activeIndex, <GripIcon className="size-4" />)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/** One reorderable field: the grip starts a drag; while dragging, the card stays as a faded slot. */
function SortableField(props: {
  readonly id: string
  readonly label: string
  readonly children: (handle: ReactNode) => ReactNode
}) {
  const sortable = useSortable({ id: props.id })
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={cn(sortable.isDragging && "opacity-35")}
    >
      {props.children(
        <IconButton
          size="xs"
          ref={sortable.setActivatorNodeRef}
          className="cursor-grab touch-none active:cursor-grabbing"
          label={`Drag ${props.label}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripIcon className="size-4" />
        </IconButton>,
      )}
    </li>
  )
}

/** A field's card: what it asks, its label and placeholder, and whether it's required. */
function FieldCard(props: {
  readonly field: FormField
  readonly customFields: ReadonlyArray<CustomField>
  /** The grip, for fields that can move; Email has none. */
  readonly handle?: ReactNode
  /** Its place among the fields that move, for Move up and Move down; Email has none. */
  readonly move?: { readonly index: number; readonly count: number; readonly onMove: (to: number) => void } | undefined
  readonly onUpdate: (change: Partial<FormField>) => void
  readonly onRemove: () => void
}) {
  const { field } = props
  const isEmail = field.kind === "contact" && field.field === "email"
  const custom = field.kind === "custom" ? props.customFields.find((entry) => entry.id === field.fieldId) : undefined
  const kindLabel = field.kind === "contact" ? CONTACT_FIELD_LABELS[field.field] : (custom?.name ?? "Custom field")
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-fill p-2.5">
      <div className="flex items-center gap-1.5">
        {props.handle}
        <span className={cn("min-w-0 truncate text-sm text-muted", !props.handle && "pl-1")}>{kindLabel}</span>
        {isEmail ? (
          <InfoTip label="why email is always asked">
            Every submission needs an email address: it's how Parley finds or creates the contact, and how it confirms
            the submission. So it's always asked first, and required.
          </InfoTip>
        ) : null}
        <span className="flex-1" />
        {props.move ? (
          <MoveButtons
            label={field.label}
            index={props.move.index}
            count={props.move.count}
            onMove={props.move.onMove}
          />
        ) : null}
        {isEmail ? null : (
          <IconButton size="xs" label={`Remove ${field.label}`} onClick={props.onRemove}>
            <CloseIcon className="size-4" />
          </IconButton>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label={`${kindLabel}: label`}
          placeholder="Label"
          maxLength={120}
          value={field.label}
          onChange={(event) => props.onUpdate({ label: event.target.value })}
        />
        <Input
          aria-label={`${kindLabel}: placeholder`}
          placeholder="Placeholder"
          maxLength={120}
          value={"placeholder" in field ? (field.placeholder ?? "") : ""}
          onChange={(event) =>
            props.onUpdate(event.target.value ? { placeholder: event.target.value } : { placeholder: undefined })
          }
        />
      </div>
      {isEmail ? null : (
        <Option>
          <Checkbox checked={field.required} onChange={(event) => props.onUpdate({ required: event.target.checked })} />
          Required
        </Option>
      )}
    </div>
  )
}
