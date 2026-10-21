import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"
import { cn } from "./cn.ts"

/** An empty or error state, in Parley's look (D80): an icon, a title, a sentence, and actions. */
function Empty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn("flex max-w-md flex-col items-center gap-2 text-center", className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva("mb-2 grid size-10 place-items-center rounded-md", {
  variants: {
    tone: {
      neutral: "bg-fill text-muted",
      danger: "bg-danger-soft text-danger",
      ok: "bg-ok-soft text-ok",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
})

function EmptyMedia({
  className,
  tone = "neutral",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return <div data-slot="empty-icon" className={cn(emptyMediaVariants({ tone }), className)} {...props} />
}

function EmptyTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 data-slot="empty-title" className={cn("m-0 text-lg font-semibold tracking-tight", className)} {...props} />
}

function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="empty-description" className={cn("m-0 text-pretty text-muted", className)} {...props} />
}

function EmptyContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="empty-content" className={cn("mt-3 flex flex-wrap justify-center gap-2", className)} {...props} />
  )
}

export { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle }
