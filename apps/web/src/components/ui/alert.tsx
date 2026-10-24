import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"
import { cn } from "./cn.ts"

/** A highlighted message, in Parley's look (D80): information, a warning, a problem or a success. */
const alertVariants = cva("flex items-start gap-3 rounded-lg px-3.5 py-3 leading-6", {
  variants: {
    tone: {
      info: "bg-fill text-muted",
      warn: "bg-warn-soft text-fg",
      danger: "bg-danger-soft text-fg",
      ok: "bg-ok-soft text-fg",
    },
  },
  defaultVariants: {
    tone: "info",
  },
})

/** The icon's color, by tone. */
const alertIconVariants = cva("mt-0.5 shrink-0", {
  variants: {
    tone: { info: "text-subtle", warn: "text-warn", danger: "text-danger", ok: "text-ok" },
  },
  defaultVariants: {
    tone: "info",
  },
})

/** Only a problem is announced as an alert; other tones are read in place. */
function Alert({ className, tone, ...props }: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={tone === "danger" ? "alert" : undefined}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    />
  )
}

function AlertIcon({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof alertIconVariants>) {
  return <span data-slot="alert-icon" className={cn(alertIconVariants({ tone }), className)} {...props} />
}

function AlertTitle({ className, ...props }: ComponentProps<"b">) {
  return <b data-slot="alert-title" className={cn("mb-0.5 block font-semibold", className)} {...props} />
}

function AlertDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="alert-description" className={cn("m-0 text-muted", className)} {...props} />
}

export { Alert, AlertDescription, AlertIcon, AlertTitle }
