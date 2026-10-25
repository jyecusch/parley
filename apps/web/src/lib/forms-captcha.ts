import type { CaptchaChallenge } from "@parley/core"
import type { WidgetMethods } from "altcha/types"

/*
 * The browser's half of a form's captcha (D147). The built-in proof of work is ALTCHA's own
 * widget, invisible: it solves the server's challenge in Web Workers as the form loads, and its
 * payload goes back with the submission for altcha-lib to verify. Turnstile is Cloudflare's widget,
 * through @marsidev/react-turnstile on the form page.
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
