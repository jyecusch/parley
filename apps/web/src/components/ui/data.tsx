import { type ButtonHTMLAttributes, type ReactNode, useState } from "react"
import { AvatarBadge, Avatar as AvatarBase, AvatarFallback, AvatarImage } from "./avatar.tsx"
import { Badge as BadgeBase } from "./badge.tsx"
import { Button as ButtonBase } from "./button.tsx"
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
    <BadgeBase variant={tone} className={className}>
      {children}
    </BadgeBase>
  )
}

/** A value shown as a chip, such as a multi-select option. */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BadgeBase variant="chip" className={className}>
      {children}
    </BadgeBase>
  )
}

/** A permission or code-like tag, in mono. */
export function CodeTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BadgeBase variant="code" className={className}>
      {children}
    </BadgeBase>
  )
}

/** A quiet outlined tag, such as "Revoked" or "You". */
export function OutlineTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BadgeBase variant="outline" className={className}>
      {children}
    </BadgeBase>
  )
}

export type MarkSize = "sm" | "md" | "lg"

const AVATAR_SIZES: Readonly<Record<MarkSize, string>> = {
  sm: "size-5.5 text-2xs",
  md: "size-7 text-xs",
  lg: "size-11 text-base",
}
const TILE_RADII: Readonly<Record<MarkSize, string>> = { sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg" }

/** How a mark is filled: by an image, or by initials or an icon. */
const IMAGE_FILL =
  "bg-surface inset-ring inset-ring-line [&>img]:size-full [&>img]:rounded-[inherit] [&>img]:object-cover"
const INITIALS_FILL = "bg-fill text-muted"

/**
 * A person's or company's mark: initials (`children`), or an image. `src` loads one, showing the
 * initials until it has loaded and if it fails; `image` shows an element as given. Round for
 * people, square (`shape="square"`) for companies and service accounts. `dashed` for "new".
 */
export function Avatar({
  size = "sm",
  shape = "round",
  src,
  crossOrigin,
  image,
  dashed,
  badge,
  children,
  className,
}: {
  size?: MarkSize | undefined
  shape?: "round" | "square" | undefined
  src?: string | undefined
  /** "anonymous" for images from other sites that CRT mode (D81) must be able to draw. */
  crossOrigin?: "anonymous" | undefined
  image?: ReactNode | undefined
  dashed?: boolean | undefined
  badge?: ReactNode | undefined
  children?: ReactNode | undefined
  className?: string | undefined
}) {
  const [loaded, setLoaded] = useState<string>()
  const showsImage = image !== undefined || (src !== undefined && loaded === src)
  return (
    <AvatarBase
      aria-hidden="true"
      className={cn(
        AVATAR_SIZES[size],
        shape === "round" ? "rounded-full" : TILE_RADII[size],
        showsImage ? IMAGE_FILL : INITIALS_FILL,
        dashed && "border border-dashed border-control bg-transparent",
        className,
      )}
    >
      {src !== undefined ? (
        <>
          <AvatarImage
            src={src}
            alt=""
            crossOrigin={crossOrigin}
            onLoadingStatusChange={(status) => setLoaded(status === "loaded" ? src : undefined)}
          />
          <AvatarFallback>{children}</AvatarFallback>
        </>
      ) : (
        (image ?? children)
      )}
      {badge ? <AvatarBadge>{badge}</AvatarBadge> : null}
    </AvatarBase>
  )
}

/** A number with its label, as in a broadcast's report. Pressable to filter by it. */
export function StatTile({
  value,
  label,
  active,
  className,
  type = "button",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> & { value: ReactNode; label: ReactNode; active?: boolean }) {
  return (
    <ButtonBase
      type={type}
      variant="tile"
      size="none"
      className={cn(active && "inset-ring-2 inset-ring-muted", className)}
      {...props}
    >
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-subtle">{label}</span>
    </ButtonBase>
  )
}
