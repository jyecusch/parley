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
import { EMAIL_FRAME_CLASS, EmailPreview } from "../components/email-preview.tsx"
import { LoadFailed } from "../components/record.tsx"
import { TitleInput } from "../components/ui/email.tsx"
import {
  Badge,
  Box,
  Breadcrumb,
  BreadcrumbSeparator,
  Button,
  breadcrumbRootClass,
  Card,
  Checkbox,
  Dialog,
  ErrorText,
  FieldLabel,
  Fieldset,
  Hint,
  Notice,
  Option,
  PageHeader,
  Select,
  Spacer,
  StatTile,
  Table,
  Td,
  Th,
  Toast,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
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
  if (campaign.isPending) return <Card as="main" className="flex-[999_1_35rem]" />
  if (campaign.isError) {
    return (
      <Card as="main" className="flex-[999_1_35rem]">
        <ViewBody>
          <LoadFailed
            title="This campaign didn't load"
            message={messageOf(campaign.error)}
            onRetry={() => void campaign.refetch()}
          />
        </ViewBody>
      </Card>
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
    <Card as="main" className="flex-[999_1_35rem]">
      <PageHeader>
        <Breadcrumb>
          <Link className={breadcrumbRootClass} to="/t/$teamId/campaigns" params={{ teamId }}>
            Campaigns
          </Link>
          <BreadcrumbSeparator />
          <TitleInput
            aria-label="Campaign name"
            maxLength={120}
            readOnly={readOnly}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Breadcrumb>
        <Badge className="ml-2">Draft</Badge>
        <SaveState state={state} />
        <Spacer />
        {props.canWrite ? (
          confirmDelete ? (
            <span className="inline-flex items-center gap-1">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger-solid"
                onClick={() =>
                  void call("campaigns.delete", { teamId, campaignId: saved.id })
                    .then(() => queryClient.invalidateQueries({ queryKey: ["campaigns", teamId] }))
                    .then(() => navigate({ to: "/t/$teamId/campaigns", params: { teamId } }))
                    .catch((failure: unknown) => setError(messageOf(failure)))
                }
              >
                Delete draft
              </Button>
            </span>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
              <Button disabled={state !== "saved"} onClick={() => setDialog("test")}>
                Send test
              </Button>
            </>
          )
        ) : null}
        {props.canSend && !confirmDelete ? (
          <Button
            variant="primary"
            disabled={state !== "saved"}
            title={state !== "saved" ? "Wait for your changes to save" : undefined}
            onClick={() => setDialog("send")}
          >
            Send…
          </Button>
        ) : null}
      </PageHeader>
      {error ? <ErrorText className="px-4 pt-2.5">{error}</ErrorText> : null}
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
          <div className="grid grid-cols-2 gap-3.5 @max-xl/content:grid-cols-1">
            <div className="flex min-w-0 flex-col">
              <FieldLabel htmlFor="cmp-segment">To</FieldLabel>
              <Select
                id="cmp-segment"
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
              </Select>
              <Hint className="mt-1.5">
                {segment ? (
                  <>
                    {segment.sendableCount} of {segment.contactCount} can be sent it now: subscribed, with an email.
                  </>
                ) : (
                  <>
                    <Link className="text-muted underline" to="/t/$teamId/segments" params={{ teamId }}>
                      Segments
                    </Link>{" "}
                    are who campaigns go to.
                  </>
                )}
              </Hint>
            </div>
            <div className="flex min-w-0 flex-col">
              <FieldLabel htmlFor="cmp-topic">
                Topic <span className="text-subtle">(optional)</span>
              </FieldLabel>
              <Select
                id="cmp-topic"
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
              </Select>
              <Hint className="mt-1.5">Unsubscribing from this email leaves only its topic.</Hint>
            </div>
          </div>
        }
        previewBar={
          <Select
            variant="inline"
            className="mx-0 w-auto text-sm"
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
          </Select>
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
        <Toast>
          <span>{toast}</span>
          <Button variant="ghost" size="sm" onClick={() => setToast(undefined)}>
            OK
          </Button>
        </Toast>
      ) : null}
    </Card>
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
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={chosen.size === 0 || chosen.size > 5 || busy} onClick={() => void send()}>
            Send test
          </Button>
        </>
      }
    >
      <Hint>
        Tests go to members of your team, up to 5, with “[Test]” in the subject. Merge tags use the contact you're
        previewing as, or sample values.
      </Hint>
      <Fieldset legend="Send to">
        <div className="flex flex-col gap-0.5">
          {(members.data ?? []).map((member) => (
            <Option key={member.userId}>
              <Checkbox
                checked={chosen.has(member.userId)}
                onChange={(event) => {
                  const next = new Set(chosen)
                  if (event.target.checked) next.add(member.userId)
                  else next.delete(member.userId)
                  setChosen(next)
                }}
              />
              <span>
                {member.name} <span className="text-subtle">{member.email}</span>
              </span>
            </Option>
          ))}
        </div>
      </Fieldset>
      {error ? <ErrorText>{error}</ErrorText> : null}
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
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!consent || busy || missing.length > 0 || count === 0}
            onClick={() => void send()}
          >
            Send to {count} {count === 1 ? "person" : "people"}
          </Button>
        </>
      }
    >
      <dl className="m-0 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 [&>dd]:m-0 [&>dt]:text-subtle">
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
        <Notice tone="warn">
          Finish the sender and footer in{" "}
          <Link className="underline" to="/t/$teamId/settings/email" params={{ teamId: props.teamId }}>
            Settings → Email
          </Link>{" "}
          first.
        </Notice>
      ) : null}
      <Option className="items-start">
        <Checkbox className="mt-1" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>
          These people agreed to get email from us. <span className="text-subtle">Anti-spam laws require consent.</span>
        </span>
      </Option>
      <Hint>Sending starts at once and can't be undone, though you can cancel what hasn't gone yet.</Hint>
      {error ? <ErrorText>{error}</ErrorText> : null}
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
    <Card as="main" className="flex-[999_1_35rem]">
      <PageHeader>
        <Breadcrumb>
          <Link className={breadcrumbRootClass} to="/t/$teamId/campaigns" params={{ teamId }}>
            Campaigns
          </Link>
          <BreadcrumbSeparator />
          <span>{campaign.name}</span>
        </Breadcrumb>
        <Badge className="ml-2" tone={campaign.status === "sent" ? "strong" : "neutral"}>
          {CAMPAIGN_STATUS_LABELS[campaign.status]}
        </Badge>
        <Spacer />
        {campaign.status === "sending" && props.canSend ? (
          <Button
            variant="ghost"
            onClick={() => void act(() => call("campaigns.cancel", { teamId, campaignId: campaign.id }))}
          >
            Cancel sending
          </Button>
        ) : null}
        <Button
          onClick={() =>
            void act(async () => {
              const copy = await call("campaigns.duplicate", { teamId, campaignId: campaign.id })
              await navigate({ to: "/t/$teamId/campaigns/$campaignId", params: { teamId, campaignId: copy.id } })
            })
          }
        >
          Duplicate
        </Button>
      </PageHeader>
      {error ? <ErrorText className="px-4 pt-2.5">{error}</ErrorText> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] overflow-auto border-t border-line @max-4xl/content:grid-cols-1">
        <div className="flex flex-col gap-3.5 overflow-auto border-r border-line p-4 @max-4xl/content:border-r-0">
          <p className="m-0 text-sm text-subtle">
            {campaign.sentByName ?? "Someone"} sent this to <b>{campaign.segmentName ?? "a segment"}</b>
            {campaign.topicName ? ` (topic: ${campaign.topicName})` : ""}
            {campaign.sendingStartedAt ? (
              <span title={absolute(campaign.sendingStartedAt)}> · {ago(campaign.sendingStartedAt)}</span>
            ) : null}
            {campaign.status === "sending" ? " · sending now" : ""}
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2.5">
            {tiles.map((tile) => (
              <StatTile
                key={tile.label}
                value={tile.value}
                label={tile.label}
                active={tile.status !== undefined && status === tile.status}
                disabled={tile.status === undefined && status === ""}
                onClick={() => setStatus(tile.status === undefined || status === tile.status ? "" : tile.status)}
              />
            ))}
          </div>
          <Box>
            <Table kind="settings">
              <thead>
                <tr>
                  <Th scope="col">Recipient</Th>
                  <Th scope="col">Status</Th>
                  <Th scope="col">Detail</Th>
                </tr>
              </thead>
              <tbody>
                {(recipients.data?.items ?? []).map((recipient, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a purged contact leaves no id
                  <Tr key={`${recipient.contactId ?? "gone"}-${index}`}>
                    <Td>
                      {recipient.contactId ? (
                        <Link
                          className="text-fg underline decoration-line-strong underline-offset-3"
                          to="/t/$teamId/contacts"
                          params={{ teamId }}
                          search={{ contact: recipient.contactId }}
                        >
                          {recipient.name}
                        </Link>
                      ) : (
                        recipient.name
                      )}
                      {recipient.address ? <span className="text-subtle"> {recipient.address}</span> : null}
                    </Td>
                    <Td
                      className={
                        ["failed", "bounced", "marked-as-spam"].includes(recipient.status) ? "text-danger" : undefined
                      }
                    >
                      {RECIPIENT_LABELS[recipient.status]}
                    </Td>
                    <Td className="text-subtle">
                      {recipient.skipReason ? SKIP_LABELS[recipient.skipReason] : (recipient.error ?? "")}
                      {recipient.sentAt ? (
                        <span title={absolute(recipient.sentAt)}>{ago(recipient.sentAt)}</span>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {recipients.data?.nextCursor ? (
              <Hint className="p-3">
                Showing the first 500. Agents can page through every recipient with campaigns.recipients.
              </Hint>
            ) : null}
          </Box>
        </div>
        <div className="flex min-h-0 flex-col bg-canvas">
          <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
            <span className="text-sm text-subtle">The email, with sample values</span>
          </div>
          {preview.data ? (
            <>
              <div className="mx-3.5 mb-2.5 rounded-md bg-surface px-3 py-2.5 inset-ring inset-ring-line">
                <div className="font-semibold">{preview.data.subject}</div>
                {preview.data.previewText ? (
                  <div className="text-sm text-subtle">{preview.data.previewText}</div>
                ) : null}
              </div>
              <EmailPreview html={preview.data.html} label="Email as sent" />
            </>
          ) : (
            <div className={EMAIL_FRAME_CLASS} />
          )}
        </div>
      </div>
    </Card>
  )
}
