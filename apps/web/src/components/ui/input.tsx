import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import type * as React from "react"

/** An outlined box: Parley's text boxes, text areas and dropdowns share it (D80). */
export const boxedControlClass =
  "w-full rounded-md bg-transparent text-fg inset-ring inset-ring-control focus:outline-none focus:inset-ring-muted aria-invalid:inset-ring-danger disabled:opacity-60"

const inputVariants = cva("", {
  variants: {
    variant: {
      /** For forms and dialogs. */
      boxed: `${boxedControlClass} h-10 px-3`,
      /** For editing inside a row, such as a title. */
      small: `${boxedControlClass} h-7 bg-surface px-2 text-sm`,
      /** Plain text until hovered or focused, as record panels edit a value in place. */
      inline:
        "-mx-1.5 h-8 w-full rounded-md bg-transparent px-1.5 text-fg hover:bg-hover focus:bg-transparent focus:inset-ring focus:inset-ring-control focus:outline-none aria-invalid:inset-ring aria-invalid:inset-ring-danger",
      /** On a tinted background, like "Filter by name or email". */
      search:
        "ml-2 h-8 w-72 rounded-md bg-fill px-2.5 text-sm text-fg focus:inset-ring focus:inset-ring-control focus:outline-none",
    },
  },
  defaultVariants: { variant: "boxed" },
})

function Input({
  className,
  type,
  variant,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive type={type} data-slot="input" className={cn(inputVariants({ variant }), className)} {...props} />
  )
}

export { Input, inputVariants }
