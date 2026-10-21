import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "./cn.ts"

/**
 * A single-value slider, drawn as the browser drew our native range input (accent-primary): an
 * 8px outlined track, filled to the thumb in the primary colour, and a 16px thumb.
 */
function Slider({ className, ...props }: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root className={cn("w-full", className)} data-slot="slider" thumbAlignment="edge" {...props}>
      <SliderPrimitive.Control className="relative flex h-5 w-full cursor-pointer touch-none items-center select-none data-disabled:opacity-50">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative mx-px h-2 grow overflow-hidden rounded-full border border-black/31 bg-black/6 select-none dark:border-white/49 dark:bg-white/17"
        >
          <SliderPrimitive.Indicator data-slot="slider-range" className="h-full bg-primary select-none" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          className="block size-4 shrink-0 rounded-full bg-primary select-none has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-focus"
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
