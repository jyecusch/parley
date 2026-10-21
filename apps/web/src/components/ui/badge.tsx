import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "./cn.ts"

/** Parley's tags (D80), as shadcn's badge variants. */
const badgeVariants = cva("inline-flex h-6 items-center", {
  variants: {
    variant: {
      /** A short status in a rounded pill: Draft, Sent, Verified. */
      neutral: "shrink-0 rounded-full bg-fill px-2.5 text-sm whitespace-nowrap text-muted",
      strong: "shrink-0 rounded-full bg-primary px-2.5 text-sm whitespace-nowrap text-on-primary",
      danger: "shrink-0 rounded-full bg-danger-soft px-2.5 text-sm whitespace-nowrap text-danger",
      /** A value shown as a chip, such as a multi-select option. */
      chip: "rounded-md bg-fill px-2 text-fg",
      /** A permission or code-like tag, in mono. */
      code: "rounded-sm bg-fill px-1.5 font-mono text-xs font-medium text-muted",
      /** A quiet outlined tag, such as "Revoked" or "You". */
      outline: "rounded-sm px-1.5 text-xs text-subtle inset-ring inset-ring-line-strong",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
})

function Badge({
  className,
  variant = "neutral",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ className: cn(badgeVariants({ variant }), className) }, props),
    render,
    state: { slot: "badge", variant },
  })
}

export { Badge, badgeVariants }
