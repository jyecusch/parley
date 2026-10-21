import type { ComponentProps } from "react"
import { cn } from "./cn.ts"

/**
 * A loading placeholder, in Parley's look (D80): a shimmering bar. A `<span>`, so it can sit
 * inside a button or a line of text.
 */
function Skeleton({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      className={cn(
        "block h-2.5 animate-shimmer rounded-sm bg-[linear-gradient(90deg,var(--color-skeleton)_0%,var(--color-skeleton-hi)_50%,var(--color-skeleton)_100%)] bg-size-[200%_100%] motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
