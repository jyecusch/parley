import {
  type Contact,
  type ContactId,
  contactFieldReader,
  type Filter,
  filterFields,
  matchesFilter,
  ROLE_PERMISSIONS,
  type Segment,
  type SegmentId,
  SUBSCRIPTION_STATUS_LABELS,
  type TeamId,
} from "@parley/domain"
import { useLiveQuery } from "@tanstack/react-db"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { Picker, type PickerItem } from "../components/affiliations.tsx"
import { FilterBar } from "../components/filters.tsx"
import { CloseIcon, PlusIcon, SegmentIcon } from "../components/icons.tsx"
import { ContactAvatar } from "../components/images.tsx"
import { LoadFailed } from "../components/record.tsx"
import { NameText, nameLinkClass, TitleInput, wideColumnClass } from "../components/ui/email.tsx"
import {
  Badge,
  Breadcrumb,
  BreadcrumbSeparator,
  Button,
  breadcrumbRootClass,
  Card,
  Centered,
  EmptyState,
  IconButton,
  PageHeader,
  Spacer,
  Table,
  TableScroll,
  Td,
  TextButton,
  Th,
  Toast,
  Toolbar,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
import { call, messageOf } from "../lib/client.ts"
import { companiesCollection } from "../lib/companies.ts"
import { contactsCollection } from "../lib/contacts.ts"
import { useFields } from "../lib/custom-fields.ts"
import { EMPTY_FILTER } from "../lib/index-view.ts"

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
  const [toast, setToast] = useState<string>()
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(undefined), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const refresh = async (next?: Segment) => {
    if (next) queryClient.setQueryData(key, next)
    await queryClient.invalidateQueries({ queryKey: ["segments", teamId] })
    await queryClient.invalidateQueries({ queryKey: ["segment-members", teamId, segmentId] })
  }

  if (segment.isPending) return <Card as="main" className="flex-[999_1_35rem]" />
  if (segment.isError) {
    return (
      <Card as="main" className="flex-[999_1_35rem]">
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
      onToast={setToast}
      toast={toast}
    />
  )
}

function SegmentView(props: {
  readonly teamId: TeamId
  readonly segment: Segment
  readonly canWrite: boolean
  readonly onChanged: (next?: Segment) => Promise<void>
  readonly onToast: (text: string) => void
  readonly toast: string | undefined
}) {
  const { segment, teamId } = props
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const contacts = contactsCollection(teamId, queryClient)
  const live = useLiveQuery((q) => q.from({ contact: contacts }), [contacts])
  const companyCollection = companiesCollection(teamId, queryClient)
  const companyLive = useLiveQuery((q) => q.from({ company: companyCollection }), [companyCollection])
  const { fields } = useFields(teamId, "contact")
  const filterInfo = useMemo(() => filterFields("contact", fields), [fields])
  const companyOptions = useMemo(
    () =>
      [...(companyLive.data ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((company) => ({ id: company.id as string, label: company.name })),
    [companyLive.data],
  )
  const [filter, setFilter] = useState<Filter>(segment.filter ?? EMPTY_FILTER)
  const dirty = segment.kind === "dynamic" && JSON.stringify(filter) !== JSON.stringify(segment.filter ?? EMPTY_FILTER)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [picking, setPicking] = useState(false)

  // A fixed segment's members, by id; the contacts themselves come from the live collection.
  const members = useQuery({
    queryKey: ["segment-members", teamId, segment.id],
    enabled: segment.kind === "fixed",
    queryFn: async () => {
      const ids: Array<string> = []
      let cursor: string | undefined
      for (let page = 0; page < 50; page++) {
        const result = await call("segments.contacts", {
          teamId,
          segmentId: segment.id,
          limit: 200,
          ...(cursor ? { cursor } : {}),
        })
        ids.push(...result.items.map((contact) => contact.id))
        if (!result.nextCursor) break
        cursor = result.nextCursor
      }
      return new Set(ids)
    },
  })

  const shown = useMemo(() => {
    const all = [...(live.data ?? [])] as Array<Contact>
    const inSegment =
      segment.kind === "dynamic"
        ? all.filter((contact) => matchesFilter(filter, contactFieldReader(contact)))
        : all.filter((contact) => members.data?.has(contact.id))
    return inSegment.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [live.data, segment.kind, filter, members.data])
  const sendable = shown.filter(
    (contact) => contact.subscriptionStatus === "subscribed" && contact.emails.length > 0,
  ).length

  const run = async (work: () => Promise<Segment | undefined>, done?: string) => {
    try {
      const next = await work()
      await props.onChanged(next)
      if (done) props.onToast(done)
    } catch (failure) {
      props.onToast(messageOf(failure))
    }
  }

  const pickable: ReadonlyArray<PickerItem> = useMemo(
    () =>
      ([...(live.data ?? [])] as Array<Contact>)
        .filter((contact) => !members.data?.has(contact.id))
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((contact) => ({
          id: contact.id,
          name: contact.displayName,
          sub: contact.emails[0]?.address,
          avatar: <ContactAvatar contact={contact} />,
        })),
    [live.data, members.data],
  )

  return (
    <Card as="main" className="flex-[999_1_35rem]">
      <PageHeader>
        <Breadcrumb>
          <Link className={breadcrumbRootClass} to="/t/$teamId/segments" params={{ teamId }}>
            Segments
          </Link>
          <BreadcrumbSeparator />
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
        </Breadcrumb>
        <Badge className="ml-2">{segment.kind === "dynamic" ? "Dynamic" : "Fixed"}</Badge>
        <Spacer />
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

      <Toolbar>
        {segment.kind === "dynamic" ? (
          props.canWrite ? (
            <FilterBar fields={filterInfo} filter={filter} onChange={setFilter} companies={companyOptions} />
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
          {shown.length} {shown.length === 1 ? "contact" : "contacts"} · {sendable} can be sent campaigns
        </span>
      </Toolbar>

      <ViewBody>
        {shown.length === 0 ? (
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
          <TableScroll>
            <Table>
              <caption className="sr-only">Contacts in {segment.name}</caption>
              <thead>
                <tr>
                  <Th className="w-[32%] pl-4 @max-[40rem]/content:w-auto" scope="col">
                    Name
                  </Th>
                  <Th className={`w-[36%] ${wideColumnClass}`} scope="col">
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
                {shown.map((contact) => (
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
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </ViewBody>
      {props.toast ? (
        <Toast>
          <span>{props.toast}</span>
        </Toast>
      ) : null}
    </Card>
  )
}
