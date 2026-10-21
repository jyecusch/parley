import type { ReactNode } from "react"
import { cn } from "./cn.ts"

/** A sidebar item's icon slot (also used for icons in menus that sit beside sidebar items). */
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
