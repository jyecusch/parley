import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref, useEffect, useId } from "react"
import { CloseIcon } from "../icons.tsx"
import { IconButton } from "./button.tsx"
import { cn } from "./cn.ts"

/** Dims the page behind a dialog or the command menu; clicking it closes them. */
export function Scrim({ onClick }: { onClick?: (() => void) | undefined }) {
  return (
    <button
      type="button"
      aria-label="Close"
      tabIndex={-1}
      className="fixed inset-0 z-10 cursor-default border-0 bg-scrim p-0"
      onClick={onClick}
    />
  )
}

/** A modal dialog: title, body, then a footer of actions. Escape and the scrim close it. */
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
  useEffect(() => {
    if (!onClose) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const titleId = useId()
  return (
    <>
      <Scrim onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "fixed top-[11%] left-1/2 z-11 flex max-h-[84vh] w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 flex-col overflow-auto rounded-xl bg-raised shadow-pop",
          className,
        )}
      >
        <div className="flex items-center gap-2 pt-4 pr-3 pb-1 pl-5">
          <h2 id={titleId} className="m-0 flex-1 text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {onClose ? (
            <IconButton label="Close" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          ) : null}
        </div>
        <div className="flex flex-col gap-5 px-5 pt-2 pb-5">{children}</div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>
      </div>
    </>
  )
}

/** A dropdown menu, positioned by its caller (usually top-full, aligned to an edge). */
export function Menu({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="menu"
      className={cn("absolute z-40 flex min-w-60 flex-col gap-px rounded-lg bg-raised p-1 shadow-pop", className)}
      {...props}
    />
  )
}

/** The classes for a menu item, for links that act as one. */
export const menuItemClass = (options: { active?: boolean | undefined; danger?: boolean | undefined } = {}) =>
  cn(
    "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left whitespace-nowrap text-fg no-underline hover:bg-active",
    options.active && "bg-active",
    options.danger && "text-danger",
  )

export function MenuItem({
  active,
  danger,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean | undefined; danger?: boolean | undefined }) {
  return <button type={type} role="menuitem" className={cn(menuItemClass({ active, danger }), className)} {...props} />
}

export function MenuSeparator() {
  return <div className="mx-0.5 my-1 h-px bg-line" />
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <p className="m-0 px-2.5 pt-2 pb-0.5 text-sm text-subtle">{children}</p>
}

/** A floating panel, such as a picker or a filter editor, positioned by its caller. */
export function Popover({ className, ref, ...props }: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-12 w-96 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-xl bg-raised shadow-pop",
        className,
      )}
      {...props}
    />
  )
}

/** A popover's search row: an icon and a borderless input. */
export function PopoverSearch({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-11 items-center gap-2.5 border-b border-line px-3 text-subtle [&>input]:min-w-0 [&>input]:flex-1 [&>input]:bg-transparent [&>input]:text-fg [&>input]:outline-none">
      {icon}
      {children}
    </div>
  )
}

export function PopoverList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("max-h-80 overflow-auto p-1", className)} {...props} />
}

export function PopoverHeading({ children }: { children: ReactNode }) {
  return <p className="m-0 px-2 pt-2 pb-1 text-sm text-subtle">{children}</p>
}

/** An item in a popover list or the command menu; `trailing` sits on the right. */
export function PopoverItem({
  active,
  trailing,
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean | undefined; trailing?: ReactNode }) {
  return (
    <button
      type={type}
      className={cn(
        "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-fg hover:bg-active",
        active && "bg-active",
        className,
      )}
      {...props}
    >
      {children}
      {trailing ? <span className="ml-auto truncate text-subtle">{trailing}</span> : null}
    </button>
  )
}

export function PopoverFooter({ children }: { children: ReactNode }) {
  return <div className="border-t border-line p-1">{children}</div>
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

/** A brief message at the bottom of the window (D: toast). */
export function Toast({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "fixed bottom-5 left-1/2 z-12 flex h-11 -translate-x-1/2 items-center gap-3 rounded-xl bg-raised pr-2 pl-4 whitespace-nowrap shadow-pop",
        className,
      )}
    >
      {children}
    </div>
  )
}
