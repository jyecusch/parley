import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "./cn.ts"

/** A boxed group of settings, such as the MCP URL or the sender form. */
export function SettingsPanel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("flex flex-col gap-3 rounded-lg px-5 py-4 inset-ring inset-ring-line-strong", className)}
      {...props}
    />
  )
}

/** A heading for a part of a settings page, such as "Sending domains". */
export function SettingsSectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="m-0 mt-2 -mb-2 text-base font-semibold">{children}</h3>
}

/** A part of a settings page with its own heading and a sentence about it, such as "Invited". */
export function SettingsSubIntro({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h2 className="m-0 mb-1 text-lg font-semibold tracking-tight">{title}</h2>
      <p className="m-0 max-w-3xl text-pretty text-muted">{children}</p>
    </div>
  )
}

/** Who or what a row is about: an optional mark, a name, and a line under it. */
export function RowIdentity({ mark, name, sub }: { mark?: ReactNode; name: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {mark}
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{name}</span>
        {sub ? <span className="truncate text-sm text-subtle">{sub}</span> : null}
      </span>
    </div>
  )
}

/** Buttons side by side in a row's actions cell. */
export function RowActions({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1">{children}</span>
}

/** A small mark and a name inline, such as who a connection acts as. */
export function Byline({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {mark}
      <span className="truncate">{children}</span>
    </span>
  )
}
