import { cn } from "cn"
import type * as React from "react"
import { boxedControlClass } from "@/components/ui/input"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(boxedControlClass, "resize-y px-3 py-2 leading-6", className)}
      {...props}
    />
  )
}

export { Textarea }
