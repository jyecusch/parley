import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"
import { cn } from "./cn.ts"

/** A mark's frame, in Parley's look (D80): its size, shape and fill come from the caller. */
function Avatar({
  className,
  ...props
}: Omit<AvatarPrimitive.Root.Props, "className"> & { className?: string | undefined }) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative inline-grid shrink-0 place-items-center leading-none font-semibold tracking-normal",
        className,
      )}
      {...props}
    />
  )
}

/** The mark's image, shown once it loads; `AvatarFallback` shows until then, or if it fails. */
function AvatarImage({
  className,
  ...props
}: Omit<AvatarPrimitive.Image.Props, "className"> & { className?: string | undefined }) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("size-full rounded-[inherit] object-cover", className)}
      {...props}
    />
  )
}

function AvatarFallback(props: AvatarPrimitive.Fallback.Props) {
  return <AvatarPrimitive.Fallback data-slot="avatar-fallback" {...props} />
}

/** A small badge on a mark's corner, such as a service account's robot. */
function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute -right-1.5 -bottom-1.5 grid size-3.5 place-items-center rounded-xs bg-surface text-fg ring ring-line-strong",
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarBadge, AvatarFallback, AvatarImage }
