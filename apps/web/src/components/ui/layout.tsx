import type { HTMLAttributes, ReactNode } from "react"
import { Card as CardBase } from "./card.tsx"
import { cn } from "./cn.ts"

/** A raised surface: the main list, a record panel, a settings page. */
export function Card({ as, ...props }: HTMLAttributes<HTMLElement> & { as?: "main" | "aside" | "div" }) {
  const Tag = as ?? "div"
  return <CardBase render={<Tag />} {...props} />
}

/** The top bar of a view: breadcrumb, count, then actions on the right. */
export function PageHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex h-13 shrink-0 items-center gap-2 border-b border-line pr-3 pl-4", className)} {...props} />
  )
}

/** The view's title, as a breadcrumb: `Settings / Members`. */
export function Breadcrumb({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      className={cn(
        "m-0 flex min-w-0 items-center gap-2 overflow-hidden text-base font-medium text-ellipsis whitespace-nowrap",
        className,
      )}
      {...props}
    />
  )
}

export function BreadcrumbSeparator() {
  return (
    <span className="font-normal text-subtle" aria-hidden="true">
      /
    </span>
  )
}

/** The classes for a breadcrumb's parent link. */
export const breadcrumbRootClass = "text-muted no-underline hover:text-fg"

/** How many items a view shows, beside its title. */
export function Count({ children }: { children: ReactNode }) {
  return <span className="ml-0.5 shrink-0 text-subtle tabular-nums">{children}</span>
}

/** The second bar of a list: search, filters and display options. */
export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b border-line py-1 pr-3 pl-2",
        className,
      )}
      {...props}
    />
  )
}

/** Fills the space between left and right groups in a bar. */
export function Spacer() {
  return <div className="flex-1" />
}

/** The scrolling area under a view's bars. */
export function ViewBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-h-0 flex-1 flex-col", className)} {...props} />
}

/** Centers its content in the space available, for empty and error states. */
export function Centered({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid flex-1 place-items-center p-10", className)} {...props} />
}

/**
 * A record's panel beside its list (D55). In a narrow window it floats over the list instead, so
 * the list keeps its width; `full` makes it the full record view.
 */
export function RecordPanel({
  full,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { full?: boolean | undefined }) {
  return (
    <Card
      as="aside"
      className={cn(
        full
          ? "w-auto flex-auto"
          : "w-md shrink-0 @max-[69rem]/content:absolute @max-[69rem]/content:inset-y-1.5 @max-[69rem]/content:right-1.5 @max-[69rem]/content:z-5 @max-[69rem]/content:w-[min(28rem,calc(100%-0.75rem))] @max-[69rem]/content:shadow-pop",
        className,
      )}
      {...props}
    />
  )
}

/** Keeps a full record view's content in a readable column. */
export const readableColumnClass = "px-[max(1rem,calc((100%-54rem)/2))]"

export function PanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-3 border-b border-line pt-2 pr-3 pb-4 pl-4", className)} {...props} />
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-auto", className)} {...props} />
}

export function PanelFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3", className)} {...props} />
  )
}

/** A record's name in its panel header. */
export function RecordTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("m-0 truncate text-lg font-semibold tracking-tight", className)} {...props} />
}

/** A titled part of a record panel, such as Companies or Activity. */
export function Section({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("border-b border-line px-4 pt-3 pb-3.5 last:border-b-0", className)} {...props} />
}

export function SectionHeader({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("m-0 mb-1 flex h-7 items-center justify-between text-base font-medium text-subtle", className)}
      {...props}
    />
  )
}

/** One labeled property of a record: label on the left, value on the right. */
export function PropertyRow({ label, children, htmlFor }: { label: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-2.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="pt-1.5 text-sm text-subtle">
          {label}
        </label>
      ) : (
        <span className="pt-1.5 text-sm text-subtle">{label}</span>
      )}
      {children}
    </div>
  )
}

/** The classes for a property's value when clicking it starts editing. */
export const propertyValueClass =
  "-mx-1.5 flex min-w-0 cursor-text flex-col rounded-md px-1.5 py-1 text-left leading-6 hover:bg-hover"
