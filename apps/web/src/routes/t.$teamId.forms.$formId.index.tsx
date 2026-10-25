import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import {
  DESIGNER_TABS,
  type DesignerTab,
  type EmbedTracking,
  FormDesigner,
  REMEMBER_OPTIONS,
} from "../components/form-designer/index.tsx"
import { LoadFailed } from "../components/record.tsx"
import { Card, Centered, Skeleton } from "../components/ui/index.ts"
import { call, messageOf } from "../lib/client.ts"
import { formKey } from "../lib/forms.ts"

export interface DesignerSearch {
  readonly tab?: DesignerTab
  /** The Embed tab's tracking options (D154), in the address so switching tabs keeps them. */
  readonly remember?: EmbedTracking["remember"]
  readonly clickIds?: true
}

export const Route = createFileRoute("/t/$teamId/forms/$formId/")({
  validateSearch: (search: Record<string, unknown>): DesignerSearch => ({
    ...(DESIGNER_TABS.includes(search.tab as DesignerTab) && search.tab !== "fields"
      ? { tab: search.tab as DesignerTab }
      : {}),
    ...(REMEMBER_OPTIONS.includes(search.remember as EmbedTracking["remember"]) && search.remember !== "off"
      ? { remember: search.remember as EmbedTracking["remember"] }
      : {}),
    ...(search.clickIds === true || search.clickIds === "true" ? { clickIds: true as const } : {}),
  }),
  component: FormScreen,
})

/** The search with defaults left out, so the address stays short: /forms/<id>?tab=embed&clickIds=true. */
const searchOf = (search: {
  readonly tab?: DesignerTab | undefined
  readonly remember?: EmbedTracking["remember"] | undefined
  readonly clickIds?: boolean | undefined
}): DesignerSearch => ({
  ...(search.tab && search.tab !== "fields" ? { tab: search.tab } : {}),
  ...(search.remember && search.remember !== "off" ? { remember: search.remember } : {}),
  ...(search.clickIds ? { clickIds: true as const } : {}),
})

const teamRoute = getRouteApi("/t/$teamId")

/** One form in the designer (D144). */
function FormScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const { formId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const form = useQuery({
    queryKey: formKey(teamId, formId),
    queryFn: () => call("forms.get", { teamId, formId: formId as never }),
  })
  if (form.isPending) {
    return (
      <Card as="main" className="grow-999 basis-140">
        <div role="status" aria-label="Loading" className="flex flex-col gap-3 p-4">
          <Skeleton className="w-1/4" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Card>
    )
  }
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
      tab={search.tab ?? "fields"}
      onTab={(next) => void navigate({ search: (current) => searchOf({ ...current, tab: next }), replace: true })}
      tracking={{ remember: search.remember ?? "off", clickIds: search.clickIds === true }}
      onTracking={(next) =>
        void navigate({
          search: (current) => searchOf({ ...current, remember: next.remember, clickIds: next.clickIds }),
          replace: true,
        })
      }
    />
  )
}
