import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { ContactPanel, type Toast } from "../components/contact-panel.tsx"
import { isTyping } from "../components/shell.tsx"
import { Card, Centered, EmptyState, FloatingBar } from "../components/ui/index.ts"
import { messageOf } from "../lib/client.ts"
import { contactApi, deleteContacts } from "../lib/contacts.ts"
import { EMPTY_FILTER } from "../lib/index-view.ts"
import { useRecord, useRecordList } from "../lib/records.ts"

export const Route = createFileRoute("/t/$teamId/contacts/$contactId")({ component: ContactRecord })

const teamRoute = getRouteApi("/t/$teamId")

const DEFAULT_ORDER = { search: "", filter: EMPTY_FILTER, sort: null }

/**
 * A contact's full record view at its own URL (D55): the panel at full width. J and K move
 * through contacts in the list's default order; Escape goes back to the list with the panel open.
 */
function ContactRecord() {
  const { team } = teamRoute.useLoaderData()
  const { contactId } = Route.useParams()
  const teamId = team.id as TeamId
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const record = useRecord(contactApi, teamId, contactId)
  const list = useRecordList(contactApi, teamId, DEFAULT_ORDER)
  const contact = record.data
  const [toast, setToast] = useState<Toast>()
  const index = list.indexOf(contactId)
  const back = () => void navigate({ to: "/t/$teamId/contacts", params: { teamId }, search: { contact: contactId } })
  const move = (delta: number) => {
    if (index < 0) return
    const next = list.at(index + delta)
    // Loads the rows around the next one, so moving on doesn't wait.
    list.ensure(index + delta - 5, index + delta + 5)
    if (next) void navigate({ to: "/t/$teamId/contacts/$contactId", params: { teamId, contactId: next.id } })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === "j") move(1)
      else if (event.key === "k") move(-1)
      else if (event.key === "Escape") back()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (record.isLoading) return <Card as="main" className="flex-1" />
  if (!contact || contact.deletedAt) {
    return (
      <Card as="main" className="flex-1">
        <Centered>
          <EmptyState title="This contact isn't here">
            It may have been deleted. Deleted contacts can be restored from Contacts for 30 days.
          </EmptyState>
        </Centered>
      </Card>
    )
  }
  return (
    <>
      <ContactPanel
        key={contact.id}
        contact={contact}
        teamId={teamId}
        position={{ index, total: list.count }}
        onMove={move}
        onClose={() => void navigate({ to: "/t/$teamId/contacts", params: { teamId }, search: {} })}
        onDelete={() => {
          deleteContacts(queryClient, teamId, { ids: [contact.id] })
            .then(() => navigate({ to: "/t/$teamId/contacts", params: { teamId }, search: {} }))
            .catch((failure: unknown) => setToast({ text: messageOf(failure) }))
        }}
        onError={(text) => setToast({ text })}
        onToast={setToast}
        canWrite={ROLE_PERMISSIONS[team.role].has("records:write")}
        layout="full"
        onToggleLayout={back}
      />
      {toast ? (
        <FloatingBar role="status" className="pr-3.5">
          <span className="text-fg">{toast.text}</span>
        </FloatingBar>
      ) : null}
    </>
  )
}
