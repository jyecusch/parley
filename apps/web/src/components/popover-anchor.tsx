import { cn } from "./ui/index.ts"
import { PopoverTrigger } from "./ui/popover.tsx"

/**
 * A zero-size point a popover hangs from, placed with classes relative to the positioned element
 * around it, so a popover opens exactly where it always has. The visible button that opens it
 * stays a plain button; pass it to PopoverContent's `finalFocus` so focus returns there.
 */
export function PopoverAnchor(props: { readonly className: string }) {
  return (
    <PopoverTrigger
      nativeButton={false}
      tabIndex={-1}
      aria-hidden
      render={<span className={cn("pointer-events-none absolute size-0", props.className)} />}
    />
  )
}
