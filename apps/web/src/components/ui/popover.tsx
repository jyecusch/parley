import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"
import type * as React from "react"
import { usePortalContainer } from "./portal-container.ts"

/*
 * shadcn's Popover (on Base UI), styled as Parley's (D80, D139): a raised panel, such as a picker
 * or a filter editor, with no animation. Base UI positions it, keeps it in the window, and closes
 * it on Escape and outside clicks. Popups render into the app's screen (portal-container.ts).
 */

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

/** The panel. It opens below its trigger, 4px away, lined up with its start; its width is capped by the window. */
function PopoverContent({
  className,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <PopoverPrimitive.Portal container={usePortalContainer()}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-12"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-raised shadow-pop outline-none",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="popover-header" className={cn("flex flex-col gap-0.5", className)} {...props} />
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title data-slot="popover-title" className={cn("m-0 font-medium", className)} {...props} />
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("m-0 text-subtle", className)}
      {...props}
    />
  )
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }
