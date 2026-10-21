import { cn } from "./cn.ts"
import { ToggleGroup, ToggleGroupItem } from "./toggle-group.tsx"

/**
 * A choice between a few options shown side by side, such as Contacts / Companies. `name` is kept
 * for callers but unused: toggle buttons aren't submitted with a form.
 */
export function SegmentedControl<T extends string>({
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
    <ToggleGroup<T>
      aria-label={label}
      value={[value]}
      // One option is always chosen: pressing the chosen one again leaves it chosen.
      onValueChange={([next]) => {
        if (next !== undefined) onChange(next)
      }}
      className={cn(className)}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
