import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { SegmentIcon } from "../components/icons.tsx"
import { LoadFailed } from "../components/record.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "../components/ui/breadcrumb.tsx"
import { ItemTile, NameText, nameLinkClass, wideColumnClass } from "../components/ui/email.tsx"
import {
  Button,
  Card,
  Centered,
  Count,
  Dialog,
  EmptyState,
  ErrorText,
  Field,
  Fieldset,
  Input,
  PageHeader,
  RadioCard,
  RadioCards,
  Spacer,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
import { call, messageOf } from "../lib/client.ts"
import { absolute, relative } from "../lib/time.ts"

export const Route = createFileRoute("/t/$teamId/segments/")({ component: SegmentsScreen })

const teamRoute = getRouteApi("/t/$teamId")

/** The segments index view (D23): every segment with how many contacts it has now. */
function SegmentsScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const canWrite = ROLE_PERMISSIONS[team.role].has("email:write")
  const [creating, setCreating] = useState(false)
  const segments = useQuery({ queryKey: ["segments", teamId], queryFn: () => call("segments.list", { teamId }) })
  const items = segments.data ?? []

  const newButton = canWrite ? (
    <Button variant="primary" onClick={() => setCreating(true)}>
      New segment
    </Button>
  ) : null

  return (
    <Card as="main" className="flex-[999_1_35rem]">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage render={(props) => <h1 {...props} />}>Segments</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {items.length > 0 ? <Count>{items.length}</Count> : null}
        <Spacer />
        {items.length > 0 ? newButton : null}
      </PageHeader>
      <ViewBody>
        {segments.isPending ? null : segments.isError ? (
          <LoadFailed
            title="Segments didn't load"
            message={messageOf(segments.error)}
            onRetry={() => void segments.refetch()}
          />
        ) : items.length === 0 ? (
          <Centered>
            <EmptyState icon={<SegmentIcon />} title="No segments yet" actions={newButton}>
              A segment is who a campaign goes to: either everyone matching a filter, which keeps up as contacts change,
              or a list you pick by hand.
            </EmptyState>
          </Centered>
        ) : (
          <TableScroll>
            <Table>
              <caption className="sr-only">Segments</caption>
              <thead>
                <tr>
                  <Th scope="col" className="pl-4">
                    Name
                  </Th>
                  <Th className="w-32" scope="col">
                    Kind
                  </Th>
                  <Th className="w-32" scope="col">
                    Contacts
                  </Th>
                  <Th className={`w-32 ${wideColumnClass}`} scope="col" title="Subscribed, with an email address">
                    Can be sent
                  </Th>
                  <Th className={`w-28 ${wideColumnClass}`} scope="col">
                    Updated
                  </Th>
                </tr>
              </thead>
              <tbody>
                {items.map((segment) => (
                  <Tr key={segment.id}>
                    <Td className="pl-4">
                      <Link
                        className={nameLinkClass}
                        to="/t/$teamId/segments/$segmentId"
                        params={{ teamId, segmentId: segment.id }}
                      >
                        <ItemTile icon={<SegmentIcon className="size-4" />} />
                        <NameText>{segment.name}</NameText>
                      </Link>
                    </Td>
                    <Td className="text-muted">{segment.kind === "dynamic" ? "Dynamic" : "Fixed"}</Td>
                    <Td className="tabular-nums">{segment.contactCount}</Td>
                    <Td className={`tabular-nums ${wideColumnClass}`}>{segment.sendableCount}</Td>
                    <Td className={`text-subtle tabular-nums ${wideColumnClass}`} title={absolute(segment.updatedAt)}>
                      {relative(segment.updatedAt)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </ViewBody>
      {creating ? <NewSegmentDialog teamId={teamId} onClose={() => setCreating(false)} /> : null}
    </Card>
  )
}

function NewSegmentDialog(props: { readonly teamId: TeamId; readonly onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [kind, setKind] = useState<"dynamic" | "fixed">("dynamic")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const segment = await call("segments.create", { teamId: props.teamId, name: name.trim(), kind })
      await navigate({ to: "/t/$teamId/segments/$segmentId", params: { teamId: props.teamId, segmentId: segment.id } })
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="New segment"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void create()}>
            Create segment
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="segment-name">
        <Input
          id="segment-name"
          maxLength={80}
          placeholder="Customers in Australia"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void create()
          }}
        />
      </Field>
      <Fieldset legend="Kind">
        <RadioCards name="kind" value={kind} onChange={setKind}>
          <RadioCard
            value="dynamic"
            label="Dynamic"
            description="Everyone matching a filter. It keeps up as contacts change."
          />
          <RadioCard value="fixed" label="Fixed" description="Contacts you pick by hand." />
        </RadioCards>
      </Fieldset>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}
