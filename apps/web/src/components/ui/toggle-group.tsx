import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import type { VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { toggleVariants } from "@/components/ui/toggle"

/** Toggle buttons in a tinted strip, such as Contacts / Companies. */
function ToggleGroup<Value extends string>({ className, ...props }: ToggleGroupPrimitive.Props<Value>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn("inline-flex gap-0.5 self-start rounded-lg bg-fill p-0.5", className)}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  variant,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive data-slot="toggle-group-item" className={cn(toggleVariants({ variant }), className)} {...props} />
  )
}

export { ToggleGroup, ToggleGroupItem }
