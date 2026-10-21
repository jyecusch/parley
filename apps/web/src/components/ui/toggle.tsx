import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const toggleVariants = cva("", {
  variants: {
    variant: {
      /** One option of a segmented control: raised onto the surface while pressed. */
      segment:
        "relative inline-flex h-8 cursor-pointer items-center rounded-md px-3.5 font-medium text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus data-pressed:bg-surface data-pressed:text-fg data-pressed:shadow-card",
    },
  },
  defaultVariants: { variant: "segment" },
})

function Toggle({ className, variant, ...props }: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return <TogglePrimitive data-slot="toggle" className={cn(toggleVariants({ variant }), className)} {...props} />
}

export { Toggle, toggleVariants }
