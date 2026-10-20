import type { TopicId, UnsubscribeChange, UnsubscribePage } from "@parley/domain"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Button, Checkbox, Fieldset, Notice, Option } from "../components/ui/index.ts"
import { AuthHeading, AuthPage } from "../components/ui/public.tsx"

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

  if (state.kind === "loading") return <AuthPage role="status" aria-label="Loading" />
  if (state.kind === "invalid" || state.kind === "failed") {
    return (
      <AuthPage>
        <AuthHeading title={state.kind === "invalid" ? "This link doesn't work" : "Something went wrong"}>
          {state.kind === "invalid"
            ? "It may have been cut short when it was copied. Try opening it from the email again, or reply to the email and ask to be removed."
            : "Your preferences weren't changed. Try again in a minute, or reply to the email and ask to be removed."}
        </AuthHeading>
      </AuthPage>
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
    <AuthPage>
      {page.test ? (
        <Notice className="text-sm">This link is from a test send, so nothing you choose here is saved.</Notice>
      ) : null}
      <AuthHeading title={`Email from ${page.senderName}`}>
        {subscribed
          ? `You're subscribed${page.address ? ` as ${page.address}` : ""}.`
          : page.status === "bounced"
            ? "Email to your address bounced, so you won't get more."
            : `You're unsubscribed${page.address ? ` as ${page.address}` : ""}, and won't get marketing email from ${page.senderName}.`}
      </AuthHeading>
      {state.changed ? (
        <p className="m-0 rounded-md bg-fill px-3 py-2.5 text-fg" role="status">
          {state.changed}
        </p>
      ) : null}
      {subscribed ? (
        <>
          {topic?.subscribed ? (
            <Button
              variant="primary"
              size="lg"
              wide
              disabled={busy}
              onClick={() => setTopic(topic.id, topic.name, false)}
            >
              Unsubscribe from {topic.name}
            </Button>
          ) : null}
          <Button
            variant={topic?.subscribed ? "secondary" : "primary"}
            size="lg"
            wide
            disabled={busy}
            onClick={() =>
              void apply({ kind: "all", subscribed: false }, "You're unsubscribed from all marketing email.")
            }
          >
            Unsubscribe from everything
          </Button>
          {page.topics.length > 0 ? (
            <Fieldset
              legend={<span className="text-sm font-normal text-subtle">Or choose what you get</span>}
              className="mt-2 border-t border-line pt-3"
            >
              {page.topics.map((entry) => (
                <Option key={entry.id} className="items-start">
                  <Checkbox
                    className="mt-1"
                    disabled={busy}
                    checked={entry.subscribed}
                    onChange={(event) => setTopic(entry.id, entry.name, event.target.checked)}
                  />
                  <span>
                    {entry.name}
                    {entry.description ? <span className="block text-sm text-subtle">{entry.description}</span> : null}
                  </span>
                </Option>
              ))}
            </Fieldset>
          ) : null}
        </>
      ) : canResubscribe ? (
        <Button
          size="lg"
          wide
          disabled={busy}
          onClick={() => void apply({ kind: "all", subscribed: true }, "You're subscribed again.")}
        >
          Subscribe again
        </Button>
      ) : null}
    </AuthPage>
  )
}
