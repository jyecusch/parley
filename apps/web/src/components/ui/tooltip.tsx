import type { ReactNode } from "react"
import { cn } from "./cn.ts"

export type TooltipSide = "bottom" | "right"

const SIDES: Readonly<Record<TooltipSide, string>> = {
  bottom: "top-full left-1/2 mt-1.5 -translate-x-1/2",
  right: "top-1/2 left-full ml-2 -translate-y-1/2",
}

/** A label shown after a short hover. `disabled` hides it, such as in an expanded sidebar. */
export function Tooltip({
  text,
  side = "bottom",
  disabled,
  children,
  className,
}: {
  text: string
  side?: TooltipSide | undefined
  disabled?: boolean | undefined
  children: ReactNode
  className?: string | undefined
}) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      {disabled ? null : (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-30 h-7 rounded-md bg-raised px-2.5 text-sm leading-7 font-normal whitespace-pre text-fg opacity-0 shadow-pop transition-opacity group-hover/tip:opacity-100 group-hover/tip:delay-400 motion-reduce:transition-none",
            SIDES[side],
          )}
        >
          {text}
        </span>
      )}
    </span>
  )
}
