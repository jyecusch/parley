import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "./cn.ts"

/** A short status in a rounded pill: Draft, Sent, Verified. */
export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "strong" | "danger" | undefined
  children: ReactNode
  className?: string | undefined
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-sm whitespace-nowrap",
        tone === "strong"
          ? "bg-primary text-on-primary"
          : tone === "danger"
            ? "bg-danger-soft text-danger"
            : "bg-fill text-muted",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A value shown as a chip, such as a multi-select option. */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-md bg-fill px-2 text-fg", className)}>{children}</span>
  )
}

/** A permission or code-like tag, in mono. */
export function CodeTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-sm bg-fill px-1.5 font-mono text-xs font-medium text-muted",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A quiet outlined tag, such as "Revoked" or "You". */
export function OutlineTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-sm px-1.5 text-xs text-subtle inset-ring inset-ring-line-strong",
        className,
      )}
    >
      {children}
    </span>
  )
}

export type MarkSize = "sm" | "md" | "lg"

const AVATAR_SIZES: Readonly<Record<MarkSize, string>> = {
  sm: "size-5.5 text-2xs",
  md: "size-7 text-xs",
  lg: "size-11 text-base",
}
const TILE_RADII: Readonly<Record<MarkSize, string>> = { sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg" }

/**
 * A person's or company's mark: initials, or an image when `image` is set. Round for people,
 * square (`shape="square"`) for companies and service accounts. `dashed` for "new".
 */
export function Avatar({
  size = "sm",
  shape = "round",
  image,
  dashed,
  badge,
  children,
  className,
}: {
  size?: MarkSize | undefined
  shape?: "round" | "square" | undefined
  image?: ReactNode | undefined
  dashed?: boolean | undefined
  badge?: ReactNode | undefined
  children?: ReactNode | undefined
  className?: string | undefined
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-grid shrink-0 place-items-center leading-none font-semibold tracking-normal",
        AVATAR_SIZES[size],
        shape === "round" ? "rounded-full" : TILE_RADII[size],
        image
          ? "bg-surface inset-ring inset-ring-line [&>img]:size-full [&>img]:rounded-[inherit] [&>img]:object-cover"
          : "bg-fill text-muted",
        dashed && "border border-dashed border-control bg-transparent",
        className,
      )}
    >
      {image ?? children}
      {badge ? (
        <span className="absolute -right-1.5 -bottom-1.5 grid size-3.5 place-items-center rounded-xs bg-surface text-fg ring ring-line-strong">
          {badge}
        </span>
      ) : null}
    </span>
  )
}

/** A number with its label, as in a campaign's report. Pressable to filter by it. */
export function StatTile({
  value,
  label,
  active,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { value: ReactNode; label: ReactNode; active?: boolean }) {
  return (
    <button
      type={type}
      className={cn(
        "flex cursor-pointer flex-col items-start gap-0.5 rounded-lg bg-surface px-3 py-2.5 text-left inset-ring inset-ring-line-strong disabled:cursor-default",
        active && "inset-ring-2 inset-ring-muted",
        className,
      )}
      {...props}
    >
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-subtle">{label}</span>
    </button>
  )
}
