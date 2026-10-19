import { type Company, ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useLiveQuery } from "@tanstack/react-db"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import type { ToastRequest as Toast } from "../components/affiliations.tsx"
import { CompanyPanel } from "../components/company-panel.tsx"
import { isTyping } from "../components/shell.tsx"
import { messageOf } from "../lib/client.ts"
import { companiesCollection } from "../lib/companies.ts"

export const Route = createFileRoute("/t/$teamId/companies/$companyId")({ component: CompanyRecord })

const teamRoute = getRouteApi("/t/$teamId")

/**
 * A company's full record view at its own URL (D55): the panel at full width. J and K move
 * through companies in the list's default order; Escape goes back to the list with the panel open.
 */
function CompanyRecord() {
  const { team } = teamRoute.useLoaderData()
  const { companyId } = Route.useParams()
  const teamId = team.id as TeamId
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const collection = companiesCollection(teamId, queryClient)
  const live = useLiveQuery((q) => q.from({ company: collection }), [collection])
  const companies = useMemo(
    () => ([...(live.data ?? [])] as Array<Company>).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [live.data],
  )
  const contact = companies.find((entry) => entry.id === companyId)
  const [toast, setToast] = useState<Toast>()
  const index = contact ? companies.indexOf(contact) : -1
  const back = () => void navigate({ to: "/t/$teamId/companies", params: { teamId }, search: { company: companyId } })
  const move = (delta: number) => {
    const next = companies[index + delta]
    if (next) void navigate({ to: "/t/$teamId/companies/$companyId", params: { teamId, companyId: next.id } })
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
            <h2>This company isn't here</h2>
            <p>It may have been deleted. Deleted companies can be restored from Companies for 30 days.</p>
          </div>
        </div>
      </main>
    )
  }
  return (
    <>
      <CompanyPanel
        key={contact.id}
        company={contact}
        teamId={teamId}
        position={{ index, total: companies.length }}
        onMove={move}
        onClose={() => void navigate({ to: "/t/$teamId/companies", params: { teamId }, search: {} })}
        onDelete={() => {
          const transaction = collection.delete(contact.id)
          transaction.isPersisted.promise
            .then(() => navigate({ to: "/t/$teamId/companies", params: { teamId }, search: {} }))
            .catch((failure: unknown) => setToast({ text: messageOf(failure) }))
        }}
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
