import type { ReactNode } from "react"
import { cn } from "./cn.ts"

/** The classes for a sidebar item, for TanStack links (which take active classes separately). */
export const navItemClass = (options: { collapsed?: boolean | undefined; sub?: boolean } = {}) =>
  cn(
    "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-left whitespace-nowrap text-muted no-underline transition-colors hover:bg-hover hover:text-fg motion-reduce:transition-none",
    "disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
    options.collapsed && "justify-center px-0",
  )

/** Added to a sidebar item when it's the current page. */
export const navItemActiveClass = "bg-active font-medium text-fg [&_[data-nav-icon]]:text-fg"

/** A sidebar item's icon slot. */
export function NavIcon({ children }: { children: ReactNode }) {
  return (
    <span data-nav-icon className="grid size-5 shrink-0 place-items-center text-subtle">
      {children}
    </span>
  )
}

/** A sidebar item's label; hidden (but still read aloud) when the sidebar is collapsed. */
export function NavLabel({ collapsed, children }: { collapsed?: boolean | undefined; children: ReactNode }) {
  return <span className={cn("truncate", collapsed && "sr-only")}>{children}</span>
}

/** A group of sidebar items, with an optional heading. */
export function NavGroup({
  label,
  collapsed,
  children,
}: {
  label?: string | undefined
  collapsed?: boolean | undefined
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-px [&+&]:mt-4">
      {label ? (
        <h2
          className={cn(
            "m-0 flex h-7 items-center px-1.5 text-sm font-medium text-subtle",
            collapsed && "invisible h-2",
          )}
        >
          {label}
        </h2>
      ) : null}
      {children}
    </div>
  )
}
