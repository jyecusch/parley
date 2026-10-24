import type { CaptchaChallenge } from "@parley/core"
import type { WidgetMethods } from "altcha/types"

/*
 * The browser's half of a form's captcha (D147). The built-in proof of work is ALTCHA's own
 * widget, invisible: it solves the server's challenge in Web Workers as the form loads, and its
 * payload goes back with the submission for altcha-lib to verify. Turnstile is Cloudflare's
 * widget, loaded on demand.
 */

type BuiltIn = Extract<CaptchaChallenge, { provider: "builtin" }>["challenge"]

/** Solves the built-in challenge; resolves to the payload to submit, or "" if it couldn't. */
export const solveProofOfWork = async (challenge: BuiltIn): Promise<string> => {
  await import("altcha")
  const widget = document.createElement("altcha-widget") as HTMLElement & WidgetMethods
  widget.hidden = true
  // Its methods exist only once it has loaded (ALTCHA's docs), which follows going into the page.
  const loaded = new Promise((resolve) => widget.addEventListener("load", resolve, { once: true }))
  document.body.append(widget)
  try {
    await loaded
    await widget.configure({ challenge, display: "invisible", auto: "off", minDuration: 0 })
    return (await widget.verify())?.payload ?? ""
  } catch {
    return ""
  } finally {
    widget.remove()
  }
}

interface Turnstile {
  readonly render: (
    element: HTMLElement,
    options: {
      readonly sitekey: string
      readonly appearance?: "always" | "execute" | "interaction-only"
      readonly callback: (token: string) => void
      readonly "expired-callback"?: () => void
      readonly "error-callback"?: () => void
    },
  ) => string
  readonly reset: (widgetId?: string) => void
  readonly remove: (widgetId?: string) => void
}

let loading: Promise<Turnstile> | undefined

/** Cloudflare's Turnstile script, loaded once. */
const loadTurnstile = (): Promise<Turnstile> => {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    script.async = true
    script.onload = () => {
      const turnstile = (window as unknown as { turnstile?: Turnstile }).turnstile
      if (turnstile) resolve(turnstile)
      else reject(new Error("Turnstile didn't load"))
    }
    script.onerror = () => reject(new Error("Turnstile didn't load"))
    document.head.appendChild(script)
  })
  return loading
}

/**
 * Renders Turnstile into `element`. "invisible" shows nothing unless Cloudflare needs the visitor
 * to act; "managed" always shows the widget. Returns a remover.
 */
export const mountTurnstile = async (
  element: HTMLElement,
  options: {
    readonly siteKey: string
    readonly mode: "invisible" | "managed"
    readonly onToken: (token: string) => void
  },
): Promise<() => void> => {
  const turnstile = await loadTurnstile()
  const id = turnstile.render(element, {
    sitekey: options.siteKey,
    appearance: options.mode === "invisible" ? "interaction-only" : "always",
    callback: options.onToken,
    "expired-callback": () => {
      options.onToken("")
      turnstile.reset(id)
    },
    "error-callback": () => options.onToken(""),
  })
  return () => turnstile.remove(id)
}
