import { type RefObject, useEffect, useState } from "react"

/** How the composer lays out its content and preview: chosen, or "auto" by the space it has. */
export type ComposerLayout = "auto" | "side" | "stacked"

const LAYOUT_KEY = "parley.composer.layout"
const SPLIT_KEY = "parley.composer.split"
/** Below this width (in rem) an "auto" composer stacks the preview under the content. */
const AUTO_STACK_REM = 70
/** The content pane's share of the width, in percent, when side by side. */
const SPLIT = { min: 30, max: 70, default: 50, step: 2 } as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private windows can refuse storage; the choice then lasts for this page only.
  }
}
const clamp = (value: number) => Math.min(SPLIT.max, Math.max(SPLIT.min, Math.round(value)))

/**
 * The composer's layout, remembered in this browser: side by side with a split (`commitSplit`
 * remembers where the handle was left), or the preview stacked under the content. Until someone chooses, it stacks when the composer is narrow.
 */
export const useComposerLayout = (container: RefObject<HTMLElement | null>) => {
  const [choice, setChoice] = useState<ComposerLayout>(() => {
    const stored = read(LAYOUT_KEY)
    return stored === "side" || stored === "stacked" ? stored : "auto"
  })
  const [split, setSplit] = useState(() => {
    const stored = Number(read(SPLIT_KEY))
    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : SPLIT.default
  })
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const observer = new ResizeObserver(([entry]) => {
      setNarrow((entry?.contentRect.width ?? Number.POSITIVE_INFINITY) < AUTO_STACK_REM * rem)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [container])

  const stacked = choice === "stacked" || (choice === "auto" && narrow)

  const toggle = () => {
    const next = stacked ? "side" : "stacked"
    setChoice(next)
    write(LAYOUT_KEY, next)
  }

  const commitSplit = (value: number) => {
    const next = clamp(value)
    setSplit(next)
    write(SPLIT_KEY, String(next))
  }

  return { stacked, toggle, split, commitSplit }
}
