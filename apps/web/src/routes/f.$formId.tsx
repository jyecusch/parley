import type { RenderedForm, SubmissionOutcome } from "@parley/core"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { type FormValues, FormView } from "../components/form-view.tsx"
import { mountTurnstile, solveProofOfWork } from "../lib/forms-captcha.ts"
import { checkAnswers, embedContextOf, isEmbedded, reportHeight, tellParent } from "../lib/forms-page.ts"

/*
 * A published form, as visitors see it (D144): inside an iframe on a team's site (embed.js puts it
 * there) or on its own as the hosted page. No app chrome; only the form's own appearance. The
 * built-in proof of work starts solving as soon as the form loads, so it's done before anyone
 * finishes typing (D147).
 */
export const Route = createFileRoute("/f/$formId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign up" }, { name: "robots", content: "noindex" }] }),
  component: FormPage,
})

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly form: RenderedForm }

/** The page's own look: nothing but the form, on a transparent background. */
// color-scheme matches the host page's default: a frame whose scheme differs (the app's dark one)
// gets an opaque backdrop from the browser, which shows behind rounded corners.
const PAGE_CSS = `:root{color-scheme:normal!important}
html,body{margin:0;padding:0;background:transparent!important;min-height:0}
body::before,body::after{display:none!important}
.FormPage{padding:4px}`

function FormPage() {
  const { formId } = Route.useParams()
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" })
  const [values, setValues] = useState<FormValues>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const solution = useRef<Promise<string> | undefined>(undefined)
  const turnstileToken = useRef("")
  const turnstileBox = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const context = useRef(typeof window === "undefined" ? undefined : embedContextOf(window.location.search))
  const embedded = isEmbedded()

  // This page runs on Parley's domain, so the app's own appearance settings would apply; they mustn't.
  useEffect(() => {
    delete document.documentElement.dataset.crt
  }, [])

  /** Fetches the form with a fresh render token and captcha, and starts solving the proof of work. */
  const load = useCallback(
    async (again = false) => {
      const query = new URLSearchParams()
      if (context.current?.page) query.set("page", context.current.page)
      // Reloading for a fresh token after a failed try isn't another view.
      if (again) query.set("again", "1")
      if (context.current?.appearance) query.set("appearance", context.current.appearance)
      try {
        const response = await fetch(`/api/forms/${encodeURIComponent(formId)}?${query}`, {
          headers: { accept: "application/json" },
        })
        if (response.status === 404) return setLoaded({ kind: "missing" })
        if (!response.ok) return setLoaded({ kind: "failed" })
        const form = (await response.json()) as RenderedForm
        if (form.captcha.provider === "builtin") solution.current = solveProofOfWork(form.captcha.challenge)
        setLoaded({ kind: "ready", form })
        document.title = form.content.title || "Sign up"
      } catch {
        setLoaded({ kind: "failed" })
      }
    },
    [formId],
  )

  useEffect(() => {
    void load()
  }, [load])

  const form = loaded.kind === "ready" ? loaded.form : undefined
  const turnstile = form?.captcha.provider === "turnstile" ? form.captcha : undefined
  useEffect(() => {
    if (!turnstile || !turnstileBox.current) return
    let remove: (() => void) | undefined
    let canceled = false
    void mountTurnstile(turnstileBox.current, {
      siteKey: turnstile.siteKey,
      mode: turnstile.mode,
      onToken: (token) => {
        turnstileToken.current = token
      },
    })
      .then((remover) => {
        if (canceled) remover()
        else remove = remover
      })
      .catch(() => {
        // Without Turnstile the submission still goes; the server holds it as spam if it must.
      })
    return () => {
      canceled = true
      remove?.()
    }
  }, [turnstile])

  useEffect(() => (frame.current ? reportHeight(formId, frame.current) : undefined), [formId])

  const submit = async () => {
    if (!form) return
    const problems = checkAnswers(form.content, values)
    setErrors(problems)
    if (Object.keys(problems).length > 0) return
    setBusy(true)
    const { _website, ...answers } = values
    const captchaToken =
      form.captcha.provider === "builtin" ? ((await solution.current?.catch(() => "")) ?? "") : turnstileToken.current
    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(formId)}/submissions`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          renderToken: form.renderToken,
          values: answers,
          honeypot: typeof _website === "string" ? _website : "",
          captchaToken,
          page: context.current?.page ?? "",
          utm: form.content.captureTracking ? (context.current?.utm ?? {}) : {},
          clickIds: form.content.captureTracking ? (context.current?.clickIds ?? {}) : {},
        }),
      })
      const outcome = (await response.json().catch(() => ({ kind: "unavailable" }))) as SubmissionOutcome
      if (outcome.kind === "accepted") {
        tellParent({ type: "parley:submitted", formId })
        if (outcome.afterSubmit.kind === "redirect") {
          // embed.js moves the page the form is on; on the hosted page, this page moves.
          if (isEmbedded()) tellParent({ type: "parley:redirect", formId, url: outcome.afterSubmit.url })
          else window.location.assign(outcome.afterSubmit.url)
        }
        setSent(true)
      } else {
        setErrors(
          outcome.kind === "invalid"
            ? outcome.problems
            : { form: "This form isn't taking submissions right now. Try again later." },
        )
        // A render token is good for one submission; get a fresh one for the next try.
        await load(true)
      }
    } catch {
      setErrors({ form: "We couldn't send that. Check your connection and try again." })
    }
    setBusy(false)
  }

  return (
    // On its own (the hosted page) the form is the page: its main landmark, its title the h1.
    <div className="FormPage" ref={frame} lang="en" role={embedded ? undefined : "main"}>
      <style>{PAGE_CSS}</style>
      {loaded.kind === "loading" ? <div role="status" aria-label="Loading" className="min-h-30" /> : null}
      {loaded.kind === "missing" ? <Notice>This form isn't available.</Notice> : null}
      {loaded.kind === "failed" ? <Notice>This form didn't load. Refresh the page to try again.</Notice> : null}
      {form ? (
        <FormView
          content={form.content}
          customFields={form.customFields}
          privacyPolicyUrl={form.privacyPolicyUrl}
          values={values}
          onChange={(key, value) => {
            setValues((current) => ({ ...current, [key]: value }))
            if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest)
          }}
          onSubmit={() => void submit()}
          state={sent && form.content.afterSubmit.kind === "message" ? "sent" : "form"}
          busy={busy}
          errors={errors}
          idPrefix={`f-${formId.slice(0, 8)}`}
          titleLevel={embedded ? 2 : 1}
          beforeButton={turnstile ? <div ref={turnstileBox} /> : null}
        />
      ) : null}
    </div>
  )
}

/** On its own light card, so it reads on any site's page behind the frame, dark or light. */
function Notice(props: { readonly children: string }) {
  return (
    <p className="m-0 rounded-lg bg-white p-4 font-sans text-neutral-700" role="status">
      {props.children}
    </p>
  )
}
