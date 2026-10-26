import { ROLE_PERMISSIONS, type Sender, type SendingDomain, type TeamId, type Topic } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { CheckIcon, InfoIcon, MailIcon, MoreIcon, WarnIcon } from "../components/icons.tsx"
import { CopyField, Dialog, Empty, LoadFailed, LoadingRows, SettingsPage, useToast } from "../components/settings.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx"
import {
  Badge,
  Box,
  Button,
  Checkbox,
  ErrorText,
  Field,
  Fieldset,
  Hint,
  IconButton,
  InfoTip,
  Input,
  Notice,
  Option,
  OutlineTag,
  RadioCard,
  RadioCards,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
} from "../components/ui/index.ts"
import { RowActions, SettingsSectionHeading } from "../components/ui/settings-extra.tsx"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/email")({ component: Email })

const team = getRouteApi("/t/$teamId")

/** "4 forms and 2 drafts", or undefined when nothing uses it. */
const usageText = (usedBy: Sender["usedBy"], join: string) => {
  const parts = [
    ...(usedBy.forms > 0 ? [`${usedBy.forms} ${usedBy.forms === 1 ? "form" : "forms"}`] : []),
    ...(usedBy.broadcasts > 0 ? [`${usedBy.broadcasts} ${usedBy.broadcasts === 1 ? "draft" : "drafts"}`] : []),
  ]
  return parts.length > 0 ? parts.join(join) : undefined
}

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1)

function Email() {
  const { team: current } = team.useLoaderData()
  const teamId = current.id as TeamId
  const canManage = ROLE_PERMISSIONS[current.role].has("email:manage")
  const queryClient = useQueryClient()
  const [toast, showToast] = useToast()
  const senders = useQuery({
    queryKey: ["senders", teamId],
    queryFn: () => call("senders.list", { teamId }),
  })
  const domains = useQuery({
    queryKey: ["sending-domains", teamId],
    queryFn: () => call("sendingDomains.list", { teamId }),
  })
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["senders", teamId] })
    await queryClient.invalidateQueries({ queryKey: ["sending-domains", teamId] })
  }

  return (
    <SettingsPage
      title="Email"
      intro={`The domains ${current.name} sends from, who its email comes from with each one's footer, and the topics people can unsubscribe from.`}
    >
      {canManage ? null : <Notice icon={<InfoIcon />}>Only admins and owners can change these.</Notice>}
      {senders.isPending ? (
        <LoadingRows />
      ) : senders.isError ? (
        <LoadFailed
          title="Senders didn't load"
          message={messageOf(senders.error)}
          onRetry={() => void senders.refetch()}
        />
      ) : (
        <>
          <Readiness senders={senders.data} />
          <SettingsSectionHeading>Sending domains</SettingsSectionHeading>
          <Domains
            teamId={teamId}
            canManage={canManage}
            domains={domains.data ?? []}
            loading={domains.isPending}
            onChanged={refresh}
            onToast={showToast}
          />
          <SettingsSectionHeading>Senders</SettingsSectionHeading>
          <Senders
            teamId={teamId}
            canManage={canManage}
            senders={senders.data}
            domains={domains.data ?? []}
            onChanged={refresh}
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

function Readiness(props: { readonly senders: ReadonlyArray<Sender> }) {
  const fallback = props.senders.find((sender) => sender.isDefault)
  if (!fallback) {
    return (
      <Notice tone="warn" icon={<WarnIcon />}>
        Before your team can send, add a sending domain and a sender on it.
      </Notice>
    )
  }
  if (!fallback.ready) {
    return (
      <Notice tone="warn" icon={<WarnIcon />}>
        The default sender can't send until {domainOf(fallback.address)} is verified.
      </Notice>
    )
  }
  return (
    <Notice tone="ok" icon={<CheckIcon />}>
      Ready to send. New broadcasts and forms send from{" "}
      <strong className="font-medium">
        {fallback.name} &lt;{fallback.address}&gt;
      </strong>{" "}
      unless you pick another sender.
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
          Broadcasts are sent from your own domain, like news@acme.com, once its DNS records prove it's yours.
        </Empty>
      ) : (
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col">Domain</Th>
                <Th scope="col" className="w-6/25">
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

function Senders(props: {
  readonly teamId: TeamId
  readonly canManage: boolean
  readonly senders: ReadonlyArray<Sender>
  readonly domains: ReadonlyArray<SendingDomain>
  readonly onChanged: () => Promise<void>
  readonly onToast: (text: string) => void
}) {
  const [dialog, setDialog] = useState<"new" | Sender>()
  const [deleting, setDeleting] = useState<Sender>()
  const fallback = props.senders.find((sender) => sender.isDefault)

  const makeDefault = async (sender: Sender) => {
    try {
      await call("senders.setDefault", { teamId: props.teamId, senderId: sender.id })
      props.onToast(`${sender.name} is the default sender.`)
    } catch (failure) {
      props.onToast(messageOf(failure))
    }
    await props.onChanged()
  }

  return (
    <>
      <Hint className="-mt-1">
        Who each email comes from, on one of your domains, with the footer it ends with. Each broadcast and form picks
        one.
      </Hint>
      {props.senders.length === 0 ? (
        <Empty icon={<MailIcon />} title="No senders yet">
          Add a sending domain, then a sender on it. The first one you add is the default.
        </Empty>
      ) : (
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col">Sender</Th>
                <Th scope="col" className="w-1/5">
                  Used by
                </Th>
                <Th scope="col" className="w-14">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {props.senders.map((sender) => (
                <Tr key={sender.id}>
                  <Td>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{sender.name}</span>
                      <span className="text-muted">{sender.address}</span>
                      {sender.isDefault ? <OutlineTag>Default</OutlineTag> : null}
                    </span>
                    <span className={sender.ready ? "block text-sm text-subtle" : "block text-sm text-warn"}>
                      {sender.ready
                        ? [
                            sender.legalName,
                            sender.postalAddress,
                            ...(sender.replyTo ? [`Replies to ${sender.replyTo}`] : []),
                          ].join(" · ")
                        : `Can't send until ${domainOf(sender.address)} is verified`}
                    </span>
                  </Td>
                  <Td className="text-subtle">{usageText(sender.usedBy, " · ") ?? "Not used"}</Td>
                  <Td className="text-right">
                    {props.canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <IconButton label={`Actions for ${sender.name}`}>
                              <MoreIcon />
                            </IconButton>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDialog(sender)}>Edit</DropdownMenuItem>
                          {sender.isDefault ? null : (
                            <DropdownMenuItem onClick={() => void makeDefault(sender)}>Make default</DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {sender.isDefault ? (
                            <DropdownMenuItem disabled>
                              <span className="flex flex-col">
                                Delete…
                                <span className="text-xs">Make another sender the default first</span>
                              </span>
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(sender)}>
                              Delete…
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Box>
      )}
      {props.canManage ? (
        <div className="-mt-2 flex gap-1.5">
          <Button disabled={props.domains.length === 0} onClick={() => setDialog("new")}>
            Add sender
          </Button>
        </div>
      ) : null}
      {dialog ? (
        <SenderDialog
          teamId={props.teamId}
          sender={dialog === "new" ? undefined : dialog}
          first={props.senders.length === 0}
          domains={props.domains}
          onClose={() => setDialog(undefined)}
          onSaved={async (text) => {
            setDialog(undefined)
            props.onToast(text)
            await props.onChanged()
          }}
        />
      ) : null}
      {deleting && fallback ? (
        <DeleteSenderDialog
          teamId={props.teamId}
          sender={deleting}
          fallback={fallback}
          onClose={() => setDeleting(undefined)}
          onDeleted={async (text) => {
            setDeleting(undefined)
            props.onToast(text)
            await props.onChanged()
          }}
        />
      ) : null}
    </>
  )
}

function SenderDialog(props: {
  readonly teamId: TeamId
  readonly sender: Sender | undefined
  /** The team has no sender yet, so this one becomes the default whatever is ticked. */
  readonly first: boolean
  readonly domains: ReadonlyArray<SendingDomain>
  readonly onClose: () => void
  readonly onSaved: (text: string) => Promise<void>
}) {
  const [draft, setDraft] = useState({
    name: props.sender?.name ?? "",
    address: props.sender?.address ?? "",
    replyTo: props.sender?.replyTo ?? "",
    legalName: props.sender?.legalName ?? "",
    postalAddress: props.sender?.postalAddress ?? "",
  })
  const [makeDefault, setMakeDefault] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const set = (field: keyof typeof draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }))
  const [local = "", domain = ""] = draft.address.split("@")
  const complete =
    draft.name.trim() !== "" &&
    local !== "" &&
    props.domains.some((entry) => entry.domain === domain) &&
    draft.legalName.trim() !== "" &&
    draft.postalAddress.trim() !== ""

  const save = async () => {
    setBusy(true)
    const input = {
      name: draft.name.trim(),
      address: draft.address as never,
      replyTo: (draft.replyTo.trim() || null) as never,
      legalName: draft.legalName.trim(),
      postalAddress: draft.postalAddress.trim(),
    }
    try {
      if (props.sender) {
        await call("senders.update", { teamId: props.teamId, senderId: props.sender.id, ...input })
        if (makeDefault) await call("senders.setDefault", { teamId: props.teamId, senderId: props.sender.id })
        await props.onSaved(`${input.name} is saved.`)
      } else {
        await call("senders.create", { teamId: props.teamId, ...input, isDefault: makeDefault })
        await props.onSaved(`${input.name} is added.`)
      }
    } catch (failure) {
      setError(messageOf(failure))
    }
    setBusy(false)
  }

  return (
    <Dialog
      title={props.sender ? "Edit sender" : "New sender"}
      className="max-w-2xl"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!complete || busy} onClick={() => void save()}>
            {props.sender ? "Save" : "Add sender"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 max-sm:grid-cols-1">
        <Field label="Sender name" htmlFor="sender-name" hint="What people see in their inbox.">
          <Input
            id="sender-name"
            maxLength={80}
            autoFocus
            placeholder="Acme"
            value={draft.name}
            onChange={set("name")}
          />
        </Field>
        <SenderAddressField
          domains={props.domains}
          disabled={false}
          value={draft.address}
          onChange={(address) => setDraft((current) => ({ ...current, address }))}
        />
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
            placeholder="Same as the sender address"
            value={draft.replyTo}
            onChange={set("replyTo")}
          />
        </Field>
        <Field label="Legal name" htmlFor="legal-name">
          <Input
            id="legal-name"
            maxLength={160}
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
            placeholder="1 Market St, Sydney NSW 2000, Australia"
            value={draft.postalAddress}
            onChange={set("postalAddress")}
          />
        </Field>
        <div className="col-span-full flex flex-col gap-1.5">
          <span className="font-medium">Footer preview</span>
          <div className="flex flex-col gap-1 border-t border-dashed border-line-strong pt-3 text-center text-sm text-subtle">
            <p className="m-0">You're getting this because you're subscribed to Product news.</p>
            <p className="m-0">
              {draft.legalName || <MissingPart>Legal name</MissingPart>} ·{" "}
              {draft.postalAddress || <MissingPart>Postal address</MissingPart>}
            </p>
            <p className="m-0">
              <u>Unsubscribe</u> or choose which email you get.
            </p>
          </div>
          <Hint>
            Anti-spam laws need every broadcast to say who sent it and how to unsubscribe. The first line appears only
            when the broadcast has a topic.
          </Hint>
        </div>
        {props.first || props.sender?.isDefault ? null : (
          <Option className="col-span-full">
            <Checkbox checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
            Make this the default sender for new broadcasts and forms
          </Option>
        )}
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}

function DeleteSenderDialog(props: {
  readonly teamId: TeamId
  readonly sender: Sender
  readonly fallback: Sender
  readonly onClose: () => void
  readonly onDeleted: (text: string) => Promise<void>
}) {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const used = usageText(props.sender.usedBy, " and ")
  const remove = async () => {
    setBusy(true)
    try {
      await call("senders.delete", { teamId: props.teamId, senderId: props.sender.id })
      await props.onDeleted(`${props.sender.name} is deleted.`)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={`Delete ${props.sender.name}?`}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="danger-solid" disabled={busy} onClick={() => void remove()}>
            Delete sender
          </Button>
        </>
      }
    >
      <p className="m-0 text-muted">
        {used ? (
          <>
            Its {used} will send from{" "}
            <strong className="font-medium text-fg">
              {props.fallback.name} &lt;{props.fallback.address}&gt;
            </strong>
            , the default sender, instead.{" "}
          </>
        ) : null}
        Broadcasts already sent keep the sender they went out with.
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
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
        A broadcast can have a topic, and people can unsubscribe from one topic while still getting the rest.
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
                <Th scope="col" className="w-3/10">
                  Name
                </Th>
                <Th scope="col">Description</Th>
                <Th scope="col" className="w-3/25">
                  Mode
                </Th>
                <Th scope="col" className="w-4/25">
                  <span className="inline-flex items-center gap-1">
                    People
                    <InfoTip label="people">
                      Opt-in topics: their subscribers, who joined. Opt-out topics: who left.
                    </InfoTip>
                  </span>
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
                  <Td className="text-subtle">{topic.mode === "opt-in" ? "Opt-in" : "Opt-out"}</Td>
                  <Td className="text-subtle tabular-nums">
                    {topic.mode === "opt-in"
                      ? `${topic.subscriberCount} ${topic.subscriberCount === 1 ? "subscriber" : "subscribers"}`
                      : `${topic.unsubscribedCount} left`}
                  </Td>
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
  const [mode, setMode] = useState<"opt-out" | "opt-in">(props.topic?.mode ?? "opt-out")
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
        await call("topics.create", { teamId: props.teamId, ...input, mode })
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
      {props.topic ? (
        <Hint>
          {props.topic.mode === "opt-in"
            ? "Opt-in: sent only to contacts who joined it."
            : "Opt-out: sent to everyone subscribed who hasn't left it."}{" "}
          A topic's mode is set when it's made.
        </Hint>
      ) : (
        <Fieldset legend="Who gets it">
          <RadioCards name="topic-mode" value={mode} onChange={setMode}>
            <RadioCard
              value="opt-out"
              label="Everyone, unless they leave"
              description="Opt-out. For email every subscribed contact should get, like product updates to customers."
            />
            <RadioCard
              value="opt-in"
              label="Only people who join"
              description="Opt-in. For lists people sign up to through a form, like a newsletter or a waitlist."
            />
          </RadioCards>
        </Fieldset>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}

/**
 * The sender address as a name and one of the team's sending domains, so it can't be typed on a
 * domain the team doesn't have. A domain that isn't verified yet can be chosen (broadcasts wait for
 * it), and an address saved on a domain since removed is flagged.
 */
function SenderAddressField(props: {
  readonly domains: ReadonlyArray<SendingDomain>
  readonly disabled: boolean
  readonly value: string
  readonly onChange: (address: string) => void
}) {
  const at = props.value.lastIndexOf("@")
  const name = at === -1 ? props.value : props.value.slice(0, at)
  const domain =
    at === -1 ? (props.domains.length === 1 ? (props.domains[0]?.domain ?? "") : "") : props.value.slice(at + 1)
  const known = props.domains.some((entry) => entry.domain === domain)
  const chosen = props.domains.find((entry) => entry.domain === domain)
  const join = (nextName: string, nextDomain: string) =>
    props.onChange(nextName || nextDomain ? `${nextName}@${nextDomain}` : "")

  /** A domain from a pasted address that isn't one of the team's, to say why it wasn't used. */
  const [refused, setRefused] = useState<string>()
  const onName = (typed: string) => {
    const pasted = typed.indexOf("@")
    setRefused(undefined)
    if (pasted === -1) {
      join(typed.trim(), domain)
      return
    }
    const before = typed.slice(0, pasted).trim()
    const after = typed
      .slice(pasted + 1)
      .trim()
      .toLowerCase()
    if (after === "") {
      // Typing "@" moves on to choosing the domain.
      join(before, domain)
      document.getElementById("sender-domain-part")?.focus()
      return
    }
    // A pasted address picks its domain too, when it's one of the team's.
    const match = props.domains.some((entry) => entry.domain === after)
    if (!match) setRefused(after)
    join(before, match ? after : domain)
  }

  if (props.domains.length === 0) {
    return (
      <Field label="Sender address" htmlFor="sender-name-part" hint="Add a sending domain above first.">
        <Input id="sender-name-part" disabled placeholder="news@yourdomain.com" />
      </Field>
    )
  }

  const error = refused
    ? `${refused} isn't one of your sending domains. Choose one of yours, or add it above.`
    : domain && !known
      ? `${domain} isn't one of your sending domains any more. Choose another.`
      : name && !domain
        ? "Choose one of your sending domains."
        : undefined
  const hint =
    chosen && chosen.status !== "verified"
      ? `${chosen.domain} isn't verified yet. Broadcasts can be sent once it is.`
      : "On one of your sending domains."

  return (
    <Field label="Sender address" htmlFor="sender-name-part" error={error} hint={hint}>
      <div className="flex items-center gap-2">
        <Input
          id="sender-name-part"
          className="min-w-0 flex-1"
          disabled={props.disabled}
          placeholder="news"
          aria-label="Sender address, the part before @"
          value={name}
          onChange={(event) => onName(event.target.value)}
        />
        <span className="text-subtle" aria-hidden="true">
          @
        </span>
        <div className="min-w-0 flex-1">
          <Select
            id="sender-domain-part"
            aria-label="Sender address, sending domain"
            disabled={props.disabled}
            value={known ? domain : ""}
            onChange={(event) => join(name, event.target.value)}
          >
            <option value="" disabled>
              Choose a domain
            </option>
            {props.domains.map((entry) => (
              <option key={entry.id} value={entry.domain}>
                {entry.status === "verified" ? entry.domain : `${entry.domain} (not verified)`}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </Field>
  )
}

/** A part of the footer preview that hasn't been filled in, marked as a gap rather than shown as example text. */
function MissingPart(props: { readonly children: ReactNode }) {
  return <span className="rounded-sm bg-warn-soft px-1 text-warn">{props.children} needed</span>
}
