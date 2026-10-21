import type { HTMLAttributes, ReactNode } from "react"
import { toast } from "sonner"
import { CloseIcon } from "../icons.tsx"
import { Button, IconButton } from "./buttons.tsx"
import { cn } from "./cn.ts"
import {
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Dialog as DialogRoot,
  DialogTitle,
} from "./dialog.tsx"

/**
 * A modal dialog: title, body, then a footer of actions (D139: shadcn's Dialog on Base UI, which
 * traps focus and returns it on close). Render it to open it. Escape and clicking outside call
 * `onClose`; without one, the dialog can't be dismissed.
 */
export function Dialog({
  title,
  onClose,
  footer,
  children,
  className,
}: {
  title: ReactNode
  onClose?: (() => void) | undefined
  footer: ReactNode
  children: ReactNode
  className?: string | undefined
}) {
  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose?.()
      }}
    >
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {onClose ? (
            <DialogClose
              render={
                <IconButton label="Close">
                  <CloseIcon />
                </IconButton>
              }
            />
          ) : null}
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </DialogRoot>
  )
}

/** The bar that floats over a list: bulk actions for a selection, or a toast with an undo. */
export function FloatingBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "absolute bottom-4 left-1/2 z-6 flex h-11 -translate-x-1/2 items-center gap-0.5 rounded-xl bg-raised pr-1 pl-3.5 whitespace-nowrap shadow-pop",
        className,
      )}
      {...props}
    />
  )
}

export function FloatingBarDivider() {
  return <span className="mx-1 h-5 w-px bg-line-strong" />
}

/** What a toast can offer besides its text. */
export interface ToastOptions {
  /** A button, such as Undo. Clicking it also dismisses the toast. */
  readonly action?: { readonly label: string; readonly onClick: () => void } | undefined
  /** A text button that dismisses it, such as "OK"; without one, a × does. */
  readonly dismissLabel?: string | undefined
  /** How long it stays, in milliseconds. */
  readonly duration?: number | undefined
  /** False for a toast with no way to dismiss it, only its text (and action). */
  readonly dismissible?: boolean | undefined
}

/**
 * Shows a brief message at the bottom of the window, replacing any showing (D139: sonner places,
 * times and announces it; it looks as Toast did). Returns its id, for `dismissToast`.
 */
export function showToast(text: ReactNode, options: ToastOptions = {}) {
  return toast.custom(
    (id) => (
      <div
        role="status"
        className="flex h-11 items-center gap-3 rounded-xl bg-raised pr-2 pl-4 whitespace-nowrap text-fg shadow-pop"
      >
        <span>{text}</span>
        {options.action ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              toast.dismiss(id)
              options.action?.onClick()
            }}
          >
            {options.action.label}
          </Button>
        ) : null}
        {options.dismissLabel ? (
          <Button variant="ghost" size="sm" onClick={() => toast.dismiss(id)}>
            {options.dismissLabel}
          </Button>
        ) : options.dismissible === false ? null : (
          <IconButton label="Dismiss" size="xs" onClick={() => toast.dismiss(id)}>
            <CloseIcon className="size-4" />
          </IconButton>
        )}
      </div>
    ),
    { duration: options.duration ?? 6000 },
  )
}

/** Hides a toast showToast showed, or every toast without an id. */
export const dismissToast = (id?: string | number) => toast.dismiss(id)
