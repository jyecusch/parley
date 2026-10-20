import { ROLE_PERMISSIONS, type TeamId, type TemplateId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { SendIcon } from "../components/icons.tsx"
import { LoadFailed } from "../components/record.tsx"
import { Dialog } from "../components/settings.tsx"
import { CAMPAIGN_STATUS_LABELS } from "../lib/campaigns.ts"
import { call, messageOf } from "../lib/client.ts"
import { absolute, relative } from "../lib/time.ts"

export const Route = createFileRoute("/t/$teamId/campaigns/")({ component: CampaignsScreen })

const teamRoute = getRouteApi("/t/$teamId")

/** The campaigns index view (R42): drafts, and what was sent. */
function CampaignsScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const canWrite = ROLE_PERMISSIONS[team.role].has("email:write")
  const [creating, setCreating] = useState(false)
  const campaigns = useQuery({
    queryKey: ["campaigns", teamId],
    queryFn: () => call("campaigns.list", { teamId }),
    refetchInterval: (query) => (query.state.data?.some((campaign) => campaign.status === "sending") ? 3000 : false),
  })
  const items = campaigns.data ?? []
  const newButton = canWrite ? (
    <button className="btn primary" type="button" onClick={() => setCreating(true)}>
      New campaign
    </button>
  ) : null

  return (
    <main className="card main">
      <div className="hd1">
        <h1 className="crumb">
          <span>Campaigns</span>
        </h1>
        {items.length > 0 ? <span className="count">{items.length}</span> : null}
        <div className="spacer" />
        {items.length > 0 ? newButton : null}
      </div>
      <div className="body">
        {campaigns.isPending ? null : campaigns.isError ? (
          <LoadFailed
            title="Campaigns didn't load"
            message={messageOf(campaigns.error)}
            onRetry={() => void campaigns.refetch()}
          />
        ) : items.length === 0 ? (
          <div className="center">
            <div className="empty">
              <div className="e-ic">
                <SendIcon />
              </div>
              <h2>No campaigns yet</h2>
              <p>
                A campaign is one email to a segment of your contacts. Write it, send yourself a test, then send it.
              </p>
              {newButton ? <div className="actions">{newButton}</div> : null}
            </div>
          </div>
        ) : (
          <div className="tablewrap">
            <table className="ctable">
              <caption className="vh">Campaigns</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ paddingLeft: 14 }}>
                    Name
                  </th>
                  <th className="w-kind" scope="col">
                    Status
                  </th>
                  <th className="col-wide" scope="col">
                    Segment
                  </th>
                  <th className="w-count col-wide" scope="col">
                    Sent
                  </th>
                  <th className="w-date" scope="col">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((campaign) => (
                  <tr key={campaign.id}>
                    <td style={{ paddingLeft: 14 }}>
                      <Link
                        className="namebtn"
                        to="/t/$teamId/campaigns/$campaignId"
                        params={{ teamId, campaignId: campaign.id }}
                      >
                        <span className="tile" aria-hidden="true">
                          <SendIcon className="size-3.5" />
                        </span>
                        <span className="stack">
                          <span className="n">{campaign.name}</span>
                          {campaign.subject ? <span className="s sm-t">{campaign.subject}</span> : null}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className={`pill ${campaign.status === "sent" ? "ok" : ""}`}>
                        {CAMPAIGN_STATUS_LABELS[campaign.status]}
                      </span>
                    </td>
                    <td className={`col-wide ${campaign.segmentName ? "c-muted" : "c-none"}`}>
                      {campaign.segmentName ?? "—"}
                    </td>
                    <td className="tab col-wide">
                      {campaign.counts
                        ? `${campaign.counts.sent + campaign.counts.delivered} of ${campaign.counts.recipients - campaign.counts.skipped}`
                        : "—"}
                    </td>
                    <td className="c-date" title={absolute(campaign.updatedAt)}>
                      {relative(campaign.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating ? <NewCampaignDialog teamId={teamId} onClose={() => setCreating(false)} /> : null}
    </main>
  )
}

function NewCampaignDialog(props: { readonly teamId: TeamId; readonly onClose: () => void }) {
  const navigate = useNavigate()
  const templates = useQuery({
    queryKey: ["templates", props.teamId],
    queryFn: () => call("templates.list", { teamId: props.teamId }),
  })
  const [name, setName] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const campaign = await call("campaigns.create", {
        teamId: props.teamId,
        name: name.trim(),
        ...(templateId ? { templateId: templateId as TemplateId } : {}),
      })
      await navigate({
        to: "/t/$teamId/campaigns/$campaignId",
        params: { teamId: props.teamId, campaignId: campaign.id },
      })
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="New campaign"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" disabled={!name.trim() || busy} onClick={() => void create()}>
            Create draft
          </button>
        </>
      }
    >
      <div className="fld">
        <label className="fl" htmlFor="campaign-name">
          Name
        </label>
        <input
          id="campaign-name"
          className="inp"
          maxLength={120}
          placeholder="October update"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void create()
          }}
        />
        <p className="hint sm-t">For your team. Recipients see the subject, not this.</p>
      </div>
      <div className="fld">
        <label className="fl" htmlFor="campaign-template">
          Start from
        </label>
        <select
          id="campaign-template"
          className="inp"
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
        >
          <option value="">A blank email</option>
          {(templates.data ?? []).map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="err sm-t" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
