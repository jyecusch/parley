import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import type { ComponentProps } from "react"
import { cn } from "./cn.ts"

/*
 * A view's breadcrumb, in Parley's look (D80): `Settings / Members` on one line. The list and its
 * items don't add boxes of their own, so the links, separators and page sit in one row.
 */

function Breadcrumb({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      aria-label="Breadcrumb"
      data-slot="breadcrumb"
      className={cn(
        "flex min-w-0 items-center gap-2 overflow-hidden text-base font-medium text-ellipsis whitespace-nowrap",
        className,
      )}
      {...props}
    />
  )
}

function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
  return <ol data-slot="breadcrumb-list" className={cn("contents", className)} {...props} />
}

function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return <li data-slot="breadcrumb-item" className={cn("contents", className)} {...props} />
}

function BreadcrumbLink({ className, render, ...props }: useRender.ComponentProps<"a">) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">({ className: cn("text-muted no-underline hover:text-fg", className) }, props),
    render,
    state: { slot: "breadcrumb-link" },
  })
}

/** The current page. `render` makes it the view's heading, such as an `<h1>`. */
function BreadcrumbPage({ className, render, ...props }: useRender.ComponentProps<"span">) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ "aria-current": "page", className }, props),
    render,
    state: { slot: "breadcrumb-page" },
  })
}

function BreadcrumbSeparator({ children, className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("font-normal text-subtle", className)}
      {...props}
    >
      {children ?? "/"}
    </li>
  )
}

export { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator }
