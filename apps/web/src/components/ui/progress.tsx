import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

/**
 * A progress bar, in Parley's look (D80): a thin rounded track that fills as `value` nears
 * `max`. Name it with `aria-label`.
 */
function Progress({
  className,
  ...props
}: Omit<ProgressPrimitive.Root.Props, "className"> & { className?: string | undefined }) {
  return (
    <ProgressPrimitive.Root data-slot="progress" className={className} {...props}>
      <ProgressPrimitive.Track data-slot="progress-track" className="h-1.5 overflow-hidden rounded-full bg-fill">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="h-full rounded-full bg-primary transition-[width] duration-500"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
