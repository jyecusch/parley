import type { ReactNode } from "react"
import { cn } from "./cn.ts"

/** An empty or error state: an icon, a title, a sentence, and actions. */
export function EmptyState({
  icon,
  title,
  children,
  actions,
  tone = "neutral",
  className,
}: {
  icon?: ReactNode | undefined
  title: ReactNode
  children?: ReactNode | undefined
  actions?: ReactNode | undefined
  tone?: "neutral" | "danger" | "ok" | undefined
  className?: string | undefined
}) {
  return (
    <div className={cn("flex max-w-md flex-col items-center gap-2 text-center", className)}>
      {icon ? (
        <div
          className={cn(
            "mb-2 grid size-10 place-items-center rounded-md",
            tone === "danger"
              ? "bg-danger-soft text-danger"
              : tone === "ok"
                ? "bg-ok-soft text-ok"
                : "bg-fill text-muted",
          )}
        >
          {icon}
        </div>
      ) : null}
      <h2 className="m-0 text-lg font-semibold tracking-tight">{title}</h2>
      {children ? <p className="m-0 text-pretty text-muted">{children}</p> : null}
      {actions ? <div className="mt-3 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  )
}

const TONES = {
  info: { box: "bg-fill text-muted", icon: "text-subtle" },
  warn: { box: "bg-warn-soft text-fg", icon: "text-warn" },
  danger: { box: "bg-danger-soft text-fg", icon: "text-danger" },
  ok: { box: "bg-ok-soft text-fg", icon: "text-ok" },
} as const

/** A highlighted message inside a page: information, a warning, a problem or a success. */
export function Notice({
  tone = "info",
  icon,
  title,
  children,
  className,
}: {
  tone?: keyof typeof TONES
  icon?: ReactNode | undefined
  title?: ReactNode | undefined
  children: ReactNode
  className?: string | undefined
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn("flex items-start gap-3 rounded-lg px-3.5 py-3 leading-6", TONES[tone].box, className)}
    >
      {icon ? <span className={cn("mt-0.5 shrink-0", TONES[tone].icon)}>{icon}</span> : null}
      <div className="min-w-0">
        {title ? <b className="mb-0.5 block font-semibold">{title}</b> : null}
        {title ? <p className="m-0 text-muted">{children}</p> : children}
      </div>
    </div>
  )
}

/** A loading placeholder bar (or circle). */
export function Skeleton({ className, round }: { className?: string | undefined; round?: boolean }) {
  return (
    <span
      className={cn(
        "block h-2.5 animate-shimmer rounded-sm bg-[linear-gradient(90deg,var(--color-skeleton)_0%,var(--color-skeleton-hi)_50%,var(--color-skeleton)_100%)] bg-size-[200%_100%] motion-reduce:animate-none",
        round && "size-5.5 shrink-0 rounded-full",
        className,
      )}
    />
  )
}
