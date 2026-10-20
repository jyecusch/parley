/** The mark's proportions (public/parley-icon.svg), so its width follows from a height. */
const RATIO = 170.13 / 183.16

/**
 * Parley's mark. Loaded from public/parley-icon.svg, the one source for its shape, so the app,
 * the favicon and anything else that uses it never drift apart.
 */
export function ParleyMark(props: { readonly height?: number; readonly label?: string; readonly className?: string }) {
  const height = props.height ?? 28
  return (
    <img
      className={props.className}
      src="/parley-icon.svg"
      width={Math.round(height * RATIO)}
      height={height}
      alt={props.label ?? ""}
      aria-hidden={props.label ? undefined : true}
      draggable={false}
    />
  )
}

/** What a page shows while it loads: the mark, breathing gently. */
export function LoadingScreen() {
  return (
    <main className="loading-screen" aria-busy="true" aria-label="Loading Parley">
      <ParleyMark height={48} />
    </main>
  )
}
