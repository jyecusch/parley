import { ROLE_PERMISSIONS, type TeamId, type TemplateId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { SendIcon } from "../components/icons.tsx"
import { LoadFailed } from "../components/record.tsx"
import { ItemTile, NameText, nameLinkClass, wideColumnClass } from "../components/ui/email.tsx"
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  Centered,
  Count,
  Dialog,
  EmptyState,
  ErrorText,
  Field,
  Input,
  PageHeader,
  Select,
  Spacer,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
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
    <Button variant="primary" onClick={() => setCreating(true)}>
      New campaign
    </Button>
  ) : null

  return (
    <Card as="main" className="flex-[999_1_35rem]">
      <PageHeader>
        <Breadcrumb>
          <span>Campaigns</span>
        </Breadcrumb>
        {items.length > 0 ? <Count>{items.length}</Count> : null}
        <Spacer />
        {items.length > 0 ? newButton : null}
      </PageHeader>
      <ViewBody>
        {campaigns.isPending ? null : campaigns.isError ? (
          <LoadFailed
            title="Campaigns didn't load"
            message={messageOf(campaigns.error)}
            onRetry={() => void campaigns.refetch()}
          />
        ) : items.length === 0 ? (
          <Centered>
            <EmptyState icon={<SendIcon />} title="No campaigns yet" actions={newButton}>
              A campaign is one email to a segment of your contacts. Write it, send yourself a test, then send it.
            </EmptyState>
          </Centered>
        ) : (
          <TableScroll>
            <Table>
              <caption className="sr-only">Campaigns</caption>
              <thead>
                <tr>
                  <Th scope="col" className="pl-4">
                    Name
                  </Th>
                  <Th className="w-32" scope="col">
                    Status
                  </Th>
                  <Th className={wideColumnClass} scope="col">
                    Segment
                  </Th>
                  <Th className={`w-32 ${wideColumnClass}`} scope="col">
                    Sent
                  </Th>
                  <Th className="w-28" scope="col">
                    Updated
                  </Th>
                </tr>
              </thead>
              <tbody>
                {items.map((campaign) => (
                  <Tr key={campaign.id}>
                    <Td className="h-12 pl-4">
                      <Link
                        className={nameLinkClass}
                        to="/t/$teamId/campaigns/$campaignId"
                        params={{ teamId, campaignId: campaign.id }}
                      >
                        <ItemTile icon={<SendIcon className="size-4" />} />
                        <NameText sub={campaign.subject || undefined}>{campaign.name}</NameText>
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={campaign.status === "sent" ? "strong" : "neutral"}>
                        {CAMPAIGN_STATUS_LABELS[campaign.status]}
                      </Badge>
                    </Td>
                    <Td className={`${wideColumnClass} ${campaign.segmentName ? "text-muted" : "text-subtle"}`}>
                      {campaign.segmentName ?? "—"}
                    </Td>
                    <Td className={`tabular-nums ${wideColumnClass}`}>
                      {campaign.counts
                        ? `${campaign.counts.sent + campaign.counts.delivered} of ${campaign.counts.recipients - campaign.counts.skipped}`
                        : "—"}
                    </Td>
                    <Td className="text-subtle tabular-nums" title={absolute(campaign.updatedAt)}>
                      {relative(campaign.updatedAt)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </ViewBody>
      {creating ? <NewCampaignDialog teamId={teamId} onClose={() => setCreating(false)} /> : null}
    </Card>
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
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void create()}>
            Create draft
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="campaign-name" hint="For your team. Recipients see the subject, not this.">
        <Input
          id="campaign-name"
          maxLength={120}
          placeholder="October update"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void create()
          }}
        />
      </Field>
      <Field label="Start from" htmlFor="campaign-template">
        <Select id="campaign-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
          <option value="">A blank email</option>
          {(templates.data ?? []).map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </Select>
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}
