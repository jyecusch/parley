import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"
import type * as React from "react"
import { CloseIcon } from "../icons.tsx"
import { IconButton } from "./buttons.tsx"
import { usePortalContainer } from "./portal-container.ts"

/*
 * shadcn's Dialog (on Base UI), styled as Parley's (D80, D139): a raised panel near the top of the
 * window over a scrim, with no animation. Popups render into the app's screen (portal-container.ts).
 */

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" container={usePortalContainer()} {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-10 bg-scrim", className)}
      {...props}
    />
  )
}

/** The panel. `showCloseButton` puts a close button in its top-right corner, for dialogs without a DialogHeader. */
function DialogContent({
  className,
  children,
  showCloseButton = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed inset-x-4 top-1/9 z-11 mx-auto flex max-h-5/6 max-w-xl flex-col overflow-auto rounded-xl bg-raised shadow-pop outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <IconButton label="Close" className="absolute top-3 right-3">
                <CloseIcon />
              </IconButton>
            }
          />
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

/** The title row: the title, then anything after it, such as a close button. */
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex items-center gap-2 pt-4 pr-3 pb-1 pl-5", className)}
      {...props}
    />
  )
}

/** The dialog's content, between the header and the footer. */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-body" className={cn("flex flex-col gap-5 px-5 pt-2 pb-5", className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex justify-end gap-2 border-t border-line px-4 py-3", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("m-0 flex-1 text-lg font-semibold tracking-tight", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("m-0 text-muted", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
