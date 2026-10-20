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

  if (segment.isPending) return <main className="card main" />
  if (segment.isError) {
    return (
      <main className="card main">
        <div className="body">
          <LoadFailed
            title="This segment didn't load"
            message={messageOf(segment.error)}
            onRetry={() => void segment.refetch()}
          />
        </div>
      </main>
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
    <main className="card main">
      <div className="hd1">
        <h1 className="crumb">
          <Link className="root" to="/t/$teamId/segments" params={{ teamId }}>
            Segments
          </Link>
          <span className="sep" aria-hidden="true">
            /
          </span>
          {renaming ? (
            <input
              className="crumb-inp"
              aria-label="Segment name"
              defaultValue={segment.name}
              maxLength={80}
              // biome-ignore lint/a11y/noAutofocus: the person just chose to rename
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
            <button className="linkish" type="button" title="Rename" onClick={() => setRenaming(true)}>
              {segment.name}
            </button>
          ) : (
            <span>{segment.name}</span>
          )}
        </h1>
        <span className="pill">{segment.kind === "dynamic" ? "Dynamic" : "Fixed"}</span>
        <div className="spacer" />
        {dirty ? (
          <>
            <button className="btn ghost" type="button" onClick={() => setFilter(segment.filter ?? EMPTY_FILTER)}>
              Reset
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() =>
                void run(() => call("segments.update", { teamId, segmentId: segment.id, filter }), "Filter saved.")
              }
            >
              Save filter
            </button>
          </>
        ) : null}
        {props.canWrite && !dirty ? (
          confirmDelete ? (
            <span className="confirm">
              <button className="btn ghost" type="button" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                className="btn danger-solid"
                type="button"
                onClick={() =>
                  void run(async () => {
                    await call("segments.delete", { teamId, segmentId: segment.id })
                    await navigate({ to: "/t/$teamId/segments", params: { teamId } })
                    return undefined
                  })
                }
              >
                Delete segment
              </button>
            </span>
          ) : (
            <button className="btn ghost" type="button" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )
        ) : null}
      </div>

      <div className="hd2">
        {segment.kind === "dynamic" ? (
          props.canWrite ? (
            <FilterBar fields={filterInfo} filter={filter} onChange={setFilter} companies={companyOptions} />
          ) : (
            <span className="sm-t c-muted" style={{ marginLeft: 7 }}>
              Everyone matching this segment's filter.
            </span>
          )
        ) : props.canWrite ? (
          <span className="fchip-wrap">
            <button className="btn ghost sm" type="button" onClick={() => setPicking(true)}>
              <PlusIcon className="size-3.5" />
              Add contacts
            </button>
            {picking ? (
              <Picker
                label="Add a contact"
                placeholder="Find a contact"
                heading="Contacts"
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
        <div className="spacer" />
        <span className="sm-t c-muted" style={{ marginRight: 7 }}>
          {shown.length} {shown.length === 1 ? "contact" : "contacts"} · {sendable} can be sent campaigns
        </span>
      </div>

      <div className="body">
        {shown.length === 0 ? (
          <div className="center">
            <div className="empty">
              <div className="e-ic">
                <SegmentIcon />
              </div>
              <h2>{segment.kind === "dynamic" ? "Nobody matches yet" : "No contacts yet"}</h2>
              <p>
                {segment.kind === "dynamic"
                  ? "Add a filter, or change it, to choose who this segment is."
                  : "Add contacts here, or select them on Contacts and add them to this segment."}
              </p>
            </div>
          </div>
        ) : (
          <div className="tablewrap">
            <table className="ctable">
              <caption className="vh">Contacts in {segment.name}</caption>
              <thead>
                <tr>
                  <th className="w-name" scope="col" style={{ paddingLeft: 14 }}>
                    Name
                  </th>
                  <th className="w-email col-wide" scope="col">
                    Primary email
                  </th>
                  <th scope="col">Subscription</th>
                  {segment.kind === "fixed" && props.canWrite ? (
                    <th scope="col" style={{ width: 44 }}>
                      <span className="vh">Remove</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((contact) => (
                  <tr key={contact.id}>
                    <td style={{ paddingLeft: 14 }}>
                      <Link
                        className="namebtn"
                        to="/t/$teamId/contacts"
                        params={{ teamId }}
                        search={{ contact: contact.id }}
                      >
                        <ContactAvatar contact={contact} />
                        <span className="n">{contact.displayName}</span>
                      </Link>
                    </td>
                    <td className={`col-wide ${contact.emails[0] ? "c-email" : "c-none"}`}>
                      {contact.emails.find((email) => email.isPrimary)?.address ?? contact.emails[0]?.address ?? "—"}
                    </td>
                    <td className={contact.subscriptionStatus === "subscribed" ? "c-muted" : "c-warn"}>
                      {SUBSCRIPTION_STATUS_LABELS[contact.subscriptionStatus]}
                    </td>
                    {segment.kind === "fixed" && props.canWrite ? (
                      <td>
                        <button
                          className="ibtn xs"
                          type="button"
                          aria-label={`Remove ${contact.displayName} from ${segment.name}`}
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
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {props.toast ? (
        <div className="toast" role="status">
          <span>{props.toast}</span>
        </div>
      ) : null}
    </main>
  )
}
