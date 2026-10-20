import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react"
import { cn } from "./cn.ts"

/**
 * Tables come in two densities: `list` for the record lists (sticky header, compact rows) and
 * `settings` for the boxed tables on settings pages (taller rows).
 */
export type TableKind = "list" | "settings"

export function Table({ kind = "list", className, ...props }: HTMLAttributes<HTMLTableElement> & { kind?: TableKind }) {
  return (
    <table
      data-kind={kind}
      className={cn("group/table w-full table-fixed border-separate border-spacing-0", className)}
      {...props}
    />
  )
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-9 border-b border-line bg-surface px-2.5 text-left text-sm font-medium whitespace-nowrap text-subtle",
        "group-data-[kind=list]/table:sticky group-data-[kind=list]/table:top-0 group-data-[kind=list]/table:z-1",
        "group-data-[kind=settings]/table:h-10 group-data-[kind=settings]/table:bg-transparent group-data-[kind=settings]/table:first:pl-4",
        className,
      )}
      {...props}
    />
  )
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        "h-10 overflow-hidden border-b border-line/55 px-2.5 text-ellipsis whitespace-nowrap",
        "group-data-[kind=settings]/table:h-14 group-data-[kind=settings]/table:first:pl-4",
        className,
      )}
      {...props}
    />
  )
}

/**
 * A row. `checked` and `open` highlight it; `cursor` marks it for the keyboard. The first cell
 * gets a bar on the left for open and cursor rows.
 */
export function Tr({
  checked,
  open,
  cursor,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & {
  checked?: boolean | undefined
  open?: boolean | undefined
  cursor?: boolean
}) {
  return (
    <tr
      className={cn(
        "group/row [&>td]:transition-colors hover:[&>td]:bg-hover",
        "group-data-[kind=settings]/table:last:[&>td]:border-b-0",
        // The box's rounded corners, so a hovered last row doesn't poke out of them.
        "group-data-[kind=settings]/table:last:[&>td:first-child]:rounded-bl-[calc(var(--radius-lg)-1px)] group-data-[kind=settings]/table:last:[&>td:last-child]:rounded-br-[calc(var(--radius-lg)-1px)]",
        cursor && "[&>td]:bg-hover [&>td:first-child]:shadow-[inset_0.125rem_0_0_var(--color-subtle)]",
        (checked || open) && "[&>td]:bg-selected hover:[&>td]:bg-selected",
        open && "[&>td:first-child]:shadow-[inset_0.125rem_0_0_var(--color-mark)]",
        className,
      )}
      {...props}
    />
  )
}

/** Scrolls a list table inside its view. `padForBar` leaves room for the bulk-action bar. */
export function TableScroll({
  padForBar,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { padForBar?: boolean }) {
  return <div className={cn("min-h-0 flex-1 overflow-auto", padForBar && "pb-20", className)} {...props} />
}

/** A bordered box around a settings table, list or empty state. */
export function Box({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line-strong", className)} {...props} />
}
