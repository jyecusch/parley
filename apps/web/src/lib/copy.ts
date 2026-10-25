import { useEffect, useRef, useState } from "react"

/** Copies text, and says "copied" for a moment after; the moment ends with the component. */
export const useCopy = () => {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1600)
  }
  return { copied, copy }
}
