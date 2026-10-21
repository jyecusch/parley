import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import type { ToastRequest as Toast } from "../components/affiliations.tsx"
import { CompanyPanel } from "../components/company-panel.tsx"
import { isTyping } from "../components/shell.tsx"
import { Card, Centered, EmptyState, FloatingBar } from "../components/ui/index.ts"
import { messageOf } from "../lib/client.ts"
import { companyApi, deleteCompanies } from "../lib/companies.ts"
import { EMPTY_FILTER } from "../lib/index-view.ts"
import { useRecord, useRecordList } from "../lib/records.ts"

export const Route = createFileRoute("/t/$teamId/companies/$companyId")({ component: CompanyRecord })

const teamRoute = getRouteApi("/t/$teamId")

const DEFAULT_ORDER = { search: "", filter: EMPTY_FILTER, sort: null }

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
  const record = useRecord(companyApi, teamId, companyId)
  const list = useRecordList(companyApi, teamId, DEFAULT_ORDER)
  const company = record.data
  const [toast, setToast] = useState<Toast>()
  const index = list.indexOf(companyId)
  const back = () => void navigate({ to: "/t/$teamId/companies", params: { teamId }, search: { company: companyId } })
  const move = (delta: number) => {
    if (index < 0) return
    const next = list.at(index + delta)
    // Loads the rows around the next one, so moving on doesn't wait.
    list.ensure(index + delta - 5, index + delta + 5)
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

  if (record.isLoading) return <Card as="main" className="flex-1" />
  if (!company || company.deletedAt) {
    return (
      <Card as="main" className="flex-1">
        <Centered>
          <EmptyState title="This company isn't here">
            It may have been deleted. Deleted companies can be restored from Companies for 30 days.
          </EmptyState>
        </Centered>
      </Card>
    )
  }
  return (
    <>
      <CompanyPanel
        key={company.id}
        company={company}
        teamId={teamId}
        position={{ index, total: list.count }}
        onMove={move}
        onClose={() => void navigate({ to: "/t/$teamId/companies", params: { teamId }, search: {} })}
        onDelete={() => {
          deleteCompanies(queryClient, teamId, { ids: [company.id] })
            .then(() => navigate({ to: "/t/$teamId/companies", params: { teamId }, search: {} }))
            .catch((failure: unknown) => setToast({ text: messageOf(failure) }))
        }}
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
