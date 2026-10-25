import type { ReactNode } from "react"
import { InfoIcon } from "../icons.tsx"
import { cn } from "./cn.ts"
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx"

/**
 * An info tip: a small (i) button beside a label whose explanation opens on hover or click (Enter
 * or Space from the keyboard), so a setting's details are a glance away without crowding the screen. Built on the popover, not
 * the tooltip, because it holds a few lines and must open by click on touch screens.
 */
export function InfoTip(props: { readonly label: string; readonly children: ReactNode; readonly className?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={`About ${props.label}`}
        className={cn(
          "inline-flex size-5 shrink-0 -translate-y-px items-center justify-center rounded text-muted hover:bg-hover hover:text-fg focus-visible:text-fg data-popup-open:bg-active data-popup-open:text-fg",
          props.className,
        )}
      >
        {/* A heavier stroke than at full size, so it stays crisp this small. */}
        <InfoIcon className="size-4" strokeWidth={2} />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={6}
        className="w-auto max-w-65 rounded-lg px-3 py-2.5 text-sm leading-normal text-fg"
      >
        {props.children}
      </PopoverContent>
    </Popover>
  )
}
