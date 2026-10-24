import { ROLE_PERMISSIONS, type TeamId, type TemplateId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { SendIcon } from "../components/icons.tsx"
import { LoadFailed } from "../components/record.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "../components/ui/breadcrumb.tsx"
import { ItemTile, NameText, nameLinkClass, wideColumnClass } from "../components/ui/email.tsx"
import {
  Badge,
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
import { BROADCAST_STATUS_LABELS } from "../lib/broadcasts.ts"
import { call, messageOf } from "../lib/client.ts"
import { absolute, relative } from "../lib/time.ts"

export const Route = createFileRoute("/t/$teamId/broadcasts/")({ component: BroadcastsScreen })

const teamRoute = getRouteApi("/t/$teamId")

/** The broadcasts index view (R42): drafts, and what was sent. */
function BroadcastsScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const canWrite = ROLE_PERMISSIONS[team.role].has("email:write")
  const [creating, setCreating] = useState(false)
  const broadcasts = useQuery({
    queryKey: ["broadcasts", teamId],
    queryFn: () => call("broadcasts.list", { teamId }),
    refetchInterval: (query) => (query.state.data?.some((broadcast) => broadcast.status === "sending") ? 3000 : false),
  })
  const items = broadcasts.data ?? []
  const newButton = canWrite ? (
    <Button variant="primary" onClick={() => setCreating(true)}>
      New broadcast
    </Button>
  ) : null

  return (
    <Card as="main" className="grow-999 basis-140">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage render={(props) => <h1 {...props} />}>Broadcasts</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {items.length > 0 ? <Count>{items.length}</Count> : null}
        <Spacer />
        {items.length > 0 ? newButton : null}
      </PageHeader>
      <ViewBody>
        {broadcasts.isPending ? null : broadcasts.isError ? (
          <LoadFailed
            title="Broadcasts didn't load"
            message={messageOf(broadcasts.error)}
            onRetry={() => void broadcasts.refetch()}
          />
        ) : items.length === 0 ? (
          <Centered>
            <EmptyState icon={<SendIcon />} title="No broadcasts yet" actions={newButton}>
              A broadcast is one email to a segment of your contacts. Write it, send yourself a test, then send it.
            </EmptyState>
          </Centered>
        ) : (
          <TableScroll>
            <Table>
              <caption className="sr-only">Broadcasts</caption>
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
                {items.map((broadcast) => (
                  <Tr key={broadcast.id}>
                    <Td className="h-12 pl-4">
                      <Link
                        className={nameLinkClass}
                        to="/t/$teamId/broadcasts/$broadcastId"
                        params={{ teamId, broadcastId: broadcast.id }}
                      >
                        <ItemTile icon={<SendIcon className="size-4" />} />
                        <NameText sub={broadcast.subject || undefined}>{broadcast.name}</NameText>
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={broadcast.status === "sent" ? "strong" : "neutral"}>
                        {BROADCAST_STATUS_LABELS[broadcast.status]}
                      </Badge>
                    </Td>
                    <Td className={`${wideColumnClass} ${broadcast.segmentName ? "text-muted" : "text-subtle"}`}>
                      {broadcast.segmentName ?? "—"}
                    </Td>
                    <Td className={`tabular-nums ${wideColumnClass}`}>
                      {broadcast.counts
                        ? `${broadcast.counts.sent + broadcast.counts.delivered} of ${broadcast.counts.recipients - broadcast.counts.skipped}`
                        : "—"}
                    </Td>
                    <Td className="text-subtle tabular-nums" title={absolute(broadcast.updatedAt)}>
                      {relative(broadcast.updatedAt)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </ViewBody>
      {creating ? <NewBroadcastDialog teamId={teamId} onClose={() => setCreating(false)} /> : null}
    </Card>
  )
}

function NewBroadcastDialog(props: { readonly teamId: TeamId; readonly onClose: () => void }) {
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
      const broadcast = await call("broadcasts.create", {
        teamId: props.teamId,
        name: name.trim(),
        ...(templateId ? { templateId: templateId as TemplateId } : {}),
      })
      await navigate({
        to: "/t/$teamId/broadcasts/$broadcastId",
        params: { teamId: props.teamId, broadcastId: broadcast.id },
      })
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="New broadcast"
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
      <Field label="Name" htmlFor="broadcast-name" hint="For your team. Recipients see the subject, not this.">
        <Input
          id="broadcast-name"
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
      <Field label="Start from" htmlFor="broadcast-template">
        <Select id="broadcast-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
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
