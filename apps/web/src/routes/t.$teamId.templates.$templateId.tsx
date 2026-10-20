import { ROLE_PERMISSIONS, type TeamId, type Template, type TemplateId } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Composer, SaveState, useAutosave } from "../components/composer.tsx"
import { EmailStyleSelect } from "../components/email-style-select.tsx"
import { LoadFailed } from "../components/record.tsx"
import { TitleInput } from "../components/ui/email.tsx"
import {
  Breadcrumb,
  BreadcrumbSeparator,
  Button,
  breadcrumbRootClass,
  Card,
  ErrorText,
  PageHeader,
  Spacer,
  ViewBody,
} from "../components/ui/index.ts"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/templates/$templateId")({ component: TemplateScreen })

const teamRoute = getRouteApi("/t/$teamId")

function TemplateScreen() {
  const { team } = teamRoute.useLoaderData()
  const { templateId } = Route.useParams()
  const teamId = team.id as TeamId
  const template = useQuery({
    queryKey: ["template", teamId, templateId],
    queryFn: () => call("templates.get", { teamId, templateId: templateId as TemplateId }),
  })
  if (template.isPending) return <Card as="main" className="flex-[999_1_35rem]" />
  if (template.isError) {
    return (
      <Card as="main" className="flex-[999_1_35rem]">
        <ViewBody>
          <LoadFailed
            title="This template didn't load"
            message={messageOf(template.error)}
            onRetry={() => void template.refetch()}
          />
        </ViewBody>
      </Card>
    )
  }
  return (
    <TemplateEditor
      key={template.data.id}
      teamId={teamId}
      template={template.data}
      canWrite={ROLE_PERMISSIONS[team.role].has("email:write")}
    />
  )
}

/** A template in the composer. Edits save on their own once typing pauses. */
function TemplateEditor(props: { readonly teamId: TeamId; readonly template: Template; readonly canWrite: boolean }) {
  const { teamId } = props
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(props.template)
  const [draft, setDraft] = useState({
    name: saved.name,
    subject: saved.subject,
    previewText: saved.previewText,
    body: saved.body,
    styleId: saved.styleId,
  })
  const [error, setError] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const savedFields = {
    name: saved.name,
    subject: saved.subject,
    previewText: saved.previewText,
    body: saved.body,
    styleId: saved.styleId,
  }

  const state = useAutosave(draft, savedFields, async (value) => {
    try {
      const next = await call("templates.update", {
        teamId,
        templateId: saved.id,
        ...value,
        name: value.name.trim() || "Untitled template",
      })
      setSaved(next)
      setError(undefined)
      await queryClient.invalidateQueries({ queryKey: ["templates", teamId] })
    } catch (failure) {
      setError(messageOf(failure))
      throw failure
    }
  })

  const startCampaign = async () => {
    try {
      const campaign = await call("campaigns.create", {
        teamId,
        name: draft.name || "Untitled campaign",
        templateId: saved.id,
      })
      await navigate({ to: "/t/$teamId/campaigns/$campaignId", params: { teamId, campaignId: campaign.id } })
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  return (
    <Card as="main" className="flex-[999_1_35rem]">
      <PageHeader>
        <Breadcrumb>
          <Link className={breadcrumbRootClass} to="/t/$teamId/templates" params={{ teamId }}>
            Templates
          </Link>
          <BreadcrumbSeparator />
          <TitleInput
            aria-label="Template name"
            maxLength={120}
            readOnly={!props.canWrite}
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </Breadcrumb>
        <SaveState state={state} />
        <Spacer />
        {props.canWrite ? (
          confirmDelete ? (
            <span className="inline-flex items-center gap-1">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger-solid"
                onClick={() =>
                  void call("templates.delete", { teamId, templateId: saved.id })
                    .then(() => queryClient.invalidateQueries({ queryKey: ["templates", teamId] }))
                    .then(() => navigate({ to: "/t/$teamId/templates", params: { teamId } }))
                    .catch((failure: unknown) => setError(messageOf(failure)))
                }
              >
                Delete template
              </Button>
            </span>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
              <Button variant="primary" onClick={() => void startCampaign()}>
                Use in a campaign
              </Button>
            </>
          )
        ) : null}
      </PageHeader>
      {error ? <ErrorText className="px-4 pt-2.5">{error}</ErrorText> : null}
      <Composer
        teamId={teamId}
        content={draft}
        readOnly={!props.canWrite}
        onChange={(change) => setDraft((current) => ({ ...current, ...change }))}
        previewKey={draft.styleId ?? ""}
        preview={(content) =>
          call("templates.preview", { teamId, templateId: saved.id, ...content, styleId: draft.styleId })
        }
        settings={
          <EmailStyleSelect
            teamId={teamId}
            value={draft.styleId}
            disabled={!props.canWrite}
            onChange={(styleId) => setDraft((current) => ({ ...current, styleId }))}
            hint="Campaigns made from this template start with this style."
          />
        }
      />
    </Card>
  )
}
