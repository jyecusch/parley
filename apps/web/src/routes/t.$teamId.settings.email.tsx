import { type EmailSettings, ROLE_PERMISSIONS, type SendingDomain, type TeamId, type Topic } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CheckIcon, InfoIcon, MailIcon, WarnIcon } from "../components/icons.tsx"
import { CopyField, Dialog, Empty, LoadFailed, LoadingRows, SettingsPage, useToast } from "../components/settings.tsx"
import {
  Badge,
  Box,
  Button,
  ErrorText,
  Field,
  Hint,
  Input,
  Notice,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
} from "../components/ui/index.ts"
import { RowActions, SettingsPanel, SettingsSectionHeading } from "../components/ui/settings-extra.tsx"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/email")({ component: Email })

const team = getRouteApi("/t/$teamId")

const MISSING_LABELS: Readonly<Record<EmailSettings["missing"][number], string>> = {
  "sender-name": "a sender name",
  "sender-address": "a sender address",
  "verified-domain": "a verified sending domain for the sender address",
  "legal-name": "a legal name",
  "postal-address": "a postal address",
  "footer-reason": "why recipients get your email",
}

const listOf = (items: ReadonlyArray<string>) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`

function Email() {
  const { team: current } = team.useLoaderData()
  const teamId = current.id as TeamId
  const canManage = ROLE_PERMISSIONS[current.role].has("email:manage")
  const queryClient = useQueryClient()
  const [toast, showToast] = useToast()
  const settings = useQuery({
    queryKey: ["email-settings", teamId],
    queryFn: () => call("emailSettings.get", { teamId }),
  })
  const domains = useQuery({
    queryKey: ["sending-domains", teamId],
    queryFn: () => call("sendingDomains.list", { teamId }),
  })
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["email-settings", teamId] })
    await queryClient.invalidateQueries({ queryKey: ["sending-domains", teamId] })
  }

  return (
    <SettingsPage
      title="Email"
      intro={`Who ${current.name}'s campaigns come from, the footer every one of them ends with, and the topics people can unsubscribe from.`}
    >
      {canManage ? null : <Notice icon={<InfoIcon />}>Only admins and owners can change these.</Notice>}
      {settings.isPending ? (
        <LoadingRows />
      ) : settings.isError ? (
        <LoadFailed
          title="Email settings didn't load"
          message={messageOf(settings.error)}
          onRetry={() => void settings.refetch()}
        />
      ) : (
        <>
          <Readiness settings={settings.data} />
          <SettingsSectionHeading>Sending domains</SettingsSectionHeading>
          <Domains
            teamId={teamId}
            canManage={canManage}
            domains={domains.data ?? []}
            loading={domains.isPending}
            onChanged={refresh}
            onToast={showToast}
          />
          <SettingsSectionHeading>Sender and footer</SettingsSectionHeading>
          <SenderForm
            teamId={teamId}
            canManage={canManage}
            settings={settings.data}
            domains={domains.data ?? []}
            onSaved={async () => {
              await refresh()
              showToast("Saved.")
            }}
            onToast={showToast}
          />
          <SettingsSectionHeading>Topics</SettingsSectionHeading>
          <Topics teamId={teamId} canManage={canManage} onToast={showToast} />
        </>
      )}
      {toast}
    </SettingsPage>
  )
}

function Readiness(props: { readonly settings: EmailSettings }) {
  const missing = props.settings.missing
  if (missing.length === 0) {
    return (
      <Notice tone="ok" icon={<CheckIcon />}>
        Ready to send. Campaigns go out from {props.settings.senderAddress}.
      </Notice>
    )
  }
  return (
    <Notice tone="warn" icon={<WarnIcon />}>
      Before your team can send, add {listOf(missing.map((item) => MISSING_LABELS[item]))}.
    </Notice>
  )
}

const STATUS_LABELS: Readonly<Record<SendingDomain["status"], string>> = {
  pending: "Waiting for DNS",
  verified: "Verified",
  failed: "Failed",
}

function Domains(props: {
  readonly teamId: TeamId
  readonly canManage: boolean
  readonly domains: ReadonlyArray<SendingDomain>
  readonly loading: boolean
  readonly onChanged: () => Promise<void>
  readonly onToast: (text: string) => void
}) {
  const [adding, setAdding] = useState("")
  const [busy, setBusy] = useState<string>()
  const [open, setOpen] = useState<string>()
  const [confirming, setConfirming] = useState<string>()

  const act = async (key: string, work: () => Promise<string | undefined>) => {
    setBusy(key)
    try {
      const text = await work()
      if (text) props.onToast(text)
    } catch (failure) {
      props.onToast(messageOf(failure))
    }
    setBusy(undefined)
    await props.onChanged()
  }

  return (
    <>
      {props.loading ? (
        <LoadingRows />
      ) : props.domains.length === 0 ? (
        <Empty icon={<MailIcon />} title="No sending domains yet">
          Campaigns are sent from your own domain, like news@acme.com, once its DNS records prove it's yours.
        </Empty>
      ) : (
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col">Domain</Th>
                <Th scope="col" className="w-[24%]">
                  Status
                </Th>
                <Th scope="col" className="w-72">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {props.domains.map((domain) => (
                <DomainRow
                  key={domain.id}
                  domain={domain}
                  canManage={props.canManage}
                  busy={busy === domain.id}
                  open={open === domain.id}
                  confirming={confirming === domain.id}
                  onToggle={() => setOpen(open === domain.id ? undefined : domain.id)}
                  onVerify={() =>
                    void act(domain.id, async () => {
                      const checked = await call("sendingDomains.verify", {
                        teamId: props.teamId,
                        sendingDomainId: domain.id,
                      })
                      return checked.status === "verified"
                        ? `${checked.domain} is verified.`
                        : `${checked.domain} isn't verified yet. DNS changes can take a while to be seen.`
                    })
                  }
                  onConfirm={() => setConfirming(domain.id)}
                  onCancel={() => setConfirming(undefined)}
                  onRemove={() =>
                    void act(domain.id, async () => {
                      await call("sendingDomains.delete", { teamId: props.teamId, sendingDomainId: domain.id })
                      setConfirming(undefined)
                      return `${domain.domain} is removed.`
                    })
                  }
                />
              ))}
            </tbody>
          </Table>
        </Box>
      )}
      {props.canManage ? (
        <form
          className="-mt-2 flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            const domain = adding.trim()
            if (!domain) return
            void act("new", async () => {
              const added = await call("sendingDomains.create", { teamId: props.teamId, domain: domain as never })
              setAdding("")
              setOpen(added.id)
              return added.status === "verified"
                ? `${added.domain} is added and verified.`
                : `${added.domain} is added. Add its DNS records, then verify.`
            })
          }}
        >
          <Input
            className="max-w-80"
            type="text"
            placeholder="acme.com"
            aria-label="Domain to send from"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
          />
          <Button size="lg" type="submit" disabled={!adding.trim() || busy === "new"}>
            Add domain
          </Button>
        </form>
      ) : null}
    </>
  )
}

function DomainRow(props: {
  readonly domain: SendingDomain
  readonly canManage: boolean
  readonly busy: boolean
  readonly open: boolean
  readonly confirming: boolean
  readonly onToggle: () => void
  readonly onVerify: () => void
  readonly onConfirm: () => void
  readonly onCancel: () => void
  readonly onRemove: () => void
}) {
  const { domain } = props
  return (
    <>
      <Tr>
        <Td className="font-medium">{domain.domain}</Td>
        <Td>
          <Badge tone={domain.status === "verified" ? "strong" : domain.status === "failed" ? "danger" : "neutral"}>
            {STATUS_LABELS[domain.status]}
          </Badge>
        </Td>
        <Td className="text-right">
          {props.confirming ? (
            <RowActions>
              <Button size="sm" variant="ghost" onClick={props.onCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger-solid"
                aria-label={`Confirm: remove ${domain.domain}`}
                disabled={props.busy}
                onClick={props.onRemove}
              >
                Remove
              </Button>
            </RowActions>
          ) : (
            <RowActions>
              {domain.records.length > 0 ? (
                <Button size="sm" variant="ghost" aria-expanded={props.open} onClick={props.onToggle}>
                  DNS records
                </Button>
              ) : null}
              {props.canManage && domain.status !== "verified" ? (
                <Button size="sm" disabled={props.busy} onClick={props.onVerify}>
                  Verify
                </Button>
              ) : null}
              {props.canManage ? (
                <Button size="sm" variant="danger" aria-label={`Remove ${domain.domain}`} onClick={props.onConfirm}>
                  Remove
                </Button>
              ) : null}
            </RowActions>
          )}
        </Td>
      </Tr>
      {props.open && domain.records.length > 0 ? (
        <tr>
          <td colSpan={3} className="border-b border-line/55 bg-hover px-3.5 pt-1 pb-4">
            <Hint>Add these at your DNS host, then verify. It can take a while for DNS to update.</Hint>
            <table className="mt-2 w-full table-fixed border-collapse">
              <thead>
                <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:text-left [&>th]:font-medium [&>th]:text-subtle">
                  <th scope="col" className="w-20">
                    Type
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col">Value</th>
                  <th scope="col" className="w-32">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {domain.records.map((record) => (
                  <tr
                    key={`${record.type}-${record.name}-${record.value}`}
                    className="[&>td]:px-2 [&>td]:py-1 [&>td]:align-middle"
                  >
                    <td className="font-mono text-sm">
                      {record.type}
                      {record.priority !== null ? ` ${record.priority}` : ""}
                    </td>
                    <td>
                      <CopyField value={record.name} label={`${record.type} record name`} code />
                    </td>
                    <td>
                      <CopyField value={record.value} label={`${record.type} record value`} code />
                    </td>
                    <td className="text-subtle">{STATUS_LABELS[record.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function SenderForm(props: {
  readonly teamId: TeamId
  readonly canManage: boolean
  readonly settings: EmailSettings
  readonly domains: ReadonlyArray<SendingDomain>
  readonly onSaved: () => Promise<void>
  readonly onToast: (text: string) => void
}) {
  const initial = {
    senderName: props.settings.senderName ?? "",
    senderAddress: props.settings.senderAddress ?? "",
    replyTo: props.settings.replyTo ?? "",
    legalName: props.settings.legalName ?? "",
    postalAddress: props.settings.postalAddress ?? "",
    footerReason: props.settings.footerReason ?? "",
  }
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const key = JSON.stringify(initial)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the saved settings change
  useEffect(() => setDraft(initial), [key])
  const dirty = JSON.stringify(draft) !== key
  const set = (field: keyof typeof initial) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }))
  const orNull = (value: string) => (value.trim() ? value.trim() : null)
  const domainHint = props.domains[0]?.domain ?? "your sending domain"

  const save = async () => {
    setBusy(true)
    try {
      await call("emailSettings.update", {
        teamId: props.teamId,
        senderName: orNull(draft.senderName),
        senderAddress: orNull(draft.senderAddress) as never,
        replyTo: orNull(draft.replyTo) as never,
        legalName: orNull(draft.legalName),
        postalAddress: orNull(draft.postalAddress),
        footerReason: orNull(draft.footerReason),
      })
      await props.onSaved()
    } catch (failure) {
      props.onToast(messageOf(failure))
    }
    setBusy(false)
  }

  const disabled = !props.canManage
  return (
    <SettingsPanel className="grid grid-cols-2 gap-x-5 gap-y-4 @max-3xl/content:grid-cols-1">
      <Field label="Sender name" htmlFor="sender-name">
        <Input
          id="sender-name"
          maxLength={80}
          disabled={disabled}
          placeholder="Acme"
          value={draft.senderName}
          onChange={set("senderName")}
        />
      </Field>
      <Field label="Sender address" htmlFor="sender-address" hint="On one of your sending domains.">
        <Input
          id="sender-address"
          type="email"
          disabled={disabled}
          placeholder={`news@${domainHint}`}
          value={draft.senderAddress}
          onChange={set("senderAddress")}
        />
      </Field>
      <Field
        label={
          <>
            Reply-to address <span className="font-normal text-subtle">(optional)</span>
          </>
        }
        htmlFor="reply-to"
      >
        <Input
          id="reply-to"
          type="email"
          disabled={disabled}
          placeholder="hello@acme.com"
          value={draft.replyTo}
          onChange={set("replyTo")}
        />
      </Field>
      <Field label="Legal name" htmlFor="legal-name">
        <Input
          id="legal-name"
          maxLength={160}
          disabled={disabled}
          placeholder="Acme Pty Ltd"
          value={draft.legalName}
          onChange={set("legalName")}
        />
      </Field>
      <Field label="Postal address" htmlFor="postal-address" className="col-span-full">
        <Textarea
          id="postal-address"
          rows={2}
          maxLength={300}
          disabled={disabled}
          placeholder="1 Market St, Sydney NSW 2000, Australia"
          value={draft.postalAddress}
          onChange={set("postalAddress")}
        />
      </Field>
      <Field label="Why recipients get your email" htmlFor="footer-reason" className="col-span-full">
        <Textarea
          id="footer-reason"
          rows={2}
          maxLength={300}
          disabled={disabled}
          placeholder="You're getting this because you signed up at acme.com."
          value={draft.footerReason}
          onChange={set("footerReason")}
        />
      </Field>
      <div className="col-span-full flex flex-col gap-1.5">
        <span className="font-medium">Footer preview</span>
        <div className="flex flex-col gap-1 border-t border-dashed border-line-strong pt-3 text-center text-sm text-subtle [&>p]:m-0">
          <p>{draft.footerReason || "Why recipients get your email."}</p>
          <p>
            {draft.legalName || "Legal name"} · {draft.postalAddress || "Postal address"}
          </p>
          <p>
            <u>Unsubscribe</u> or choose which email you get.
          </p>
        </div>
        <Hint>
          Anti-spam laws need every campaign to say who sent it and how to unsubscribe, so Parley adds this to each one.
        </Hint>
      </div>
      {props.canManage ? (
        <div className="col-span-full flex justify-end gap-1.5">
          <Button variant="ghost" disabled={!dirty || busy} onClick={() => setDraft(initial)}>
            Reset
          </Button>
          <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      ) : null}
    </SettingsPanel>
  )
}

function Topics(props: {
  readonly teamId: TeamId
  readonly canManage: boolean
  readonly onToast: (text: string) => void
}) {
  const queryClient = useQueryClient()
  const key = ["topics", props.teamId]
  const topics = useQuery({ queryKey: key, queryFn: () => call("topics.list", { teamId: props.teamId }) })
  const [dialog, setDialog] = useState<"new" | Topic>()
  const [confirming, setConfirming] = useState<string>()
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  const remove = async (topic: Topic) => {
    try {
      await call("topics.delete", { teamId: props.teamId, topicId: topic.id })
      props.onToast(`${topic.name} is deleted.`)
    } catch (failure) {
      props.onToast(messageOf(failure))
    }
    setConfirming(undefined)
    await refresh()
  }

  return (
    <>
      <Hint className="-mt-1">
        A campaign can have a topic, and people can unsubscribe from one topic while still getting the rest.
      </Hint>
      {topics.isPending ? (
        <LoadingRows />
      ) : topics.isError ? (
        <LoadFailed
          title="Topics didn't load"
          message={messageOf(topics.error)}
          onRetry={() => void topics.refetch()}
        />
      ) : topics.data.length === 0 ? (
        <Empty icon={<MailIcon />} title="No topics yet">
          Without topics, unsubscribing stops all of your team's marketing email.
        </Empty>
      ) : (
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col" className="w-[30%]">
                  Name
                </Th>
                <Th scope="col">Description</Th>
                <Th scope="col" className="w-[16%]">
                  Unsubscribed
                </Th>
                <Th scope="col" className="w-44">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {topics.data.map((topic) => (
                <Tr key={topic.id}>
                  <Td className="font-medium">{topic.name}</Td>
                  <Td className="text-subtle">{topic.description ?? "—"}</Td>
                  <Td className="text-subtle tabular-nums">{topic.unsubscribedCount}</Td>
                  <Td className="text-right">
                    {!props.canManage ? null : confirming === topic.id ? (
                      <RowActions>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(undefined)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-solid"
                          aria-label={`Confirm: delete ${topic.name}`}
                          onClick={() => void remove(topic)}
                        >
                          Delete
                        </Button>
                      </RowActions>
                    ) : (
                      <RowActions>
                        <Button size="sm" variant="ghost" onClick={() => setDialog(topic)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          aria-label={`Delete ${topic.name}`}
                          onClick={() => setConfirming(topic.id)}
                        >
                          Delete
                        </Button>
                      </RowActions>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Box>
      )}
      {props.canManage ? (
        <div className="-mt-2 flex gap-1.5">
          <Button onClick={() => setDialog("new")}>New topic</Button>
        </div>
      ) : null}
      {dialog ? (
        <TopicDialog
          teamId={props.teamId}
          topic={dialog === "new" ? undefined : dialog}
          onClose={() => setDialog(undefined)}
          onSaved={async (text) => {
            setDialog(undefined)
            props.onToast(text)
            await refresh()
          }}
        />
      ) : null}
    </>
  )
}

function TopicDialog(props: {
  readonly teamId: TeamId
  readonly topic: Topic | undefined
  readonly onClose: () => void
  readonly onSaved: (text: string) => Promise<void>
}) {
  const [name, setName] = useState(props.topic?.name ?? "")
  const [description, setDescription] = useState(props.topic?.description ?? "")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const input = { name: name.trim(), description: description.trim() || null }
      if (props.topic) {
        await call("topics.update", { teamId: props.teamId, topicId: props.topic.id, ...input })
        await props.onSaved(`${input.name} is saved.`)
      } else {
        await call("topics.create", { teamId: props.teamId, ...input })
        await props.onSaved(`${input.name} is added.`)
      }
    } catch (failure) {
      setError(messageOf(failure))
    }
    setBusy(false)
  }
  return (
    <Dialog
      title={props.topic ? "Edit topic" : "New topic"}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void save()}>
            {props.topic ? "Save" : "Add topic"}
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="topic-name">
        <Input
          id="topic-name"
          maxLength={60}
          placeholder="Product updates"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field
        label={
          <>
            Description <span className="font-normal text-subtle">(optional)</span>
          </>
        }
        htmlFor="topic-description"
        hint="Shown on the unsubscribe page."
      >
        <Input
          id="topic-description"
          maxLength={200}
          placeholder="New features, about once a month."
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}
