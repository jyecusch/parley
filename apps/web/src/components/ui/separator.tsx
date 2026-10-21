import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "./cn.ts"

/** A dividing line, in Parley's look (D80). Its size and margins come from where it sits. */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: Omit<SeparatorPrimitive.Props, "className"> & { className?: string | undefined }) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn("bg-line", className)}
      {...props}
    />
  )
}

export { Separator }
