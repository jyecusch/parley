import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "./cn.ts"

/** What every bordered, labelled button shares. */
const LABELLED =
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border font-medium whitespace-nowrap no-underline transition-colors disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none"

/**
 * Parley's button looks (D80), as shadcn's button variants. The labelled variants take a `size` of
 * sm, md or lg; `icon` takes an icon size; `text`, `link` and `tile` take none.
 */
const buttonVariants = cva("", {
  variants: {
    variant: {
      secondary: `${LABELLED} border-line-strong text-fg hover:bg-hover active:bg-active`,
      primary: `${LABELLED} border-primary bg-primary text-on-primary hover:border-primary-hover hover:bg-primary-hover`,
      ghost: `${LABELLED} border-transparent text-muted hover:bg-hover hover:text-fg active:bg-active`,
      danger: `${LABELLED} border-transparent text-danger hover:bg-danger-soft`,
      "danger-solid": `${LABELLED} border-danger bg-danger text-white hover:brightness-90`,
      /** A square button holding one icon. */
      icon: "grid shrink-0 cursor-pointer place-items-center p-0 text-muted transition-colors hover:bg-hover hover:text-fg active:bg-active disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none",
      /** Text that acts like a link, such as "Add email". */
      text: "inline-flex cursor-pointer items-center gap-1 self-start p-0 text-subtle hover:text-fg",
      /** A button that reads as a link in a sentence. */
      link: "cursor-pointer p-0 text-fg underline underline-offset-2 hover:text-muted",
      /** A number with its label, pressable. */
      tile: "flex cursor-pointer flex-col items-start gap-0.5 rounded-lg bg-surface px-3 py-2.5 text-left inset-ring inset-ring-line-strong disabled:cursor-default",
    },
    size: {
      sm: "h-7 gap-1.5 px-2 text-sm",
      md: "h-8 gap-2 px-3",
      lg: "h-10 gap-2 px-4",
      "icon-xs": "size-7 rounded-md",
      "icon-sm": "size-8 rounded-md",
      "icon-md": "size-9 rounded-md",
      none: "",
    },
  },
  defaultVariants: {
    variant: "secondary",
    size: "md",
  },
})

function Button({
  className,
  variant,
  size,
  ...props
}: Omit<ButtonPrimitive.Props, "className"> &
  VariantProps<typeof buttonVariants> & { className?: string | undefined }) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { Button, buttonVariants }
