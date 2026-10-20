import { cn } from "./ui/cn.ts"

/**
 * Parley's mark. Loaded from public/parley-icon.svg, the one source for its shape, so the app,
 * the favicon and anything else that uses it never drift apart. Size it with a height class; the
 * width follows the mark's proportions.
 */
export function ParleyMark(props: { readonly label?: string; readonly className?: string }) {
  return (
    <img
      className={cn("h-7 w-auto shrink-0", props.className)}
      src="/parley-icon.svg"
      width={170}
      height={183}
      alt={props.label ?? ""}
      aria-hidden={props.label ? undefined : true}
      draggable={false}
    />
  )
}

/** What a page shows while it loads: the mark, breathing gently. */
export function LoadingScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas" aria-busy="true" aria-label="Loading Parley">
      <ParleyMark className="h-12 animate-breathe motion-reduce:animate-none" />
    </main>
  )
}
