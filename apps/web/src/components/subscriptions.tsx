import { type Contact, ROLE_PERMISSIONS, SUBSCRIPTION_STATUS_LABELS, type TeamId, type TopicId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { call, messageOf } from "../lib/client.ts"

const teamRoute = getRouteApi("/t/$teamId")

/**
 * A contact's marketing email (R37, R38): their subscription status and the topics they get.
 * Bounced and marked-as-spam are set by Parley; a person can only subscribe them again.
 */
export function SubscriptionSection(props: {
  readonly contact: Contact
  readonly teamId: TeamId
  readonly canWrite: boolean
  readonly onStatus: (status: "subscribed" | "unsubscribed") => void
  readonly onError: (text: UserText) => void
}) {
  const { contact, teamId } = props
  const queryClient = useQueryClient()
  const { team } = teamRoute.useLoaderData()
  // Subscribing someone again after they opted out takes email:manage (admins and owners).
  const canResubscribe = ROLE_PERMISSIONS[team.role].has("email:manage")
  const key = ["subscriptions", teamId, contact.id, contact.subscriptionStatus, contact.updatedAt]
  const subscriptions = useQuery({
    queryKey: key,
    queryFn: () => call("contacts.subscriptions", { teamId, contactId: contact.id }),
  })
  const status = contact.subscriptionStatus
  const id = `subscription-${contact.id}`

  const setTopic = async (topicId: TopicId, subscribed: boolean) => {
    try {
      await call("contacts.updateSubscriptions", { teamId, contactId: contact.id, topics: [{ topicId, subscribed }] })
      await queryClient.invalidateQueries({ queryKey: ["subscriptions", teamId, contact.id] })
      await queryClient.invalidateQueries({ queryKey: ["contact-activity", teamId, contact.id] })
    } catch (failure) {
      props.onError(messageOf(failure))
    }
  }

  const topics = subscriptions.data?.topics ?? []
  return (
    <section className="sec">
      <h3 className="sec-h">Marketing email</h3>
      <div className="field">
        <label className="flabel sm-t" htmlFor={id}>
          Subscription
        </label>
        <div className="fval" style={{ padding: "0 6px" }}>
          <select
            id={id}
            className={`fsel ${status === "subscribed" ? "" : "c-warn"}`}
            disabled={!props.canWrite}
            value={status}
            onChange={(event) => props.onStatus(event.target.value as "subscribed" | "unsubscribed")}
          >
            <option value="subscribed" disabled={contact.subscriptionStatus !== "subscribed" && !canResubscribe}>
              Subscribed
            </option>
            <option value="unsubscribed">Unsubscribed</option>
            {status === "bounced" || status === "marked-as-spam" ? (
              <option value={status} disabled>
                {SUBSCRIPTION_STATUS_LABELS[status]}
              </option>
            ) : null}
          </select>
        </div>
      </div>
      {status === "bounced" ? (
        <p className="empty-v sm-t">
          Email to this address bounced, so campaigns skip it. Fix the address, then subscribe again.
        </p>
      ) : status === "marked-as-spam" ? (
        <p className="empty-v sm-t">They marked a campaign as spam, so campaigns skip them.</p>
      ) : null}
      {status === "subscribed" && topics.length > 0 ? (
        <div className="topics">
          {topics.map((topic) => (
            <label key={topic.topicId} className="opt">
              <input
                className="cb shown"
                type="checkbox"
                disabled={!props.canWrite || (!topic.subscribed && !canResubscribe)}
                checked={topic.subscribed}
                onChange={(event) => void setTopic(topic.topicId, event.target.checked)}
              />
              {topic.name}
            </label>
          ))}
        </div>
      ) : null}
    </section>
  )
}
