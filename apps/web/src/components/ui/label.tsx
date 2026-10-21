import { cn } from "cn"
import type * as React from "react"

/** A label, unstyled: each use sets its look (Parley's labels differ by place). */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor or put the control inside
  return <label data-slot="label" className={cn(className)} {...props} />
}

export { Label }
