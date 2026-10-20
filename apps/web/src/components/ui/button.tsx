import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "./cn.ts"
import { Tooltip, type TooltipSide } from "./tooltip.tsx"

export type ButtonVariant = "secondary" | "primary" | "ghost" | "danger" | "danger-solid"
export type ButtonSize = "sm" | "md" | "lg"

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  secondary: "border-line-strong text-fg hover:bg-hover active:bg-active",
  primary: "border-primary bg-primary text-on-primary hover:border-primary-hover hover:bg-primary-hover",
  ghost: "border-transparent text-muted hover:bg-hover hover:text-fg active:bg-active",
  danger: "border-transparent text-danger hover:bg-danger-soft",
  "danger-solid": "border-danger bg-danger text-white hover:brightness-90",
}

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: "h-7 gap-1.5 px-2 text-sm",
  md: "h-8 gap-2 px-3",
  lg: "h-10 gap-2 px-4",
}

/** A button's classes, for elements that look like buttons but aren't (links). */
export const buttonClass = (
  options: { variant?: ButtonVariant | undefined; size?: ButtonSize | undefined; wide?: boolean | undefined } = {},
) =>
  cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border font-medium whitespace-nowrap no-underline transition-colors disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none",
    VARIANTS[options.variant ?? "secondary"],
    SIZES[options.size ?? "md"],
    options.wide && "w-full",
  )

export function Button({
  variant,
  size,
  wide,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  wide?: boolean | undefined
}) {
  return <button type={type} className={cn(buttonClass({ variant, size, wide }), className)} {...props} />
}

export type IconButtonSize = "xs" | "sm" | "md"

const ICON_SIZES: Readonly<Record<IconButtonSize, string>> = {
  xs: "size-7 rounded-md",
  sm: "size-8 rounded-md",
  md: "size-9 rounded-md",
}

/**
 * A square button holding one icon. `label` names it for screen readers; `tip` (often the label
 * plus its shortcut) shows on hover.
 */
export function IconButton({
  label,
  tip,
  tipSide = "bottom",
  size = "sm",
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  tip?: string | undefined
  tipSide?: TooltipSide | undefined
  size?: IconButtonSize | undefined
  children: ReactNode
}) {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "grid shrink-0 cursor-pointer place-items-center p-0 text-muted transition-colors hover:bg-hover hover:text-fg active:bg-active disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none",
        ICON_SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
  return tip ? (
    <Tooltip text={tip} side={tipSide}>
      {button}
    </Tooltip>
  ) : (
    button
  )
}

/** A keyboard shortcut, like ⌘K. `onPrimary` when it sits on a primary button. */
export function Kbd({ children, onPrimary }: { children: ReactNode; onPrimary?: boolean }) {
  return (
    <span
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded px-1 font-mono text-xs leading-none font-medium [text-shadow:none]",
        onPrimary ? "bg-on-primary/15 opacity-75" : "bg-fill text-subtle",
      )}
    >
      {children}
    </span>
  )
}

/** Text that acts like a link but is a button, such as "Add email". */
export function TextButton({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 self-start p-0 text-subtle hover:text-fg",
        className,
      )}
      {...props}
    />
  )
}
