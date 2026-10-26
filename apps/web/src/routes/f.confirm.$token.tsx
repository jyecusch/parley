import type { ConfirmationPage } from "@parley/core"
import { appearanceCss, type FormAppearance, pageBackgroundCss } from "@parley/domain"
import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useEffect, useState } from "react"

/*
 * Where a form's confirmation link lands (D146). Opening the link isn't enough: email scanners
 * open links too. So the page is rendered on the server in the form's look, which confirms
 * nothing, and its script confirms with a POST, which scanners don't make. Then it shows the
 * message in place, with no other page in between.
 */

/** The form's look for a confirmation link, or null for a link that isn't ours or has expired. */
const lookOf = createServerFn({ method: "GET" })
  .validator((token: string) => token)
  .handler(async ({ data }): Promise<FormAppearance | null> => {
    // Server only: the app itself, asked in-process, as server.ts does for a form's sites.
    const { handle } = await import("../server/app.ts")
    const response = await handle(
      new Request(new URL(`/api/forms/confirm/${encodeURIComponent(data)}`, "http://parley.internal")),
    )
    if (!response.ok) return null
    return ((await response.json()) as { appearance: FormAppearance }).appearance
  })

export const Route = createFileRoute("/f/confirm/$token")({
  loader: ({ params }) => lookOf({ data: params.token }),
  head: () => ({ meta: [{ title: "Confirm" }, { name: "robots", content: "noindex" }] }),
  component: ConfirmPage,
})

type State =
  | { readonly kind: "confirming" }
  | { readonly kind: "invalid" }
  | { readonly kind: "failed" }
  | { readonly kind: "done"; readonly page: Extract<ConfirmationPage, { kind: "confirmed" }> }

const PAGE_CSS = `html,body{margin:0;min-height:100%}
body::before,body::after{display:none!important}
.ConfirmPage{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#f5f5f4;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.ConfirmPage .Form{width:100%;max-width:420px}
@keyframes confirm-in{from{opacity:0}}
@media (prefers-reduced-motion: no-preference){.ConfirmPage .Form{animation:confirm-in .2s ease-out}}`

/** How long confirming takes before it says so. Most confirm well within it. */
const SLOW_MS = 1000

function ConfirmPage() {
  const { token } = Route.useParams()
  const [state, setState] = useState<State>({ kind: "confirming" })
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    delete document.documentElement.dataset.crt
    fetch(`/api/forms/confirm/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (response.status === 404) return setState({ kind: "invalid" })
        if (!response.ok) return setState({ kind: "failed" })
        const page = (await response.json()) as ConfirmationPage
        setState(page.kind === "confirmed" ? { kind: "done", page } : { kind: "invalid" })
      })
      .catch(() => setState({ kind: "failed" }))
  }, [token])

  // The form's look, from the server: the page is drawn in it from the start.
  const look = Route.useLoaderData()
  const styles = look ? (
    <>
      <style>{appearanceCss(look, ".Form")}</style>
      {/* The form's text must read on the page: a see-through form made for a dark site gets a dark one. */}
      <style>{pageBackgroundCss(look, ".ConfirmPage")}</style>
      {look.fonts.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
    </>
  ) : null

  // While confirming, nothing shows but a status for screen readers, unless it's slow.
  if (state.kind === "confirming" && !slow) {
    return (
      <main className="ConfirmPage" lang="en">
        <style>{PAGE_CSS}</style>
        {styles}
        <p role="status" className="sr-only">
          Confirming…
        </p>
      </main>
    )
  }

  if (state.kind !== "done") {
    const [title, body] =
      state.kind === "confirming"
        ? ["Confirming…", ""]
        : state.kind === "invalid"
          ? [
              "This link doesn't work",
              "It may have expired, or been used already. Sign up again on the form to get a new one.",
            ]
          : ["Something went wrong", "We couldn't confirm just now. Try the link again in a minute."]
    return (
      <main className="ConfirmPage" lang="en">
        <style>{PAGE_CSS}</style>
        {styles}
        <div role="status" className="max-w-105 rounded-2xl bg-white p-7 text-neutral-900">
          <h1 className="m-0 mb-1.5 text-2xl font-semibold">{title}</h1>
          {body ? <p className="m-0 text-neutral-600">{body}</p> : null}
        </div>
      </main>
    )
  }

  const { content } = state.page
  // The form's own title says what they joined, under a fixed "You're in".
  const message = { title: "You're in", body: "Thanks for confirming." }
  return (
    <main className="ConfirmPage" lang="en">
      <style>{PAGE_CSS}</style>
      <style>{appearanceCss(content.appearance, ".Form")}</style>
      {/* The form's text must read on the page: a see-through form made for a dark site gets a dark one. */}
      <style>{pageBackgroundCss(content.appearance, ".ConfirmPage")}</style>
      {content.appearance.fonts.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <div className="Form" role="status">
        <div className="Message">
          <h1 className="Title">{message.title}</h1>
          <p className="Description">{message.body}</p>
          {content.title ? <p className="FinePrint">{content.title}</p> : null}
        </div>
        {state.page.privacyPolicyUrl ? (
          <p className="FinePrint">
            <a href={state.page.privacyPolicyUrl}>Privacy policy</a>
          </p>
        ) : null}
      </div>
    </main>
  )
}
