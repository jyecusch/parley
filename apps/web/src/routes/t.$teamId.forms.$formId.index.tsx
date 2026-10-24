import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { DESIGNER_TABS, type DesignerTab, FormDesigner } from "../components/form-designer.tsx"
import { LoadFailed } from "../components/record.tsx"
import { Card, Centered } from "../components/ui/index.ts"
import { call, messageOf } from "../lib/client.ts"
import { formKey } from "../lib/forms.ts"

export const Route = createFileRoute("/t/$teamId/forms/$formId/")({
  validateSearch: (search: Record<string, unknown>): { tab?: DesignerTab } =>
    DESIGNER_TABS.includes(search.tab as DesignerTab) && search.tab !== "fields"
      ? { tab: search.tab as DesignerTab }
      : {},
  component: FormScreen,
})

const teamRoute = getRouteApi("/t/$teamId")

/** One form in the designer (D144). */
function FormScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const { formId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const form = useQuery({
    queryKey: formKey(teamId, formId),
    queryFn: () => call("forms.get", { teamId, formId: formId as never }),
  })
  if (form.isPending) return <Card as="main" className="grow-999 basis-140" />
  if (form.isError) {
    return (
      <Card as="main" className="grow-999 basis-140">
        <Centered>
          <LoadFailed
            title="This form didn't load"
            message={messageOf(form.error)}
            onRetry={() => void form.refetch()}
          />
        </Centered>
      </Card>
    )
  }
  return (
    <FormDesigner
      key={form.data.id}
      teamId={teamId}
      form={form.data}
      canWrite={ROLE_PERMISSIONS[team.role].has("email:write")}
      tab={tab ?? "fields"}
      onTab={(next) => void navigate({ search: next === "fields" ? {} : { tab: next }, replace: true })}
    />
  )
}
