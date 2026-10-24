import type { ComponentProps } from "react"
import { cn } from "./cn.ts"

/**
 * A loading placeholder, shadcn's: a pulsing bar. A `<span>`, so it can sit
 * inside a button or a line of text.
 */
function Skeleton({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      className={cn("block h-2.5 animate-pulse rounded-sm bg-skeleton-hi motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
