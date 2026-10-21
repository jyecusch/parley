import { cn } from "cn"
import type * as React from "react"
import { Label } from "@/components/ui/label"

/*
 * Form field parts, styled as Parley's (D80): a field is a label, its control, then a hint or an
 * error, 6px apart; a set is a group of related controls under a legend.
 */

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn("m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0", className)}
      {...props}
    />
  )
}

function FieldLegend({ className, ...props }: React.ComponentProps<"legend">) {
  return <legend data-slot="field-legend" className={cn("mb-0.5 p-0 font-medium", className)} {...props} />
}

function Field({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field" className={cn("flex min-w-0 flex-col gap-1.5", className)} {...props} />
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={cn("font-medium", className)} {...props} />
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn("m-0 text-sm text-subtle", className)} {...props} />
}

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return <p role="alert" data-slot="field-error" className={cn("m-0 text-sm text-danger", className)} {...props} />
}

export { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet }
