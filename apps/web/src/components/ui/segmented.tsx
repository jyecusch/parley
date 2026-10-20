import { cn } from "./cn.ts"

/** A choice between a few options shown side by side, such as Contacts / Companies. */
export function SegmentedControl<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
  className,
}: {
  name: string
  label: string
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>
  value: T
  onChange: (value: T) => void
  className?: string | undefined
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex gap-0.5 self-start rounded-lg bg-fill p-0.5", className)}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="relative inline-flex h-8 cursor-pointer items-center rounded-md px-3.5 font-medium text-muted hover:text-fg has-checked:bg-surface has-checked:text-fg has-checked:shadow-card has-focus-visible:outline-2 has-focus-visible:outline-focus"
        >
          <input
            type="radio"
            name={name}
            className="absolute inset-0 m-0 cursor-pointer opacity-0"
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}
