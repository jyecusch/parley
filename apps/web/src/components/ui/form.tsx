import {
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { ChevronDown } from "../icons.tsx"
import { cn } from "./cn.ts"

const BOXED =
  "w-full rounded-md bg-transparent text-fg inset-ring inset-ring-control focus:outline-none focus:inset-ring-muted aria-invalid:inset-ring-danger disabled:opacity-60"

/** A text box with an outline, for forms and dialogs. */
export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> | undefined }) {
  return <input className={cn(BOXED, "h-10 px-3", className)} {...props} />
}

/** A small outlined text box, for editing inside a row (such as a title). */
export function SmallInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> | undefined }) {
  return <input className={cn(BOXED, "h-7 bg-surface px-2 text-sm", className)} {...props} />
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> | undefined }) {
  return <textarea className={cn(BOXED, "resize-y px-3 py-2 leading-6", className)} {...props} />
}

/**
 * A text box that looks like plain text until hovered or focused: how record panels edit a value
 * in place.
 */
export function InlineInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> | undefined }) {
  return (
    <input
      className={cn(
        "-mx-1.5 h-8 w-full rounded-md bg-transparent px-1.5 text-fg hover:bg-hover focus:bg-transparent focus:inset-ring focus:inset-ring-control focus:outline-none aria-invalid:inset-ring aria-invalid:inset-ring-danger",
        className,
      )}
      {...props}
    />
  )
}

/** A filter-style text box on a tinted background, like "Filter by name or email". */
export function SearchInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> | undefined }) {
  return (
    <input
      className={cn(
        "ml-2 h-8 w-72 rounded-md bg-fill px-2.5 text-sm text-fg focus:inset-ring focus:inset-ring-control focus:outline-none",
        className,
      )}
      {...props}
    />
  )
}

/**
 * A dropdown. `variant="inline"` looks like plain text until hovered (record panels);
 * `leading` puts something before the value, such as a team's logo.
 */
export function Select({
  variant = "boxed",
  leading,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { variant?: "boxed" | "inline" | undefined; leading?: ReactNode }) {
  if (variant === "inline") {
    return (
      <select
        className={cn(
          "-mx-1.5 h-8 w-full cursor-pointer appearance-none rounded-md bg-transparent px-1.5 text-fg hover:bg-hover",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    )
  }
  return (
    <div className="relative">
      {leading ? <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">{leading}</span> : null}
      <select
        className={cn(BOXED, "h-10 cursor-pointer appearance-none pr-9 pl-3", leading && "pl-11", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-subtle" />
    </div>
  )
}

/**
 * A checkbox. `reveal` hides it until its row (`group/row`) is hovered, it's focused, or it's
 * checked: how table rows show selection. `mixed` is the "some selected" state.
 */
export function Checkbox({
  reveal,
  mixed,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { reveal?: boolean | undefined; mixed?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed ?? false
  }, [mixed])
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "m-0 grid size-4 shrink-0 cursor-pointer appearance-none place-items-center rounded align-middle inset-ring inset-ring-control transition-opacity motion-reduce:transition-none",
        "after:h-2 after:w-1 after:-translate-y-px after:rotate-45 after:border-r-2 after:border-b-2 after:border-on-primary after:opacity-0 after:content-['']",
        "checked:bg-primary checked:inset-ring-0 checked:after:opacity-100",
        "indeterminate:bg-primary indeterminate:inset-ring-0 indeterminate:after:h-0.5 indeterminate:after:w-2 indeterminate:after:translate-y-0 indeterminate:after:rotate-0 indeterminate:after:rounded-full indeterminate:after:border-0 indeterminate:after:bg-on-primary indeterminate:after:opacity-100",
        "disabled:cursor-default disabled:opacity-40",
        reveal &&
          "opacity-0 group-hover/row:opacity-100 group-hover/table:opacity-100 checked:opacity-100 indeterminate:opacity-100 focus-visible:opacity-100",
        className,
      )}
      {...props}
    />
  )
}

export function Radio({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="radio"
      className={cn(
        "m-0 mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-full inset-ring inset-ring-control checked:inset-ring-4 checked:inset-ring-primary",
        className,
      )}
      {...props}
    />
  )
}

/** A choice as a bordered card: radio, title and a line of description. */
export function RadioCard({
  label,
  description,
  children,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode
  description?: ReactNode | undefined
  children?: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the radio is rendered inside the label
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 inset-ring inset-ring-line-strong hover:bg-hover has-checked:inset-ring-muted",
        className,
      )}
    >
      <Radio {...props} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2.5 font-medium">{label}</span>
        {description ? <span className="text-sm text-muted">{description}</span> : null}
        {children}
      </span>
    </label>
  )
}

/** A checkbox or radio with its label, in a list of options. */
export function Option({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as a child
  return <label className={cn("flex min-h-8 cursor-pointer items-center gap-2.5", className)} {...props} />
}

/** A labelled form field: label, control, then a hint or an error. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label?: ReactNode | undefined
  htmlFor?: string | undefined
  hint?: ReactNode | undefined
  error?: ReactNode | undefined
  children: ReactNode
  className?: string | undefined
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="font-medium">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <Hint>{hint}</Hint>
      ) : null}
    </div>
  )
}

/** A group of related controls with a heading, such as a set of checkboxes. */
export function Fieldset({
  legend,
  children,
  className,
}: {
  legend: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <fieldset className={cn("m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0", className)}>
      <legend className="mb-0.5 p-0 font-medium">{legend}</legend>
      {children}
    </fieldset>
  )
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("m-0 text-sm text-subtle", className)}>{children}</p>
}

export function ErrorText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("m-0 text-sm text-danger", className)} role="alert">
      {children}
    </p>
  )
}

/** A small label above a field, as on the sign-in form. */
export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is passed by the caller
  return <label className={cn("block pb-1.5 text-sm text-subtle", className)} {...props} />
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
}: {
  label: ReactNode
  value: number
  min?: number | undefined
  max?: number | undefined
  step?: number | undefined
  format?: ((value: number) => string) | undefined
  onChange: (value: number) => void
  className?: string | undefined
}) {
  const id = useId()
  return (
    <div className={cn("grid grid-cols-[12rem_minmax(0,1fr)_3.5rem] items-center gap-3", className)}>
      <label htmlFor={id} className="text-muted">
        {label}
      </label>
      <input
        id={id}
        type="range"
        className="h-5 w-full cursor-pointer accent-primary"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={id} className="text-right text-sm text-subtle tabular-nums">
        {format(value)}
      </output>
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
    <label
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
    </label>
  )
}
