import type { HTMLAttributes, Ref, TdHTMLAttributes, ThHTMLAttributes } from "react"
import { cn } from "./cn.ts"
import { Table as TableBase, TableCell, TableHead, TableRow } from "./table.tsx"

/**
 * Tables come in two densities: `list` for the record lists (sticky header, compact rows) and
 * `settings` for the boxed tables on settings pages (taller rows).
 */
export type TableKind = "list" | "settings"

export function Table({ kind = "list", ...props }: HTMLAttributes<HTMLTableElement> & { kind?: TableKind }) {
  return <TableBase data-kind={kind} {...props} />
}

export function Th(props: ThHTMLAttributes<HTMLTableCellElement>) {
  return <TableHead {...props} />
}

export function Td(props: TdHTMLAttributes<HTMLTableCellElement>) {
  return <TableCell {...props} />
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
    <TableRow
      className={cn(
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
}: HTMLAttributes<HTMLDivElement> & { padForBar?: boolean; ref?: Ref<HTMLDivElement> }) {
  // No scroll anchoring: a virtual list (D136) sets its own scroll position as its rows change.
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-auto [overflow-anchor:none]", padForBar && "pb-20", className)}
      {...props}
    />
  )
}

/** A bordered box around a settings table, list or empty state. */
export function Box({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line-strong", className)} {...props} />
}
