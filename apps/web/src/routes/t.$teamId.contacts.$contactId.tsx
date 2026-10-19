import { type Contact, ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useLiveQuery } from "@tanstack/react-db"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { ContactPanel, type Toast } from "../components/contact-panel.tsx"
import { isTyping } from "../components/shell.tsx"
import { messageOf } from "../lib/client.ts"
import { contactsCollection } from "../lib/contacts.ts"

export const Route = createFileRoute("/t/$teamId/contacts/$contactId")({ component: ContactRecord })

const teamRoute = getRouteApi("/t/$teamId")

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
  const collection = contactsCollection(teamId, queryClient)
  const live = useLiveQuery((q) => q.from({ contact: collection }), [collection])
  const contacts = useMemo(
    () => ([...(live.data ?? [])] as Array<Contact>).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [live.data],
  )
  const contact = contacts.find((entry) => entry.id === contactId)
  const [toast, setToast] = useState<Toast>()
  const index = contact ? contacts.indexOf(contact) : -1
  const back = () => void navigate({ to: "/t/$teamId/contacts", params: { teamId }, search: { contact: contactId } })
  const move = (delta: number) => {
    const next = contacts[index + delta]
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

  if (live.isLoading) return <main className="card main" />
  if (!contact) {
    return (
      <main className="card main">
        <div className="center">
          <div className="empty">
            <h2>This contact isn't here</h2>
            <p>It may have been deleted. Deleted contacts can be restored from Contacts for 30 days.</p>
          </div>
        </div>
      </main>
    )
  }
  return (
    <>
      <ContactPanel
        key={contact.id}
        contact={contact}
        teamId={teamId}
        position={{ index, total: contacts.length }}
        onMove={move}
        onClose={() => void navigate({ to: "/t/$teamId/contacts", params: { teamId }, search: {} })}
        onDelete={() => {
          const transaction = collection.delete(contact.id)
          transaction.isPersisted.promise
            .then(() => navigate({ to: "/t/$teamId/contacts", params: { teamId }, search: {} }))
            .catch((failure: unknown) => setToast({ text: messageOf(failure) }))
        }}
        onError={(text) => setToast({ text })}
        onToast={setToast}
        collection={collection}
        canWrite={ROLE_PERMISSIONS[team.role].has("records:write")}
        layout="full"
        onToggleLayout={back}
      />
      {toast ? (
        <div className="floatbar" role="status">
          <span className="n" style={{ color: "var(--fg)" }}>
            {toast.text}
          </span>
        </div>
      ) : null}
    </>
  )
}
