import type { ComponentProps } from "react"
import { cn } from "./cn.ts"

/** A keyboard key or shortcut, in Parley's look (D80). Its colors come from where it sits. */
function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded px-1 font-mono text-xs leading-none font-medium [text-shadow:none]",
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
