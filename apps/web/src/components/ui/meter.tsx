import { Meter as MeterPrimitive } from "@base-ui/react/meter"
import { cn } from "./cn.ts"

/**
 * A measurement within a known range, such as a password's strength, in Parley's look: the
 * progress bar's track, filled to `value` of `max`. `tone` colors the fill. Name it with `aria-label`.
 */
function Meter({
  className,
  tone = "primary",
  ...props
}: Omit<MeterPrimitive.Root.Props, "className"> & {
  className?: string | undefined
  tone?: "primary" | "danger" | "warn" | "ok"
}) {
  return (
    <MeterPrimitive.Root data-slot="meter" className={className} {...props}>
      <MeterPrimitive.Track data-slot="meter-track" className="h-1.5 overflow-hidden rounded-full bg-fill">
        <MeterPrimitive.Indicator
          data-slot="meter-indicator"
          className={cn(
            "h-full rounded-full transition-all duration-300 motion-reduce:transition-none",
            { primary: "bg-primary", danger: "bg-danger", warn: "bg-warn", ok: "bg-ok" }[tone],
          )}
        />
      </MeterPrimitive.Track>
    </MeterPrimitive.Root>
  )
}

export { Meter }
