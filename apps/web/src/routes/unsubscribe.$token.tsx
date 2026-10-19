import type { TopicId, UnsubscribeChange, UnsubscribePage } from "@parley/domain"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"

/**
 * The page behind every unsubscribe link (R39). Recipients don't sign in: the signed link is the
 * authority. Nothing changes on load, because link scanners open links too; one click does it.
 */
export const Route = createFileRoute("/unsubscribe/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Email preferences" }, { name: "robots", content: "noindex" }] }),
  component: Unsubscribe,
})

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "invalid" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly page: UnsubscribePage; readonly changed?: string }

const endpoint = (token: string) => `/api/unsubscribe/${encodeURIComponent(token)}`

function Unsubscribe() {
  const { token } = Route.useParams()
  const [state, setState] = useState<State>({ kind: "loading" })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(endpoint(token), { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (response.status === 404) return setState({ kind: "invalid" })
        if (!response.ok) return setState({ kind: "failed" })
        setState({ kind: "ready", page: (await response.json()) as UnsubscribePage })
      })
      .catch(() => setState({ kind: "failed" }))
  }, [token])

  const apply = async (change: UnsubscribeChange, done: string) => {
    setBusy(true)
    try {
      const response = await fetch(endpoint(token), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(change),
      })
      if (!response.ok) throw new Error(String(response.status))
      setState({ kind: "ready", page: (await response.json()) as UnsubscribePage, changed: done })
    } catch {
      setState({ kind: "failed" })
    }
    setBusy(false)
  }

  if (state.kind === "loading") {
    return (
      <main className="auth">
        <div className="auth-card" role="status" aria-label="Loading" />
      </main>
    )
  }
  if (state.kind === "invalid" || state.kind === "failed") {
    return (
      <main className="auth">
        <div className="auth-card">
          <h1>{state.kind === "invalid" ? "This link doesn't work" : "Something went wrong"}</h1>
          <p>
            {state.kind === "invalid"
              ? "It may have been cut short when it was copied. Try opening it from the email again, or reply to the email and ask to be removed."
              : "Your preferences weren't changed. Try again in a minute, or reply to the email and ask to be removed."}
          </p>
        </div>
      </main>
    )
  }

  const { page } = state
  const subscribed = page.status === "subscribed"
  const topic = page.topics.find((entry) => entry.id === page.topicId)
  const canResubscribe = page.status === "unsubscribed" || page.status === "marked-as-spam"
  const setTopic = (id: TopicId, name: string, value: boolean) =>
    void apply(
      { kind: "topic", topicId: id, subscribed: value },
      value ? `You'll get ${name} again.` : `You won't get ${name} any more.`,
    )

  return (
    <main className="auth">
      <div className="auth-card unsub">
        {page.test ? (
          <p className="warn sm-t">This link is from a test send, so nothing you choose here is saved.</p>
        ) : null}
        <div>
          <h1>Email from {page.senderName}</h1>
          <p>
            {subscribed
              ? `You're subscribed${page.address ? ` as ${page.address}` : ""}.`
              : page.status === "bounced"
                ? "Email to your address bounced, so you won't get more."
                : `You're unsubscribed${page.address ? ` as ${page.address}` : ""}, and won't get marketing email from ${page.senderName}.`}
          </p>
        </div>
        {state.changed ? (
          <p className="done-note" role="status">
            {state.changed}
          </p>
        ) : null}
        {subscribed ? (
          <>
            {topic?.subscribed ? (
              <button
                className="btn primary wide"
                type="button"
                disabled={busy}
                onClick={() => setTopic(topic.id, topic.name, false)}
              >
                Unsubscribe from {topic.name}
              </button>
            ) : null}
            <button
              className={`btn wide ${topic?.subscribed ? "" : "primary"}`}
              type="button"
              disabled={busy}
              onClick={() =>
                void apply({ kind: "all", subscribed: false }, "You're unsubscribed from all marketing email.")
              }
            >
              Unsubscribe from everything
            </button>
            {page.topics.length > 0 ? (
              <fieldset className="unsub-topics">
                <legend className="sm-t">Or choose what you get</legend>
                {page.topics.map((entry) => (
                  <label key={entry.id} className="opt">
                    <input
                      className="cb shown"
                      type="checkbox"
                      disabled={busy}
                      checked={entry.subscribed}
                      onChange={(event) => setTopic(entry.id, entry.name, event.target.checked)}
                    />
                    <span>
                      {entry.name}
                      {entry.description ? <span className="hint sm-t">{entry.description}</span> : null}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </>
        ) : canResubscribe ? (
          <button
            className="btn wide"
            type="button"
            disabled={busy}
            onClick={() => void apply({ kind: "all", subscribed: true }, "You're subscribed again.")}
          >
            Subscribe again
          </button>
        ) : null}
      </div>
    </main>
  )
}
