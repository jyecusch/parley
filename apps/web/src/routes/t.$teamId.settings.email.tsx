import { type EmailSettings, ROLE_PERMISSIONS, type SendingDomain, type TeamId, type Topic } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CheckIcon, InfoIcon, MailIcon, WarnIcon } from "../components/icons.tsx"
import { CopyField, Dialog, Empty, LoadFailed, LoadingRows, SettingsPage, useToast } from "../components/settings.tsx"
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
      {canManage ? null : (
        <div className="notice">
          <span className="ic">
            <InfoIcon />
          </span>
          <span>Only admins and owners can change these.</span>
        </div>
      )}
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
          <h3 className="sechead">Sending domains</h3>
          <Domains
            teamId={teamId}
            canManage={canManage}
            domains={domains.data ?? []}
            loading={domains.isPending}
            onChanged={refresh}
            onToast={showToast}
          />
          <h3 className="sechead">Sender and footer</h3>
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
          <h3 className="sechead">Topics</h3>
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
      <div className="notice">
        <span className="ic">
          <CheckIcon />
        </span>
        <span>Ready to send. Campaigns go out from {props.settings.senderAddress}.</span>
      </div>
    )
  }
  return (
    <div className="warn">
      <span className="ic">
        <WarnIcon />
      </span>
      <span>Before your team can send, add {listOf(missing.map((item) => MISSING_LABELS[item]))}.</span>
    </div>
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
        <div className="box">
          <table className="stable">
            <thead>
              <tr>
                <th scope="col">Domain</th>
                <th scope="col" style={{ width: "24%" }}>
                  Status
                </th>
                <th scope="col" style={{ width: 230 }}>
                  <span className="vh">Actions</span>
                </th>
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
          </table>
        </div>
      )}
      {props.canManage ? (
        <form
          className="addrow"
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
          <input
            className="inp"
            type="text"
            placeholder="acme.com"
            aria-label="Domain to send from"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
          />
          <button className="btn" type="submit" disabled={!adding.trim() || busy === "new"}>
            Add domain
          </button>
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
      <tr>
        <td>
          <span className="who">
            <span className="n">{domain.domain}</span>
          </span>
        </td>
        <td>
          <span className={`pill ${domain.status === "verified" ? "ok" : domain.status === "failed" ? "bad" : ""}`}>
            {STATUS_LABELS[domain.status]}
          </span>
        </td>
        <td className="c-act">
          {props.confirming ? (
            <span className="confirm">
              <button className="btn sm ghost" type="button" onClick={props.onCancel}>
                Cancel
              </button>
              <button
                className="btn sm danger-solid"
                type="button"
                aria-label={`Confirm: remove ${domain.domain}`}
                disabled={props.busy}
                onClick={props.onRemove}
              >
                Remove
              </button>
            </span>
          ) : (
            <span className="confirm">
              {domain.records.length > 0 ? (
                <button className="btn sm ghost" type="button" aria-expanded={props.open} onClick={props.onToggle}>
                  DNS records
                </button>
              ) : null}
              {props.canManage && domain.status !== "verified" ? (
                <button className="btn sm" type="button" disabled={props.busy} onClick={props.onVerify}>
                  Verify
                </button>
              ) : null}
              {props.canManage ? (
                <button
                  className="btn sm danger"
                  type="button"
                  aria-label={`Remove ${domain.domain}`}
                  onClick={props.onConfirm}
                >
                  Remove
                </button>
              ) : null}
            </span>
          )}
        </td>
      </tr>
      {props.open && domain.records.length > 0 ? (
        <tr className="subrow">
          <td colSpan={3}>
            <p className="hint sm-t">Add these at your DNS host, then verify. It can take a while for DNS to update.</p>
            <table className="dns">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Name</th>
                  <th scope="col">Value</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {domain.records.map((record) => (
                  <tr key={`${record.type}-${record.name}-${record.value}`}>
                    <td className="mono">
                      {record.type}
                      {record.priority !== null ? ` ${record.priority}` : ""}
                    </td>
                    <td>
                      <CopyField value={record.name} label={`${record.type} record name`} code />
                    </td>
                    <td>
                      <CopyField value={record.value} label={`${record.type} record value`} code />
                    </td>
                    <td className="c-muted">{STATUS_LABELS[record.status]}</td>
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
    <section className="box urlcard formgrid">
      <div className="fld">
        <label className="fl" htmlFor="sender-name">
          Sender name
        </label>
        <input
          id="sender-name"
          className="inp"
          maxLength={80}
          disabled={disabled}
          placeholder="Acme"
          value={draft.senderName}
          onChange={set("senderName")}
        />
      </div>
      <div className="fld">
        <label className="fl" htmlFor="sender-address">
          Sender address
        </label>
        <input
          id="sender-address"
          className="inp"
          type="email"
          disabled={disabled}
          placeholder={`news@${domainHint}`}
          value={draft.senderAddress}
          onChange={set("senderAddress")}
        />
        <p className="hint sm-t">On one of your sending domains.</p>
      </div>
      <div className="fld">
        <label className="fl" htmlFor="reply-to">
          Reply-to address <span className="c-muted">(optional)</span>
        </label>
        <input
          id="reply-to"
          className="inp"
          type="email"
          disabled={disabled}
          placeholder="hello@acme.com"
          value={draft.replyTo}
          onChange={set("replyTo")}
        />
      </div>
      <div className="fld">
        <label className="fl" htmlFor="legal-name">
          Legal name
        </label>
        <input
          id="legal-name"
          className="inp"
          maxLength={160}
          disabled={disabled}
          placeholder="Acme Pty Ltd"
          value={draft.legalName}
          onChange={set("legalName")}
        />
      </div>
      <div className="fld wide">
        <label className="fl" htmlFor="postal-address">
          Postal address
        </label>
        <textarea
          id="postal-address"
          className="inp"
          rows={2}
          maxLength={300}
          disabled={disabled}
          placeholder="1 Market St, Sydney NSW 2000, Australia"
          value={draft.postalAddress}
          onChange={set("postalAddress")}
        />
      </div>
      <div className="fld wide">
        <label className="fl" htmlFor="footer-reason">
          Why recipients get your email
        </label>
        <textarea
          id="footer-reason"
          className="inp"
          rows={2}
          maxLength={300}
          disabled={disabled}
          placeholder="You're getting this because you signed up at acme.com."
          value={draft.footerReason}
          onChange={set("footerReason")}
        />
      </div>
      <div className="fld wide">
        <span className="fl">Footer preview</span>
        <div className="footprev sm-t">
          <p>{draft.footerReason || "Why recipients get your email."}</p>
          <p>
            {draft.legalName || "Legal name"} · {draft.postalAddress || "Postal address"}
          </p>
          <p>
            <u>Unsubscribe</u> or choose which email you get.
          </p>
        </div>
        <p className="hint sm-t">
          Anti-spam laws need every campaign to say who sent it and how to unsubscribe, so Parley adds this to each one.
        </p>
      </div>
      {props.canManage ? (
        <div className="fld wide formactions">
          <button className="btn ghost" type="button" disabled={!dirty || busy} onClick={() => setDraft(initial)}>
            Reset
          </button>
          <button className="btn primary" type="button" disabled={!dirty || busy} onClick={() => void save()}>
            Save
          </button>
        </div>
      ) : null}
    </section>
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
      <p className="hint sm-t" style={{ margin: "-4px 0 10px" }}>
        A campaign can have a topic, and people can unsubscribe from one topic while still getting the rest.
      </p>
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
        <div className="box">
          <table className="stable">
            <thead>
              <tr>
                <th scope="col" style={{ width: "30%" }}>
                  Name
                </th>
                <th scope="col">Description</th>
                <th scope="col" style={{ width: "16%" }}>
                  Unsubscribed
                </th>
                <th scope="col" style={{ width: 150 }}>
                  <span className="vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {topics.data.map((topic) => (
                <tr key={topic.id}>
                  <td>
                    <span className="who">
                      <span className="n">{topic.name}</span>
                    </span>
                  </td>
                  <td className="c-muted">{topic.description ?? "—"}</td>
                  <td className="c-muted tab">{topic.unsubscribedCount}</td>
                  <td className="c-act">
                    {!props.canManage ? null : confirming === topic.id ? (
                      <span className="confirm">
                        <button className="btn sm ghost" type="button" onClick={() => setConfirming(undefined)}>
                          Cancel
                        </button>
                        <button
                          className="btn sm danger-solid"
                          type="button"
                          aria-label={`Confirm: delete ${topic.name}`}
                          onClick={() => void remove(topic)}
                        >
                          Delete
                        </button>
                      </span>
                    ) : (
                      <span className="confirm">
                        <button className="btn sm ghost" type="button" onClick={() => setDialog(topic)}>
                          Edit
                        </button>
                        <button
                          className="btn sm danger"
                          type="button"
                          aria-label={`Delete ${topic.name}`}
                          onClick={() => setConfirming(topic.id)}
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.canManage ? (
        <div className="addrow">
          <button className="btn" type="button" onClick={() => setDialog("new")}>
            New topic
          </button>
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
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" disabled={!name.trim() || busy} onClick={() => void save()}>
            {props.topic ? "Save" : "Add topic"}
          </button>
        </>
      }
    >
      <div className="fld">
        <label className="fl" htmlFor="topic-name">
          Name
        </label>
        <input
          id="topic-name"
          className="inp"
          maxLength={60}
          placeholder="Product updates"
          // biome-ignore lint/a11y/noAutofocus: the dialog opens to name the topic
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="fld">
        <label className="fl" htmlFor="topic-description">
          Description <span className="c-muted">(optional)</span>
        </label>
        <input
          id="topic-description"
          className="inp"
          maxLength={200}
          placeholder="New features, about once a month."
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <p className="hint sm-t">Shown on the unsubscribe page.</p>
      </div>
      {error ? (
        <p className="err sm-t" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
