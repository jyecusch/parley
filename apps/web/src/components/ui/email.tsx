import type { InputHTMLAttributes, ReactNode } from "react"
import { cn } from "./cn.ts"
import { Avatar } from "./data.tsx"

/** A broadcast, template or segment's mark in a list: its kind's icon on a square tile. */
export function ItemTile({ icon }: { icon: ReactNode }) {
  return (
    <Avatar size="md" shape="square">
      {icon}
    </Avatar>
  )
}

/** The classes for the link on an item's name in a list; put the name in `NameText`. */
export const nameLinkClass =
  "group/name flex max-w-full items-center gap-2.5 rounded-sm text-left font-medium text-fg no-underline focus-visible:-outline-offset-2"

/** An item's name inside a `nameLinkClass` link, underlined on hover; `sub` is a quieter line below. */
export function NameText({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  const name = (
    <span className="truncate decoration-line-strong underline-offset-3 group-hover/name:underline">{children}</span>
  )
  if (!sub) return name
  return (
    <span className="flex min-w-0 flex-col">
      {name}
      <span className="truncate text-sm font-normal text-subtle">{sub}</span>
    </span>
  )
}

/** An item's name, editable in place in its breadcrumb. */
export function TitleInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn("-mx-1 w-96 min-w-0 rounded-sm bg-transparent px-1 outline-0 focus:bg-fill", className)}
      {...props}
    />
  )
}

/** Hides a list's secondary column when the content area is narrow, before anything scrolls sideways. */
export const wideColumnClass = "@max-[40rem]/content:hidden"
