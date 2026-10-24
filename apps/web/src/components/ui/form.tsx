import {
  createContext,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useContext,
  useId,
  useState,
} from "react"
import { Checkbox as CheckboxBase } from "./checkbox.tsx"
import { cn } from "./cn.ts"
import {
  FieldDescription,
  FieldError,
  FieldLegend,
  Field as FieldRoot,
  FieldSet,
  FieldLabel as FieldTitle,
} from "./field.tsx"
import { InfoTip } from "./info-tip.tsx"
import { Input as InputBase } from "./input.tsx"
import { Label } from "./label.tsx"
import { NativeSelect } from "./native-select.tsx"
import { RadioGroup, RadioGroupItem } from "./radio-group.tsx"
import { Slider as SliderBase } from "./slider.tsx"
import { Textarea as TextareaBase } from "./textarea.tsx"

/*
 * Parley's form controls (D80), built on shadcn's (D139): the same props and look as before, with
 * Base UI's behaviour and accessibility underneath.
 */

type InputProps = InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> | undefined }

/** A text box with an outline, for forms and dialogs. */
export function Input(props: InputProps) {
  return <InputBase variant="boxed" {...props} />
}

/** A small outlined text box, for editing inside a row (such as a title). */
export function SmallInput(props: InputProps) {
  return <InputBase variant="small" {...props} />
}

export function Textarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> | undefined },
) {
  return <TextareaBase {...props} />
}

/**
 * A text box that looks like plain text until hovered or focused: how record panels edit a value
 * in place.
 */
export function InlineInput(props: InputProps) {
  return <InputBase variant="inline" {...props} />
}

/** A filter-style text box on a tinted background, like "Filter by name or email". */
export function SearchInput(props: InputProps) {
  return <InputBase variant="search" {...props} />
}

/**
 * A dropdown: the browser's own `<select>`. `variant="inline"` looks like plain text until hovered
 * (record panels); `leading` puts something before the value, such as a team's logo.
 */
export function Select(
  props: SelectHTMLAttributes<HTMLSelectElement> & { variant?: "boxed" | "inline" | undefined; leading?: ReactNode },
) {
  return <NativeSelect {...props} />
}

/** What a checkbox's `onChange` gets: the new state, where a native checkbox's event had it. */
export type CheckboxChange = { readonly target: { readonly checked: boolean } }

/**
 * A checkbox. `reveal` hides it until its row (`group/row`) is hovered, it's focused, or it's
 * checked: how table rows show selection. `mixed` is the "some selected" state.
 */
export function Checkbox({
  reveal,
  mixed,
  onChange,
  className,
  ...props
}: {
  checked?: boolean | undefined
  disabled?: boolean | undefined
  id?: string | undefined
  name?: string | undefined
  className?: string | undefined
  "aria-label"?: string | undefined
  autoFocus?: boolean | undefined
  reveal?: boolean | undefined
  mixed?: boolean | undefined
  onChange?: ((change: CheckboxChange) => void) | undefined
}) {
  return (
    <CheckboxBase
      indeterminate={mixed ?? false}
      onCheckedChange={(checked) => onChange?.({ target: { checked } })}
      className={cn(
        reveal &&
          "opacity-0 group-hover/row:opacity-100 group-hover/table:opacity-100 focus-visible:opacity-100 data-checked:opacity-100 data-indeterminate:opacity-100",
        className,
      )}
      {...props}
    />
  )
}

/** The radio group RadioCards are in, when they're given one (see RadioCards). */
const InRadioCards = createContext(false)

/**
 * Radio cards that make one choice: arrow keys move between them and screen readers count them.
 * Give each RadioCard a `value`.
 */
export function RadioCards<Value extends string>(props: {
  name?: string | undefined
  value: Value
  onChange: (value: Value) => void
  children: ReactNode
  className?: string | undefined
}) {
  return (
    <RadioGroup
      name={props.name}
      value={props.value}
      onValueChange={(value) => props.onChange(value as Value)}
      className={cn("flex flex-col gap-1.5", props.className)}
    >
      <InRadioCards.Provider value={true}>{props.children}</InRadioCards.Provider>
    </RadioGroup>
  )
}

type RadioProps = {
  /** Its value in RadioCards. */
  value?: string | undefined
  /** Outside RadioCards: whether it's chosen, and what choosing it does. */
  checked?: boolean | undefined
  onChange?: (() => void) | undefined
  name?: string | undefined
  disabled?: boolean | undefined
  className?: string | undefined
}

/** A radio. Outside RadioCards it stands alone, chosen by `checked`. */
export function Radio({ value, checked, onChange, name, className, disabled }: RadioProps) {
  const item = <RadioGroupItem value={value ?? "on"} disabled={disabled} className={className} />
  if (useContext(InRadioCards)) return item
  return (
    <RadioGroup
      name={name}
      value={checked ? "on" : ""}
      onValueChange={() => onChange?.()}
      render={<span />}
      className="flex shrink-0"
    >
      {item}
    </RadioGroup>
  )
}

/** A choice as a bordered card: radio, title and a line of description. */
export function RadioCard({
  label,
  description,
  children,
  className,
  ...props
}: RadioProps & {
  label: ReactNode
  description?: ReactNode | undefined
  children?: ReactNode
}) {
  return (
    <Label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 inset-ring inset-ring-line-strong hover:bg-hover has-data-checked:inset-ring-muted",
        className,
      )}
    >
      <Radio {...props} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2.5 font-medium">{label}</span>
        {description ? <span className="text-sm text-muted">{description}</span> : null}
        {children}
      </span>
    </Label>
  )
}

/** A checkbox or radio with its label, in a list of options. */
export function Option({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <Label className={cn("flex min-h-8 cursor-pointer items-center gap-2.5", className)} {...props} />
}

/** A labelled form field: label, control, then a hint or an error. */
export function Field({
  label,
  htmlFor,
  hint,
  info,
  error,
  children,
  className,
}: {
  label?: ReactNode | undefined
  htmlFor?: string | undefined
  hint?: ReactNode | undefined
  /** An explanation behind an info tip beside the label (D155), in place of a hint under it. */
  info?: ReactNode | undefined
  error?: ReactNode | undefined
  children: ReactNode
  className?: string | undefined
}) {
  const title = label ? <FieldTitle htmlFor={htmlFor}>{label}</FieldTitle> : null
  return (
    <FieldRoot className={className}>
      {title && info ? (
        <span className="flex items-center gap-1">
          {title}
          <InfoTip label={typeof label === "string" ? label.toLowerCase() : "this"}>{info}</InfoTip>
        </span>
      ) : (
        title
      )}
      {children}
      {error ? <FieldError>{error}</FieldError> : hint ? <Hint>{hint}</Hint> : null}
    </FieldRoot>
  )
}

/** A group of related controls with a heading, such as a set of checkboxes. */
export function Fieldset({
  legend,
  info,
  section,
  children,
  className,
}: {
  legend: ReactNode
  /** An explanation behind an info tip beside the heading (D155). */
  info?: ReactNode | undefined
  /** A heading over labeled fields: quieter than their labels, so the two don't read as a double header. */
  section?: boolean | undefined
  children: ReactNode
  className?: string
}) {
  return (
    <FieldSet className={className}>
      <FieldLegend className={cn(info && "flex items-center gap-1", section && "text-sm font-normal text-muted")}>
        {legend}
        {info ? <InfoTip label={typeof legend === "string" ? legend.toLowerCase() : "this"}>{info}</InfoTip> : null}
      </FieldLegend>
      {children}
    </FieldSet>
  )
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <FieldDescription className={className}>{children}</FieldDescription>
}

export function ErrorText({ children, className }: { children: ReactNode; className?: string }) {
  return <FieldError className={className}>{children}</FieldError>
}

/** A small label above a field, as on the sign-in form. */
export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <Label className={cn("block pb-1.5 text-sm text-subtle", className)} {...props} />
}

/** A slider with its label and current value, such as a strength from 0 to 100%. */
export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  format = (n) => `${Math.round(n * 100)}%`,
  onChange,
  className,
  labelClassName,
}: {
  label: ReactNode
  value: number
  min?: number | undefined
  max?: number | undefined
  step?: number | undefined
  format?: ((value: number) => string) | undefined
  onChange: (value: number) => void
  className?: string | undefined
  /** The label's width; a wide one by default, so a stack of sliders lines up. */
  labelClassName?: string | undefined
}) {
  const id = useId()
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span id={id} className={cn("w-48 shrink-0 text-muted", labelClassName)}>
        {label}
      </span>
      <SliderBase
        className="min-w-0 flex-1"
        aria-labelledby={id}
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(next) => onChange(next)}
      />
      <output className="w-14 shrink-0 text-right text-sm text-subtle tabular-nums">{format(value)}</output>
    </div>
  )
}

/**
 * Choosing a file: a dashed area that reads as a button, with the chosen file's name. Click it,
 * focus it and press Enter or Space, or drop a file on it. The file input itself is visually hidden.
 */
export function FilePicker({
  id,
  accept,
  fileName,
  prompt,
  onFile,
  className,
}: {
  id: string
  accept?: string | undefined
  fileName?: string | undefined
  prompt: string
  onFile: (file: File) => void
  className?: string | undefined
}) {
  const [over, setOver] = useState(false)
  return (
    <Label
      htmlFor={id}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const file = event.dataTransfer.files[0]
        if (file) onFile(file)
      }}
      className={cn(
        "flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-control px-4 py-3 text-center transition-colors hover:bg-hover has-focus-visible:outline-2 has-focus-visible:outline-focus motion-reduce:transition-none",
        over && "border-focus bg-hover",
        className,
      )}
    >
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          // Choosing the same file again should still read it.
          event.target.value = ""
        }}
      />
      {fileName ? (
        <>
          <span className="max-w-full truncate font-medium">{fileName}</span>
          <span className="text-sm text-subtle">Choose a different file, or drop one here</span>
        </>
      ) : (
        <>
          <span className="font-medium">{prompt}</span>
          <span className="text-sm text-subtle">or drop it here</span>
        </>
      )}
    </Label>
  )
}
