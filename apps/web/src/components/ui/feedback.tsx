import type { ReactNode } from "react"
import { Alert, AlertDescription, AlertIcon, AlertTitle } from "./alert.tsx"
import { cn } from "./cn.ts"
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from "./empty.tsx"
import { Skeleton as SkeletonBase } from "./skeleton.tsx"

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
    <Empty className={className}>
      {icon ? <EmptyMedia tone={tone}>{icon}</EmptyMedia> : null}
      <EmptyTitle>{title}</EmptyTitle>
      {children ? <EmptyDescription>{children}</EmptyDescription> : null}
      {actions ? <EmptyContent>{actions}</EmptyContent> : null}
    </Empty>
  )
}

/** A highlighted message inside a page: information, a warning, a problem or a success. */
export function Notice({
  tone = "info",
  icon,
  title,
  children,
  className,
}: {
  tone?: "info" | "warn" | "danger" | "ok"
  icon?: ReactNode | undefined
  title?: ReactNode | undefined
  children: ReactNode
  className?: string | undefined
}) {
  return (
    <Alert tone={tone} className={className}>
      {icon ? <AlertIcon tone={tone}>{icon}</AlertIcon> : null}
      <div className="min-w-0">
        {title ? <AlertTitle>{title}</AlertTitle> : null}
        {title ? <AlertDescription>{children}</AlertDescription> : children}
      </div>
    </Alert>
  )
}

/** A loading placeholder bar (or circle). */
export function Skeleton({ className, round }: { className?: string | undefined; round?: boolean }) {
  return <SkeletonBase className={cn(round && "size-5.5 shrink-0 rounded-full", className)} />
}
