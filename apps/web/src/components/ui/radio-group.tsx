import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { cn } from "cn"

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return <RadioGroupPrimitive data-slot="radio-group" className={cn(className)} {...props} />
}

/** A radio: a 16px ring that thickens to a dot when chosen. Renders a native `<button>`. */
function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      nativeButton
      render={<button type="button" />}
      className={cn(
        "m-0 mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-full inset-ring inset-ring-control data-checked:inset-ring-4 data-checked:inset-ring-primary",
        className,
      )}
      {...props}
    />
  )
}

export { RadioGroup, RadioGroupItem }
