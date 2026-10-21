import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "cn"

/**
 * A checkbox: a 16px box, filled when ticked, with the tick (or the mixed state's bar) drawn by
 * `::after`. It renders a native `<button>`, so `disabled:` and focus styles apply as on any control.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      nativeButton
      render={<button type="button" />}
      className={cn(
        "m-0 grid size-4 shrink-0 cursor-pointer appearance-none place-items-center rounded align-middle inset-ring inset-ring-control transition-opacity motion-reduce:transition-none",
        "after:h-2 after:w-1 after:-translate-y-px after:rotate-45 after:border-r-2 after:border-b-2 after:border-on-primary after:opacity-0 after:content-['']",
        "data-checked:bg-primary data-checked:inset-ring-0 data-checked:after:opacity-100",
        "data-indeterminate:bg-primary data-indeterminate:inset-ring-0 data-indeterminate:after:h-0.5 data-indeterminate:after:w-2 data-indeterminate:after:translate-y-0 data-indeterminate:after:rotate-0 data-indeterminate:after:rounded-full data-indeterminate:after:border-0 data-indeterminate:after:bg-on-primary data-indeterminate:after:opacity-100",
        "disabled:cursor-default disabled:opacity-40",
        className,
      )}
      {...props}
    />
  )
}

export { Checkbox }
