import {
  type Campaign,
  type CampaignId,
  type Contact,
  type ContactId,
  type RecipientStatus,
  ROLE_PERMISSIONS,
  type SegmentId,
  type TeamId,
  type TopicId,
  type UserId,
} from "@parley/domain"
import { useLiveQuery } from "@tanstack/react-db"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { Composer, type Content, SaveState, useAutosave } from "../components/composer.tsx"
import { EmailPreview } from "../components/email-preview.tsx"
import { LoadFailed } from "../components/record.tsx"
import { Dialog } from "../components/settings.tsx"
import { CAMPAIGN_STATUS_LABELS } from "../lib/campaigns.ts"
import { call, messageOf } from "../lib/client.ts"
import { contactsCollection } from "../lib/contacts.ts"
import { absolute, ago } from "../lib/time.ts"

export const Route = createFileRoute("/t/$teamId/campaigns/$campaignId")({ component: CampaignScreen })

const teamRoute = getRouteApi("/t/$teamId")

function CampaignScreen() {
  const { team } = teamRoute.useLoaderData()
  const { userId } = teamRoute.useRouteContext()
  const { campaignId } = Route.useParams()
  const teamId = team.id as TeamId
  const campaign = useQuery({
    queryKey: ["campaign", teamId, campaignId],
    queryFn: () => call("campaigns.get", { teamId, campaignId: campaignId as CampaignId }),
    refetchInterval: (query) => (query.state.data?.status === "sending" ? 2000 : false),
  })
  if (campaign.isPending) return <main className="card main" />
  if (campaign.isError) {
    return (
      <main className="card main">
        <div className="body">
          <LoadFailed
            title="This campaign didn't load"
            message={messageOf(campaign.error)}
            onRetry={() => void campaign.refetch()}
          />
        </div>
      </main>
    )
  }
  const permissions = ROLE_PERMISSIONS[team.role]
  return campaign.data.status === "draft" ? (
    <DraftEditor
      key={campaign.data.id}
      teamId={teamId}
      userId={userId as UserId}
      campaign={campaign.data}
      canWrite={permissions.has("email:write")}
      canSend={permissions.has("email:send")}
    />
  ) : (
    <Report key={campaign.data.id} teamId={teamId} campaign={campaign.data} canSend={permissions.has("email:send")} />
  )
}

interface DraftFields extends Content {
  readonly name: string
  readonly segmentId: SegmentId | null
  readonly topicId: TopicId | null
}

const fieldsOf = (campaign: Campaign): DraftFields => ({
  name: campaign.name,
  subject: campaign.subject,
  previewText: campaign.previewText,
  body: campaign.body,
  segmentId: campaign.segmentId,
  topicId: campaign.topicId,
})

/** A draft in the composer (R42), with its segment and topic. Edits save once typing pauses. */
function DraftEditor(props: {
  readonly teamId: TeamId
  readonly userId: UserId
  readonly campaign: Campaign
  readonly canWrite: boolean
  readonly canSend: boolean
}) {
  const { teamId } = props
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(props.campaign)
  const [draft, setDraft] = useState(fieldsOf(props.campaign))
  const [error, setError] = useState<string>()
  const [dialog, setDialog] = useState<"test" | "send">()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [previewAs, setPreviewAs] = useState<ContactId | "">("")
  const [toast, setToast] = useState<string>()
  const segments = useQuery({ queryKey: ["segments", teamId], queryFn: () => call("segments.list", { teamId }) })
  const topics = useQuery({ queryKey: ["topics", teamId], queryFn: () => call("topics.list", { teamId }) })
  const contacts = contactsCollection(teamId, queryClient)
  const live = useLiveQuery((q) => q.from({ contact: contacts }), [contacts])
  const people = useMemo(
    () =>
      ([...(live.data ?? [])] as Array<Contact>)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, 300),
    [live.data],
  )

  const state = useAutosave(draft, fieldsOf(saved), async (value) => {
    try {
      const next = await call("campaigns.update", {
        teamId,
        campaignId: saved.id,
        ...value,
        name: value.name.trim() || "Untitled campaign",
      })
      setSaved(next)
      setError(undefined)
      queryClient.setQueryData(["campaign", teamId, saved.id], next)
      await queryClient.invalidateQueries({ queryKey: ["campaigns", teamId] })
    } catch (failure) {
      setError(messageOf(failure))
      throw failure
    }
  })

  const segment = segments.data?.find((entry) => entry.id === draft.segmentId)
  const readOnly = !props.canWrite

  return (
    <main className="card main">
      <div className="hd1">
        <h1 className="crumb">
          <Link className="root" to="/t/$teamId/campaigns" params={{ teamId }}>
            Campaigns
          </Link>
          <span className="sep" aria-hidden="true">
            /
          </span>
          <input
            className="crumb-inp plain"
            aria-label="Campaign name"
            maxLength={120}
            readOnly={readOnly}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </h1>
        <span className="pill">Draft</span>
        <SaveState state={state} />
        <div className="spacer" />
        {props.canWrite ? (
          confirmDelete ? (
            <span className="confirm">
              <button className="btn ghost" type="button" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                className="btn danger-solid"
                type="button"
                onClick={() =>
                  void call("campaigns.delete", { teamId, campaignId: saved.id })
                    .then(() => queryClient.invalidateQueries({ queryKey: ["campaigns", teamId] }))
                    .then(() => navigate({ to: "/t/$teamId/campaigns", params: { teamId } }))
                    .catch((failure: unknown) => setError(messageOf(failure)))
                }
              >
                Delete draft
              </button>
            </span>
          ) : (
            <>
              <button className="btn ghost" type="button" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
              <button className="btn" type="button" disabled={state !== "saved"} onClick={() => setDialog("test")}>
                Send test
              </button>
            </>
          )
        ) : null}
        {props.canSend && !confirmDelete ? (
          <button
            className="btn primary"
            type="button"
            disabled={state !== "saved"}
            title={state !== "saved" ? "Wait for your changes to save" : undefined}
            onClick={() => setDialog("send")}
          >
            Send…
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="err sm-t" role="alert" style={{ padding: "8px 14px 0" }}>
          {error}
        </p>
      ) : null}
      <Composer
        content={draft}
        readOnly={readOnly}
        onChange={(content) => setDraft({ ...draft, ...content })}
        previewKey={previewAs}
        preview={(content) =>
          call("campaigns.preview", {
            teamId,
            campaignId: saved.id,
            ...content,
            ...(previewAs ? { contactId: previewAs } : {}),
          })
        }
        settings={
          <div className="cmp-row">
            <div className="cmp-f">
              <label className="flabel sm-t" htmlFor="cmp-segment">
                To
              </label>
              <select
                id="cmp-segment"
                className="inp"
                disabled={readOnly}
                value={draft.segmentId ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, segmentId: (event.target.value || null) as SegmentId | null })
                }
              >
                <option value="">Choose a segment…</option>
                {(segments.data ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} ({entry.sendableCount})
                  </option>
                ))}
              </select>
              {segment ? (
                <p className="hint sm-t">
                  {segment.sendableCount} of {segment.contactCount} can be sent it now: subscribed, with an email.
                </p>
              ) : (
                <p className="hint sm-t">
                  <Link to="/t/$teamId/segments" params={{ teamId }}>
                    Segments
                  </Link>{" "}
                  are who campaigns go to.
                </p>
              )}
            </div>
            <div className="cmp-f">
              <label className="flabel sm-t" htmlFor="cmp-topic">
                Topic <span className="c-muted">(optional)</span>
              </label>
              <select
                id="cmp-topic"
                className="inp"
                disabled={readOnly}
                value={draft.topicId ?? ""}
                onChange={(event) => setDraft({ ...draft, topicId: (event.target.value || null) as TopicId | null })}
              >
                <option value="">No topic</option>
                {(topics.data ?? []).map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
              <p className="hint sm-t">Unsubscribing from this email leaves only its topic.</p>
            </div>
          </div>
        }
        previewBar={
          <select
            className="fsel sm-t"
            aria-label="Preview as"
            value={previewAs}
            onChange={(event) => setPreviewAs(event.target.value as ContactId | "")}
          >
            <option value="">Sample values</option>
            {people.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.displayName}
              </option>
            ))}
          </select>
        }
      />
      {dialog === "test" ? (
        <TestSendDialog
          teamId={teamId}
          campaign={saved}
          userId={props.userId}
          contactId={previewAs || undefined}
          onClose={() => setDialog(undefined)}
          onSent={(text) => {
            setDialog(undefined)
            setToast(text)
          }}
        />
      ) : dialog === "send" ? (
        <SendDialog
          teamId={teamId}
          campaign={saved}
          onClose={() => setDialog(undefined)}
          onSent={async (next) => {
            setDialog(undefined)
            queryClient.setQueryData(["campaign", teamId, saved.id], next)
            await queryClient.invalidateQueries({ queryKey: ["campaigns", teamId] })
          }}
        />
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button className="btn ghost sm" type="button" onClick={() => setToast(undefined)}>
            OK
          </button>
        </div>
      ) : null}
    </main>
  )
}

function TestSendDialog(props: {
  readonly teamId: TeamId
  readonly campaign: Campaign
  readonly userId: UserId
  readonly contactId: ContactId | undefined
  readonly onClose: () => void
  readonly onSent: (text: string) => void
}) {
  const members = useQuery({
    queryKey: ["members", props.teamId],
    queryFn: () => call("members.list", { teamId: props.teamId }),
  })
  const [chosen, setChosen] = useState<ReadonlySet<UserId>>(new Set([props.userId]))
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      const result = await call("campaigns.testSend", {
        teamId: props.teamId,
        campaignId: props.campaign.id,
        userIds: [...chosen],
        ...(props.contactId ? { contactId: props.contactId } : {}),
      })
      props.onSent(`Test sent to ${result.sentTo.join(", ")}.`)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Send a test"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={chosen.size === 0 || chosen.size > 5 || busy}
            onClick={() => void send()}
          >
            Send test
          </button>
        </>
      }
    >
      <p className="hint sm-t" style={{ margin: 0 }}>
        Tests go to members of your team, up to 5, with “[Test]” in the subject. Merge tags use the contact you're
        previewing as, or sample values.
      </p>
      <div className="fld">
        <span className="fl">Send to</span>
        <div className="checks">
          {(members.data ?? []).map((member) => (
            <label key={member.userId} className="opt">
              <input
                className="cb shown"
                type="checkbox"
                checked={chosen.has(member.userId)}
                onChange={(event) => {
                  const next = new Set(chosen)
                  if (event.target.checked) next.add(member.userId)
                  else next.delete(member.userId)
                  setChosen(next)
                }}
              />
              <span>
                {member.name} <span className="c-muted">{member.email}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {error ? (
        <p className="err sm-t" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}

/** The last step before sending (R42): who it goes to, from whom, and a reminder about consent. */
function SendDialog(props: {
  readonly teamId: TeamId
  readonly campaign: Campaign
  readonly onClose: () => void
  readonly onSent: (campaign: Campaign) => Promise<void>
}) {
  const settings = useQuery({
    queryKey: ["email-settings", props.teamId],
    queryFn: () => call("emailSettings.get", { teamId: props.teamId }),
  })
  const segment = useQuery({
    queryKey: ["segment", props.teamId, props.campaign.segmentId],
    enabled: props.campaign.segmentId !== null,
    queryFn: () => call("segments.get", { teamId: props.teamId, segmentId: props.campaign.segmentId as SegmentId }),
  })
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const count = segment.data?.sendableCount ?? 0
  const missing = settings.data?.missing ?? []
  const send = async () => {
    setBusy(true)
    try {
      const next = await call("campaigns.send", { teamId: props.teamId, campaignId: props.campaign.id })
      await props.onSent(next)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={`Send ${props.campaign.name}`}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!consent || busy || missing.length > 0 || count === 0}
            onClick={() => void send()}
          >
            Send to {count} {count === 1 ? "person" : "people"}
          </button>
        </>
      }
    >
      <dl className="sendsum">
        <dt>To</dt>
        <dd>
          {segment.data ? (
            <>
              {segment.data.name}: {count} of {segment.data.contactCount} contacts are subscribed and have an email.
            </>
          ) : (
            "No segment chosen yet."
          )}
        </dd>
        {props.campaign.topicName ? (
          <>
            <dt>Topic</dt>
            <dd>{props.campaign.topicName}. Anyone who left it is skipped.</dd>
          </>
        ) : null}
        <dt>From</dt>
        <dd>
          {settings.data?.senderName ?? "—"} &lt;{settings.data?.senderAddress ?? "—"}&gt;
        </dd>
        <dt>Subject</dt>
        <dd>{props.campaign.subject || "—"}</dd>
      </dl>
      {missing.length > 0 ? (
        <p className="warn sm-t">
          Finish the sender and footer in{" "}
          <Link to="/t/$teamId/settings/email" params={{ teamId: props.teamId }}>
            Settings → Email
          </Link>{" "}
          first.
        </p>
      ) : null}
      <label className="opt" style={{ alignItems: "flex-start" }}>
        <input
          className="cb shown"
          type="checkbox"
          style={{ marginTop: 2 }}
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>
          These people agreed to get email from us. <span className="c-muted">Anti-spam laws require consent.</span>
        </span>
      </label>
      <p className="hint sm-t" style={{ margin: 0 }}>
        Sending starts at once and can't be undone, though you can cancel what hasn't gone yet.
      </p>
      {error ? (
        <p className="err sm-t" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}

const RECIPIENT_LABELS: Readonly<Record<RecipientStatus, string>> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  skipped: "Skipped",
  failed: "Failed",
  bounced: "Bounced",
  "marked-as-spam": "Marked as spam",
  cancelled: "Cancelled",
}

const SKIP_LABELS: Readonly<Record<string, string>> = {
  "no-email": "No email address",
  unsubscribed: "Unsubscribed",
  "unsubscribed-from-topic": "Left this topic",
  bounced: "Bounced before",
  "marked-as-spam": "Marked as spam before",
}

/** A sent (or sending) campaign: what happened, who it went to, and what they got. */
function Report(props: { readonly teamId: TeamId; readonly campaign: Campaign; readonly canSend: boolean }) {
  const { teamId, campaign } = props
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [status, setStatus] = useState<RecipientStatus | "">("")
  const [error, setError] = useState<string>()
  const counts = campaign.counts
  const recipients = useQuery({
    queryKey: ["recipients", teamId, campaign.id, status, counts?.queued ?? 0, counts?.sent ?? 0],
    queryFn: () =>
      call("campaigns.recipients", {
        teamId,
        campaignId: campaign.id,
        limit: 500,
        ...(status ? { status } : {}),
      }),
  })
  const preview = useQuery({
    queryKey: ["campaign-preview", teamId, campaign.id],
    queryFn: () => call("campaigns.preview", { teamId, campaignId: campaign.id }),
  })
  const tiles: ReadonlyArray<{ readonly label: string; readonly value: number; readonly status?: RecipientStatus }> =
    counts
      ? [
          { label: "Recipients", value: counts.recipients },
          { label: "Sent", value: counts.sent + counts.delivered, status: "sent" },
          { label: "Delivered", value: counts.delivered, status: "delivered" },
          { label: "Queued", value: counts.queued, status: "queued" },
          { label: "Skipped", value: counts.skipped, status: "skipped" },
          { label: "Failed", value: counts.failed, status: "failed" },
          { label: "Bounced", value: counts.bounced, status: "bounced" },
          { label: "Marked as spam", value: counts.markedAsSpam, status: "marked-as-spam" },
          ...(counts.cancelled > 0
            ? [{ label: "Cancelled", value: counts.cancelled, status: "cancelled" as const }]
            : []),
        ]
      : []

  const act = async (work: () => Promise<unknown>) => {
    try {
      await work()
      await queryClient.invalidateQueries({ queryKey: ["campaign", teamId, campaign.id] })
      await queryClient.invalidateQueries({ queryKey: ["campaigns", teamId] })
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  return (
    <main className="card main">
      <div className="hd1">
        <h1 className="crumb">
          <Link className="root" to="/t/$teamId/campaigns" params={{ teamId }}>
            Campaigns
          </Link>
          <span className="sep" aria-hidden="true">
            /
          </span>
          <span>{campaign.name}</span>
        </h1>
        <span className={`pill ${campaign.status === "sent" ? "ok" : ""}`}>
          {CAMPAIGN_STATUS_LABELS[campaign.status]}
        </span>
        <div className="spacer" />
        {campaign.status === "sending" && props.canSend ? (
          <button
            className="btn ghost"
            type="button"
            onClick={() => void act(() => call("campaigns.cancel", { teamId, campaignId: campaign.id }))}
          >
            Cancel sending
          </button>
        ) : null}
        <button
          className="btn"
          type="button"
          onClick={() =>
            void act(async () => {
              const copy = await call("campaigns.duplicate", { teamId, campaignId: campaign.id })
              await navigate({ to: "/t/$teamId/campaigns/$campaignId", params: { teamId, campaignId: copy.id } })
            })
          }
        >
          Duplicate
        </button>
      </div>
      {error ? (
        <p className="err sm-t" role="alert" style={{ padding: "8px 14px 0" }}>
          {error}
        </p>
      ) : null}
      <div className="report">
        <div className="rep-main">
          <p className="sm-t c-muted rep-meta">
            {campaign.sentByName ?? "Someone"} sent this to <b>{campaign.segmentName ?? "a segment"}</b>
            {campaign.topicName ? ` (topic: ${campaign.topicName})` : ""}
            {campaign.sendingStartedAt ? (
              <span title={absolute(campaign.sendingStartedAt)}> · {ago(campaign.sendingStartedAt)}</span>
            ) : null}
            {campaign.status === "sending" ? " · sending now" : ""}
          </p>
          <div className="tiles">
            {tiles.map((tile) => (
              <button
                key={tile.label}
                type="button"
                className={`tilestat ${tile.status !== undefined && status === tile.status ? "on" : ""}`}
                disabled={tile.status === undefined && status === ""}
                onClick={() => setStatus(tile.status === undefined || status === tile.status ? "" : tile.status)}
              >
                <span className="v tab">{tile.value}</span>
                <span className="l sm-t">{tile.label}</span>
              </button>
            ))}
          </div>
          <div className="box">
            <table className="stable">
              <thead>
                <tr>
                  <th scope="col">Recipient</th>
                  <th scope="col">Status</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {(recipients.data?.items ?? []).map((recipient, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a purged contact leaves no id
                  <tr key={`${recipient.contactId ?? "gone"}-${index}`}>
                    <td>
                      {recipient.contactId ? (
                        <Link to="/t/$teamId/contacts" params={{ teamId }} search={{ contact: recipient.contactId }}>
                          {recipient.name}
                        </Link>
                      ) : (
                        recipient.name
                      )}
                      {recipient.address ? <span className="c-muted"> {recipient.address}</span> : null}
                    </td>
                    <td className={["failed", "bounced", "marked-as-spam"].includes(recipient.status) ? "c-warn" : ""}>
                      {RECIPIENT_LABELS[recipient.status]}
                    </td>
                    <td className="c-muted">
                      {recipient.skipReason ? SKIP_LABELS[recipient.skipReason] : (recipient.error ?? "")}
                      {recipient.sentAt ? (
                        <span title={absolute(recipient.sentAt)}>{ago(recipient.sentAt)}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recipients.data?.nextCursor ? (
              <p className="hint sm-t" style={{ padding: 10 }}>
                Showing the first 500. Agents can page through every recipient with campaigns.recipients.
              </p>
            ) : null}
          </div>
        </div>
        <div className="cmp-prev">
          <div className="cmp-prevbar">
            <span className="sm-t c-muted">The email, with sample values</span>
          </div>
          {preview.data ? (
            <>
              <div className="cmp-inbox">
                <div className="cmp-subject">{preview.data.subject}</div>
                {preview.data.previewText ? <div className="sm-t c-muted">{preview.data.previewText}</div> : null}
              </div>
              <EmailPreview html={preview.data.html} label="Email as sent" />
            </>
          ) : (
            <div className="cmp-frame" />
          )}
        </div>
      </div>
    </main>
  )
}
