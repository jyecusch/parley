import type { ComponentProps } from "react"
import { cn } from "./cn.ts"

/*
 * Tables, in Parley's look (D80). `data-kind` on the table picks a density: `list` for the record
 * lists (sticky header, compact rows) and `settings` for the boxed tables on settings pages. The
 * table isn't wrapped in a scroller: the view scrolls it, which keeps the list header sticky.
 */

function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <table
      data-slot="table"
      className={cn("group/table w-full table-fixed border-separate border-spacing-0", className)}
      {...props}
    />
  )
}

function TableHeader(props: ComponentProps<"thead">) {
  return <thead data-slot="table-header" {...props} />
}

function TableBody(props: ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" {...props} />
}

function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "group/row [&>td]:transition-colors hover:[&>td]:bg-hover",
        "group-data-[kind=settings]/table:last:[&>td]:border-b-0",
        // The box's rounded corners, so a hovered last row doesn't poke out of them.
        "group-data-[kind=settings]/table:last:[&>td:first-child]:rounded-bl-[calc(var(--radius-lg)-1px)] group-data-[kind=settings]/table:last:[&>td:last-child]:rounded-br-[calc(var(--radius-lg)-1px)]",
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
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

function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-10 overflow-hidden border-b border-line/55 px-2.5 text-ellipsis whitespace-nowrap",
        "group-data-[kind=settings]/table:h-14 group-data-[kind=settings]/table:first:pl-4",
        className,
      )}
      {...props}
    />
  )
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow }
