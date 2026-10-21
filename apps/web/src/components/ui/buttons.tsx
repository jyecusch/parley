import type { ComponentProps, ReactNode } from "react"
import { Button as ButtonBase, buttonVariants } from "./button.tsx"
import { cn } from "./cn.ts"
import { Kbd as KbdBase } from "./kbd.tsx"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx"

export type ButtonVariant = "secondary" | "primary" | "ghost" | "danger" | "danger-solid"
export type ButtonSize = "sm" | "md" | "lg"

/** A button's classes, for elements that look like buttons but aren't (links). */
export const buttonClass = (
  options: { variant?: ButtonVariant | undefined; size?: ButtonSize | undefined; wide?: boolean | undefined } = {},
) =>
  cn(buttonVariants({ variant: options.variant ?? "secondary", size: options.size ?? "md" }), options.wide && "w-full")

export function Button({
  variant,
  size,
  wide,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  wide?: boolean | undefined
}) {
  return (
    <ButtonBase
      type={type}
      variant={variant ?? "secondary"}
      size={size ?? "md"}
      className={cn(wide && "w-full", className)}
      {...props}
    />
  )
}

export type IconButtonSize = "xs" | "sm" | "md"

/** Where a tip shows: "bottom-start" lines it up with the element's left edge, for elements at a panel's edge. */
export type TipSide = "bottom" | "bottom-start" | "right"

/** A tip's placement, as TooltipContent takes it. */
export const tipPlacement = (side: TipSide) =>
  side === "right"
    ? ({ side: "right", sideOffset: 8 } as const)
    : side === "bottom-start"
      ? ({ side: "bottom", align: "start" } as const)
      : ({ side: "bottom" } as const)

/**
 * A square button holding one icon. `label` names it for screen readers; `tip` (often the label
 * plus its shortcut) shows on hover.
 */
export function IconButton({
  label,
  tip,
  tipSide = "bottom",
  size = "sm",
  children,
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  label: string
  tip?: string | undefined
  tipSide?: TipSide | undefined
  size?: IconButtonSize | undefined
  children: ReactNode
}) {
  const button = (
    <ButtonBase type={type} aria-label={label} variant="icon" size={`icon-${size}`} {...props}>
      {children}
    </ButtonBase>
  )
  return tip ? (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent {...tipPlacement(tipSide)}>{tip}</TooltipContent>
    </Tooltip>
  ) : (
    button
  )
}

/** A keyboard shortcut, like ⌘K. `onPrimary` when it sits on a primary button. */
export function Kbd({ children, onPrimary }: { children: ReactNode; onPrimary?: boolean }) {
  return <KbdBase className={onPrimary ? "bg-on-primary/15 opacity-75" : "bg-fill text-subtle"}>{children}</KbdBase>
}

/** Text that acts like a link but is a button, such as "Add email". */
export function TextButton({ type = "button", ...props }: ComponentProps<"button">) {
  return <ButtonBase type={type} variant="text" size="none" {...props} />
}
