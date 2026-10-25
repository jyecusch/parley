import {
  type Contact,
  type ContactId,
  type Filter,
  filterFields,
  ROLE_PERMISSIONS,
  type Segment,
  type SegmentId,
  SUBSCRIPTION_STATUS_LABELS,
  type TeamId,
} from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useMemo, useRef, useState } from "react"
import { Picker, type PickerItem } from "../components/affiliations.tsx"
import { FilterBar } from "../components/filters.tsx"
import { CloseIcon, DownloadIcon, PlusIcon, SegmentIcon } from "../components/icons.tsx"
import { ContactAvatar } from "../components/images.tsx"
import { LoadFailed } from "../components/record.tsx"
import { PlaceholderRow, SpacerRow, useVirtualRows } from "../components/record-index.tsx"
import { EditableDescription } from "../components/record-profile.tsx"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb.tsx"
import { NameText, nameLinkClass, TitleInput, wideColumnClass } from "../components/ui/email.tsx"
import {
  Badge,
  Button,
  Card,
  Centered,
  EmptyState,
  IconButton,
  PageHeader,
  Spacer,
  showToast,
  Table,
  TableScroll,
  Td,
  TextButton,
  Th,
  Toolbar,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
import { call, messageOf } from "../lib/client.ts"
import { contactApi, refreshContacts } from "../lib/contacts.ts"
import { useFields } from "../lib/custom-fields.ts"
import { download, EMPTY_FILTER } from "../lib/index-view.ts"
import { usePeopleOptions } from "../lib/people.ts"
import { type RecordApi, useRecordList, useRecordSearch } from "../lib/records.ts"

export const Route = createFileRoute("/t/$teamId/segments/$segmentId")({ component: SegmentScreen })

const teamRoute = getRouteApi("/t/$teamId")

/**
 * One segment (D23). A dynamic segment's filter is edited with the same filter bar as Contacts
 * (D59), and its contacts update as you change it; a fixed segment's contacts are picked by hand.
 */
function SegmentScreen() {
  const { team } = teamRoute.useLoaderData()
  const { segmentId } = Route.useParams()
  const teamId = team.id as TeamId
  const canWrite = ROLE_PERMISSIONS[team.role].has("email:write")
  const queryClient = useQueryClient()
  const key = ["segment", teamId, segmentId]
  const segment = useQuery({
    queryKey: key,
    queryFn: () => call("segments.get", { teamId, segmentId: segmentId as SegmentId }),
  })

  const refresh = async (next?: Segment) => {
    if (next) queryClient.setQueryData(key, next)
    await queryClient.invalidateQueries({ queryKey: ["segments", teamId] })
    await refreshContacts(queryClient, teamId)
  }

  if (segment.isPending) return <Card as="main" className="grow-999 basis-140" />
  if (segment.isError) {
    return (
      <Card as="main" className="grow-999 basis-140">
        <ViewBody>
          <LoadFailed
            title="This segment didn't load"
            message={messageOf(segment.error)}
            onRetry={() => void segment.refetch()}
          />
        </ViewBody>
      </Card>
    )
  }
  return (
    <SegmentView
      key={segment.data.id}
      teamId={teamId}
      segment={segment.data}
      canWrite={canWrite}
      onChanged={refresh}
      onToast={(text) => showToast(text, { duration: 5000, dismissible: false })}
    />
  )
}

function SegmentView(props: {
  readonly teamId: TeamId
  readonly segment: Segment
  readonly canWrite: boolean
  readonly onChanged: (next?: Segment) => Promise<void>
  readonly onToast: (text: string) => void
}) {
  const { segment, teamId } = props
  const { userId } = teamRoute.useRouteContext()
  const peopleOptions = usePeopleOptions(teamId, userId)
  const navigate = useNavigate()
  const { fields } = useFields(teamId, "contact")
  const filterInfo = useMemo(() => filterFields("contact", fields), [fields])
  const [filter, setFilter] = useState<Filter>(segment.filter ?? EMPTY_FILTER)
  const dirty = segment.kind === "dynamic" && JSON.stringify(filter) !== JSON.stringify(segment.filter ?? EMPTY_FILTER)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickQuery, setPickQuery] = useState("")

  // The contacts, a page at a time (D136): a dynamic segment's are those matching the filter as
  // edited; a fixed segment's are its members.
  const membersApi = useMemo(
    (): RecordApi<Contact> => ({
      ...contactApi,
      scope: `segment:${segment.id}`,
      list: (team, input) =>
        call("segments.contacts", {
          teamId: team,
          segmentId: segment.id,
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
        }),
    }),
    [segment.id],
  )
  const list = useRecordList(segment.kind === "fixed" ? membersApi : contactApi, teamId, {
    search: "",
    filter: segment.kind === "dynamic" ? filter : EMPTY_FILTER,
    sort: null,
  })
  const total = list.total ?? (dirty ? list.count : segment.contactCount)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtual = useVirtualRows({
    count: list.count,
    scrollRef,
    onRange: list.ensure,
    resetKey: JSON.stringify(filter),
  })
  const found = useRecordSearch(contactApi, teamId, pickQuery, { enabled: picking })

  const run = async (work: () => Promise<Segment | undefined>, done?: string) => {
    try {
      const next = await work()
      await props.onChanged(next)
      if (done) props.onToast(done)
    } catch (failure) {
      props.onToast(messageOf(failure))
    }
  }

  /** Downloads the segment's contacts as CSV (a dynamic segment's as saved, not an unsaved filter). */
  const exportCsv = async () => {
    try {
      const result = await call("contacts.export", { teamId, segmentId: segment.id })
      const slug = segment.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
      download(`contacts-${slug || "segment"}-${new Date().toISOString().slice(0, 10)}.csv`, result.csv)
      props.onToast(`Exported ${result.count} ${result.count === 1 ? "contact" : "contacts"}.`)
    } catch (failure) {
      props.onToast(messageOf(failure))
    }
  }

  // Contacts already in the segment can show here; adding one again leaves it as it is.
  const pickable: ReadonlyArray<PickerItem> = found.items.map((contact) => ({
    id: contact.id,
    name: contact.displayName,
    sub: contact.emails[0]?.address,
    avatar: <ContactAvatar contact={contact} />,
  }))

  return (
    <Card as="main" className="grow-999 basis-140">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/t/$teamId/segments" params={{ teamId }} />}>Segments</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {/* A flex box, so the name's input or button sits as it did in the row. */}
              <BreadcrumbPage render={(props) => <h1 {...props} className="flex min-w-0" />}>
                {renaming ? (
                  <TitleInput
                    className="w-80 bg-fill"
                    aria-label="Segment name"
                    defaultValue={segment.name}
                    maxLength={80}
                    autoFocus
                    onBlur={(event) => {
                      setRenaming(false)
                      const name = event.currentTarget.value.trim()
                      if (name && name !== segment.name) {
                        void run(() => call("segments.update", { teamId, segmentId: segment.id, name }))
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur()
                      if (event.key === "Escape") setRenaming(false)
                    }}
                  />
                ) : props.canWrite ? (
                  <TextButton className="self-auto text-fg" title="Rename" onClick={() => setRenaming(true)}>
                    {segment.name}
                  </TextButton>
                ) : (
                  <span>{segment.name}</span>
                )}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Badge className="ml-2">{segment.kind === "dynamic" ? "Dynamic" : "Fixed"}</Badge>
        <Spacer />
        {dirty ? null : (
          <Button variant="ghost" onClick={() => void exportCsv()}>
            <DownloadIcon className="size-4" />
            Export
          </Button>
        )}
        {dirty ? (
          <>
            <Button variant="ghost" onClick={() => setFilter(segment.filter ?? EMPTY_FILTER)}>
              Reset
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                void run(() => call("segments.update", { teamId, segmentId: segment.id, filter }), "Filter saved.")
              }
            >
              Save filter
            </Button>
          </>
        ) : null}
        {props.canWrite && !dirty ? (
          confirmDelete ? (
            <span className="inline-flex items-center gap-1">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger-solid"
                onClick={() =>
                  void run(async () => {
                    await call("segments.delete", { teamId, segmentId: segment.id })
                    await navigate({ to: "/t/$teamId/segments", params: { teamId } })
                    return undefined
                  })
                }
              >
                Delete segment
              </Button>
            </span>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )
        ) : null}
      </PageHeader>

      {/* What the segment is for (D141), under its name. */}
      {segment.description || props.canWrite ? (
        <div className="shrink-0 border-b border-line px-4 py-2.5">
          <EditableDescription
            value={segment.description}
            disabled={!props.canWrite}
            maxLength={500}
            onSave={(description) =>
              void run(() => call("segments.update", { teamId, segmentId: segment.id, description }))
            }
          />
        </div>
      ) : null}

      <Toolbar>
        {segment.kind === "dynamic" ? (
          props.canWrite ? (
            <FilterBar
              teamId={teamId}
              fields={filterInfo}
              filter={filter}
              onChange={setFilter}
              people={peopleOptions}
            />
          ) : (
            <span className="ml-2 text-sm text-subtle">Everyone matching this segment's filter.</span>
          )
        ) : props.canWrite ? (
          <span className="relative inline-flex">
            <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
              <PlusIcon className="size-3.5" />
              Add contacts
            </Button>
            {picking ? (
              <Picker
                label="Add a contact"
                placeholder="Find a contact"
                heading="Contacts"
                placement="top-full left-0 mt-1"
                items={pickable}
                onQueryChange={setPickQuery}
                onClose={() => setPicking(false)}
                onPick={(id) =>
                  void run(() =>
                    call("segments.addContacts", { teamId, segmentId: segment.id, contactIds: [id as ContactId] }),
                  )
                }
              />
            ) : null}
          </span>
        ) : null}
        <Spacer />
        <span className="mr-2 text-sm text-subtle">
          {total.toLocaleString()} {total === 1 ? "contact" : "contacts"}
          {/* The sendable count is the saved segment's, so it's left out while the filter is changed. */}
          {dirty ? null : ` · ${segment.sendableCount.toLocaleString()} can be sent broadcasts`}
        </span>
      </Toolbar>

      <ViewBody>
        {list.isError ? (
          <LoadFailed
            title="Contacts didn't load"
            message={messageOf(list.error)}
            onRetry={() => void list.refetch()}
          />
        ) : list.isLoading ? null : list.count === 0 ? (
          <Centered>
            <EmptyState
              icon={<SegmentIcon />}
              title={segment.kind === "dynamic" ? "Nobody matches yet" : "No contacts yet"}
            >
              {segment.kind === "dynamic"
                ? "Add a filter, or change it, to choose who this segment is."
                : "Add contacts here, or select them on Contacts and add them to this segment."}
            </EmptyState>
          </Centered>
        ) : (
          <TableScroll ref={scrollRef}>
            <Table>
              <caption className="sr-only">Contacts in {segment.name}</caption>
              <thead>
                <tr>
                  <Th className="w-8/25 pl-4 @max-narrow/content:w-auto" scope="col">
                    Name
                  </Th>
                  <Th className={`w-9/25 ${wideColumnClass}`} scope="col">
                    Primary email
                  </Th>
                  <Th scope="col">Subscription</Th>
                  {segment.kind === "fixed" && props.canWrite ? (
                    <Th scope="col" className="w-12">
                      <span className="sr-only">Remove</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                <SpacerRow height={virtual.before} />
                {virtual.rows.map((row) => {
                  const contact = list.at(row.index)
                  if (!contact) return <PlaceholderRow key={`loading-${row.index}`} />
                  return (
                    <Tr key={contact.id}>
                      <Td className="pl-4">
                        <Link
                          className={nameLinkClass}
                          to="/t/$teamId/contacts"
                          params={{ teamId }}
                          search={{ contact: contact.id }}
                        >
                          <ContactAvatar contact={contact} />
                          <NameText>{contact.displayName}</NameText>
                        </Link>
                      </Td>
                      <Td className={`${wideColumnClass} ${contact.emails[0] ? "text-muted" : "text-subtle"}`}>
                        {contact.emails.find((email) => email.isPrimary)?.address ?? contact.emails[0]?.address ?? "—"}
                      </Td>
                      <Td className={contact.subscriptionStatus === "subscribed" ? "text-subtle" : "text-danger"}>
                        {SUBSCRIPTION_STATUS_LABELS[contact.subscriptionStatus]}
                      </Td>
                      {segment.kind === "fixed" && props.canWrite ? (
                        <Td>
                          <IconButton
                            size="xs"
                            label={`Remove ${contact.displayName} from ${segment.name}`}
                            onClick={() =>
                              void run(() =>
                                call("segments.removeContacts", {
                                  teamId,
                                  segmentId: segment.id,
                                  contactIds: [contact.id],
                                }),
                              )
                            }
                          >
                            <CloseIcon className="size-3.5" />
                          </IconButton>
                        </Td>
                      ) : null}
                    </Tr>
                  )
                })}
                <SpacerRow height={virtual.after} />
              </tbody>
            </Table>
          </TableScroll>
        )}
      </ViewBody>
    </Card>
  )
}
