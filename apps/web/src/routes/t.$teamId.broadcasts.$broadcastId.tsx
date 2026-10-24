import {
  type Broadcast,
  type BroadcastId,
  type Contact,
  type ContactId,
  type EmailStyleId,
  type RecipientStatus,
  ROLE_PERMISSIONS,
  type SegmentId,
  type TeamId,
  type TopicId,
  type UserId,
} from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { type ReactNode, useMemo, useState } from "react"
import { Composer, type Content, SaveState, useAutosave } from "../components/composer.tsx"
import { EMAIL_FRAME_CLASS, EmailPreview } from "../components/email-preview.tsx"
import { EmailStyleSelect } from "../components/email-style-select.tsx"
import { LoadFailed } from "../components/record.tsx"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb.tsx"
import { TitleInput } from "../components/ui/email.tsx"
import {
  Badge,
  Box,
  Button,
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
  showToast,
  Table,
  Td,
  Th,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
import { BROADCAST_STATUS_LABELS } from "../lib/broadcasts.ts"
import { call, messageOf } from "../lib/client.ts"
import { absolute, ago } from "../lib/time.ts"

export const Route = createFileRoute("/t/$teamId/broadcasts/$broadcastId")({ component: BroadcastScreen })

const teamRoute = getRouteApi("/t/$teamId")

function BroadcastScreen() {
  const { team } = teamRoute.useLoaderData()
  const { userId } = teamRoute.useRouteContext()
  const { broadcastId } = Route.useParams()
  const teamId = team.id as TeamId
  const broadcast = useQuery({
    queryKey: ["broadcast", teamId, broadcastId],
    queryFn: () => call("broadcasts.get", { teamId, broadcastId: broadcastId as BroadcastId }),
    refetchInterval: (query) => (query.state.data?.status === "sending" ? 2000 : false),
  })
  if (broadcast.isPending) return <Card as="main" className="grow-999 basis-140" />
  if (broadcast.isError) {
    return (
      <Card as="main" className="grow-999 basis-140">
        <ViewBody>
          <LoadFailed
            title="This broadcast didn't load"
            message={messageOf(broadcast.error)}
            onRetry={() => void broadcast.refetch()}
          />
        </ViewBody>
      </Card>
    )
  }
  const permissions = ROLE_PERMISSIONS[team.role]
  return broadcast.data.status === "draft" ? (
    <DraftEditor
      key={broadcast.data.id}
      teamId={teamId}
      userId={userId as UserId}
      broadcast={broadcast.data}
      canWrite={permissions.has("email:write")}
      canSend={permissions.has("email:send")}
    />
  ) : (
    <Report
      key={broadcast.data.id}
      teamId={teamId}
      broadcast={broadcast.data}
      canSend={permissions.has("email:send")}
    />
  )
}

interface DraftFields extends Content {
  readonly name: string
  readonly segmentId: SegmentId | null
  readonly topicId: TopicId | null
  readonly styleId: EmailStyleId | null
}

const fieldsOf = (broadcast: Broadcast): DraftFields => ({
  name: broadcast.name,
  subject: broadcast.subject,
  previewText: broadcast.previewText,
  body: broadcast.body,
  segmentId: broadcast.segmentId,
  topicId: broadcast.topicId,
  styleId: broadcast.styleId,
})

/** A draft in the composer (R42), with its segment and topic. Edits save once typing pauses. */
function DraftEditor(props: {
  readonly teamId: TeamId
  readonly userId: UserId
  readonly broadcast: Broadcast
  readonly canWrite: boolean
  readonly canSend: boolean
}) {
  const { teamId } = props
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(props.broadcast)
  const [draft, setDraft] = useState(fieldsOf(props.broadcast))
  const [error, setError] = useState<string>()
  const [dialog, setDialog] = useState<"test" | "send">()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [previewAs, setPreviewAs] = useState<ContactId | "">("")
  const segments = useQuery({ queryKey: ["segments", teamId], queryFn: () => call("segments.list", { teamId }) })
  const topics = useQuery({ queryKey: ["topics", teamId], queryFn: () => call("topics.list", { teamId }) })
  // Who to preview as: the first 50 of the chosen segment, else of the team (D136).
  const previewPeople = useQuery({
    queryKey: ["contacts", teamId, "preview-as", draft.segmentId ?? "team"],
    queryFn: () =>
      draft.segmentId
        ? call("segments.contacts", { teamId, segmentId: draft.segmentId, limit: 50 })
        : call("contacts.list", { teamId, limit: 50 }),
  })
  const people = useMemo(
    () =>
      ([...(previewPeople.data?.items ?? [])] as Array<Contact>).sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
    [previewPeople.data],
  )

  const state = useAutosave(draft, fieldsOf(saved), async (value) => {
    try {
      const next = await call("broadcasts.update", {
        teamId,
        broadcastId: saved.id,
        ...value,
        name: value.name.trim() || "Untitled broadcast",
      })
      setSaved(next)
      setError(undefined)
      queryClient.setQueryData(["broadcast", teamId, saved.id], next)
      await queryClient.invalidateQueries({ queryKey: ["broadcasts", teamId] })
    } catch (failure) {
      setError(messageOf(failure))
      throw failure
    }
  })

  const segment = segments.data?.find((entry) => entry.id === draft.segmentId)
  const readOnly = !props.canWrite

  return (
    <Card as="main" className="grow-999 basis-140">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/t/$teamId/broadcasts" params={{ teamId }} />}>
                Broadcasts
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {/* A flex box, so the input sits as it did in the row. */}
              <BreadcrumbPage render={(props) => <h1 {...props} className="flex min-w-0" />}>
                <TitleInput
                  aria-label="Broadcast name"
                  maxLength={120}
                  readOnly={readOnly}
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                />
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
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
                  void call("broadcasts.delete", { teamId, broadcastId: saved.id })
                    .then(() => queryClient.invalidateQueries({ queryKey: ["broadcasts", teamId] }))
                    .then(() => navigate({ to: "/t/$teamId/broadcasts", params: { teamId } }))
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
        teamId={teamId}
        content={draft}
        readOnly={readOnly}
        onChange={(change) => setDraft((current) => ({ ...current, ...change }))}
        previewKey={`${previewAs}:${draft.styleId ?? ""}`}
        preview={(content) =>
          call("broadcasts.preview", {
            teamId,
            broadcastId: saved.id,
            ...content,
            styleId: draft.styleId,
            ...(previewAs ? { contactId: previewAs } : {}),
          })
        }
        settings={
          <div className="grid grid-cols-3 gap-3.5 @max-3xl/content:grid-cols-2 @max-xl/content:grid-cols-1">
            <div className="flex min-w-0 flex-col">
              <FieldLabel htmlFor="cmp-segment">To</FieldLabel>
              <Select
                id="cmp-segment"
                disabled={readOnly}
                value={draft.segmentId ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, segmentId: (event.target.value || null) as SegmentId | null }))
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
                    {segment.description ? <span className="block text-muted">{segment.description}</span> : null}
                    {segment.sendableCount} of {segment.contactCount} can be sent it now: subscribed, with an email.
                  </>
                ) : (
                  <>
                    <Link className="text-muted underline" to="/t/$teamId/segments" params={{ teamId }}>
                      Segments
                    </Link>{" "}
                    are who broadcasts go to.
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
                onChange={(event) =>
                  setDraft((current) => ({ ...current, topicId: (event.target.value || null) as TopicId | null }))
                }
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
            <EmailStyleSelect
              teamId={teamId}
              value={draft.styleId}
              disabled={readOnly}
              onChange={(styleId) => setDraft((current) => ({ ...current, styleId }))}
            />
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
          broadcast={saved}
          userId={props.userId}
          contactId={previewAs || undefined}
          onClose={() => setDialog(undefined)}
          onSent={(text) => {
            setDialog(undefined)
            // It stays until it's acknowledged, as the test send's result.
            showToast(text, { dismissLabel: "OK", duration: Number.POSITIVE_INFINITY })
          }}
        />
      ) : dialog === "send" ? (
        <SendDialog
          teamId={teamId}
          broadcast={saved}
          onClose={() => setDialog(undefined)}
          onSent={async (next) => {
            setDialog(undefined)
            queryClient.setQueryData(["broadcast", teamId, saved.id], next)
            await queryClient.invalidateQueries({ queryKey: ["broadcasts", teamId] })
          }}
        />
      ) : null}
    </Card>
  )
}

function TestSendDialog(props: {
  readonly teamId: TeamId
  readonly broadcast: Broadcast
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
      const result = await call("broadcasts.testSend", {
        teamId: props.teamId,
        broadcastId: props.broadcast.id,
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
  readonly broadcast: Broadcast
  readonly onClose: () => void
  readonly onSent: (broadcast: Broadcast) => Promise<void>
}) {
  const settings = useQuery({
    queryKey: ["email-settings", props.teamId],
    queryFn: () => call("emailSettings.get", { teamId: props.teamId }),
  })
  const segment = useQuery({
    queryKey: ["segment", props.teamId, props.broadcast.segmentId],
    enabled: props.broadcast.segmentId !== null,
    queryFn: () => call("segments.get", { teamId: props.teamId, segmentId: props.broadcast.segmentId as SegmentId }),
  })
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const count = segment.data?.sendableCount ?? 0
  const missing = settings.data?.missing ?? []
  const send = async () => {
    setBusy(true)
    try {
      const next = await call("broadcasts.send", { teamId: props.teamId, broadcastId: props.broadcast.id })
      await props.onSent(next)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={`Send ${props.broadcast.name}`}
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
      <dl className="m-0 flex flex-col gap-2 [&_dd]:m-0 [&_dd]:min-w-0 [&_dt]:w-24 [&_dt]:shrink-0 [&_dt]:text-subtle [&>div]:flex [&>div]:gap-3">
        <div>
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
        </div>
        {props.broadcast.topicName ? (
          <div>
            <dt>Topic</dt>
            <dd>{props.broadcast.topicName}. Anyone who left it is skipped.</dd>
          </div>
        ) : null}
        <div>
          <dt>From</dt>
          <dd>
            {settings.data?.senderName ?? "—"} &lt;{settings.data?.senderAddress ?? "—"}&gt;
          </dd>
        </div>
        <div>
          <dt>Subject</dt>
          <dd>{props.broadcast.subject || "—"}</dd>
        </div>
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
  canceled: "Canceled",
}

const SKIP_LABELS: Readonly<Record<string, string>> = {
  "no-email": "No email address",
  unsubscribed: "Unsubscribed",
  "unsubscribed-from-topic": "Left this topic",
  bounced: "Bounced before",
  "marked-as-spam": "Marked as spam before",
}

/** A sent (or sending) broadcast: what happened, who it went to, and what they got. */
function Report(props: { readonly teamId: TeamId; readonly broadcast: Broadcast; readonly canSend: boolean }) {
  const { teamId, broadcast } = props
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  /** Which recipients to list: one status, those who unsubscribed through this broadcast, or everyone. */
  const [status, setStatus] = useState<RecipientStatus | "unsubscribed" | "">("")
  const [error, setError] = useState<string>()
  const counts = broadcast.counts
  const recipients = useQuery({
    queryKey: ["recipients", teamId, broadcast.id, status, counts?.queued ?? 0, counts?.sent ?? 0],
    queryFn: () =>
      call("broadcasts.recipients", {
        teamId,
        broadcastId: broadcast.id,
        limit: 500,
        ...(status === "unsubscribed" ? { unsubscribed: true } : status ? { status } : {}),
      }),
  })
  const listed = recipients.data?.items ?? []
  const preview = useQuery({
    queryKey: ["broadcast-preview", teamId, broadcast.id],
    queryFn: () => call("broadcasts.preview", { teamId, broadcastId: broadcast.id }),
  })
  const reached = counts ? counts.delivered || counts.sent + counts.delivered : 0
  /** Tiles for what happened. Queued, skipped, failed and canceled show only when there are some. */
  const tiles: ReadonlyArray<{
    readonly label: string
    readonly value: ReactNode
    readonly status?: RecipientStatus | "unsubscribed"
  }> = counts
    ? [
        { label: "Recipients", value: counts.recipients },
        { label: "Sent", value: counts.sent + counts.delivered, status: "sent" as const },
        { label: "Delivered", value: counts.delivered, status: "delivered" as const },
        {
          label: "Unsubscribed",
          value: (
            <>
              {counts.unsubscribed}
              {reached > 0 ? (
                <span className="text-sm font-normal text-subtle">
                  {" "}
                  · {Math.round((counts.unsubscribed / reached) * 100)}%
                </span>
              ) : null}
            </>
          ),
          status: "unsubscribed" as const,
        },
        ...(counts.queued > 0 ? [{ label: "Queued", value: counts.queued, status: "queued" as const }] : []),
        ...(counts.skipped > 0 ? [{ label: "Skipped", value: counts.skipped, status: "skipped" as const }] : []),
        ...(counts.failed > 0 ? [{ label: "Failed", value: counts.failed, status: "failed" as const }] : []),
        { label: "Bounced", value: counts.bounced, status: "bounced" as const },
        { label: "Marked as spam", value: counts.markedAsSpam, status: "marked-as-spam" as const },
        ...(counts.canceled > 0 ? [{ label: "Canceled", value: counts.canceled, status: "canceled" as const }] : []),
      ]
    : []

  const act = async (work: () => Promise<unknown>) => {
    try {
      await work()
      await queryClient.invalidateQueries({ queryKey: ["broadcast", teamId, broadcast.id] })
      await queryClient.invalidateQueries({ queryKey: ["broadcasts", teamId] })
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  return (
    <Card as="main" className="grow-999 basis-140">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/t/$teamId/broadcasts" params={{ teamId }} />}>
                Broadcasts
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage render={(props) => <h1 {...props} />}>{broadcast.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Badge className="ml-2" tone={broadcast.status === "sent" ? "strong" : "neutral"}>
          {BROADCAST_STATUS_LABELS[broadcast.status]}
        </Badge>
        <Spacer />
        {broadcast.status === "sending" && props.canSend ? (
          <Button
            variant="ghost"
            onClick={() => void act(() => call("broadcasts.cancel", { teamId, broadcastId: broadcast.id }))}
          >
            Cancel sending
          </Button>
        ) : null}
        <Button
          onClick={() =>
            void act(async () => {
              const copy = await call("broadcasts.duplicate", { teamId, broadcastId: broadcast.id })
              await navigate({ to: "/t/$teamId/broadcasts/$broadcastId", params: { teamId, broadcastId: copy.id } })
            })
          }
        >
          Duplicate
        </Button>
      </PageHeader>
      {error ? <ErrorText className="px-4 pt-2.5">{error}</ErrorText> : null}
      <div className="flex min-h-0 flex-1 overflow-auto border-t border-line @max-4xl/content:flex-col">
        <div className="flex min-w-0 flex-6 flex-col gap-3.5 overflow-auto border-r border-line p-4 @max-4xl/content:border-r-0">
          <p className="m-0 text-sm text-subtle">
            {broadcast.sentByName ?? "Someone"} sent this to <b>{broadcast.segmentName ?? "a segment"}</b>
            {broadcast.topicName ? ` (topic: ${broadcast.topicName})` : ""}
            {broadcast.sendingStartedAt ? (
              <span title={absolute(broadcast.sendingStartedAt)}> · {ago(broadcast.sendingStartedAt)}</span>
            ) : null}
            {broadcast.status === "sending" ? " · sending now" : ""}
          </p>
          <div className="flex flex-wrap gap-2.5">
            {tiles.map((tile) => (
              <StatTile
                className="min-w-34 flex-1"
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
                {listed.map((recipient, index) => (
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
                      {recipient.unsubscribed ? "Unsubscribed" : RECIPIENT_LABELS[recipient.status]}
                    </Td>
                    <Td className="text-subtle">
                      {recipient.unsubscribed
                        ? `${recipient.unsubscribed === "topic" ? "From this topic" : "From everything"} · `
                        : null}
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
                Showing the first 500. Agents can page through every recipient with broadcasts.recipients.
              </Hint>
            ) : null}
          </Box>
        </div>
        <div className="flex min-h-0 min-w-0 flex-5 flex-col bg-canvas">
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
