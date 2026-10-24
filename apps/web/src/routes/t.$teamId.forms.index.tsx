import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { FormIcon } from "../components/icons.tsx"
import { LoadFailed } from "../components/record.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "../components/ui/breadcrumb.tsx"
import { ItemTile, NameText, nameLinkClass, wideColumnClass } from "../components/ui/email.tsx"
import {
  Badge,
  Button,
  Card,
  Centered,
  Count,
  Dialog,
  EmptyState,
  ErrorText,
  Field,
  Fieldset,
  Hint,
  Input,
  PageHeader,
  RadioCard,
  RadioCards,
  Spacer,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
import { call, messageOf } from "../lib/client.ts"
import {
  conversionOf,
  formsKey,
  shownContent,
  TEMPLATES,
  topicNamesOf,
  useForms,
  useTopics,
  whereOf,
} from "../lib/forms.ts"
import { absolute, relative } from "../lib/time.ts"

export interface Search {
  readonly new?: true
}

export const Route = createFileRoute("/t/$teamId/forms/")({
  validateSearch: (search: Record<string, unknown>): Search =>
    search.new === true || search.new === "true" ? { new: true } : {},
  component: FormsScreen,
})

const teamRoute = getRouteApi("/t/$teamId")

/** The forms index view (D144): each form with its counts. Sign-ups are confirmed submissions. */
function FormsScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const canWrite = ROLE_PERMISSIONS[team.role].has("email:write")
  const forms = useForms(teamId)
  const topics = useTopics(teamId)
  const items = forms.data ?? []
  const creating = canWrite && search.new === true
  const setCreating = (open: boolean) => void navigate({ search: open ? { new: true } : {} })

  const newButton = canWrite ? (
    <Button variant="primary" onClick={() => setCreating(true)}>
      New form
    </Button>
  ) : null

  return (
    <Card as="main" className="grow-999 basis-140">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage render={(props) => <h1 {...props} />}>Forms</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {items.length > 0 ? <Count>{items.length}</Count> : null}
        <Spacer />
        {items.length > 0 ? newButton : null}
      </PageHeader>
      <ViewBody>
        {forms.isPending ? null : forms.isError ? (
          <LoadFailed title="Forms didn't load" message={messageOf(forms.error)} onRetry={() => void forms.refetch()} />
        ) : items.length === 0 ? (
          <Centered>
            <EmptyState icon={<FormIcon />} title="No forms yet" actions={newButton}>
              A form signs people up from your own websites: a newsletter, a waitlist, an event. Each sign-up becomes a
              contact once they confirm their email.
            </EmptyState>
          </Centered>
        ) : (
          <TableScroll>
            <Table>
              <caption className="sr-only">Forms</caption>
              <thead>
                <tr>
                  <Th scope="col" className="pl-4">
                    Name
                  </Th>
                  <Th className="w-36" scope="col">
                    Status
                  </Th>
                  <Th className="w-24 text-right" scope="col">
                    Views
                  </Th>
                  <Th className="w-24 text-right" scope="col" title="Confirmed submissions">
                    Sign-ups
                  </Th>
                  <Th className={`w-28 text-right ${wideColumnClass}`} scope="col" title="Sign-ups ÷ views">
                    Conversion
                  </Th>
                  <Th className={`w-44 ${wideColumnClass}`} scope="col">
                    Topics
                  </Th>
                  <Th className={`w-24 ${wideColumnClass}`} scope="col">
                    Updated
                  </Th>
                </tr>
              </thead>
              <tbody>
                {items.map((form) => {
                  const live = form.published !== null
                  return (
                    <Tr key={form.id}>
                      <Td className="pl-4">
                        <Link
                          className={nameLinkClass}
                          to="/t/$teamId/forms/$formId"
                          params={{ teamId, formId: form.id }}
                        >
                          <ItemTile icon={<FormIcon className="size-4" />} />
                          <NameText sub={whereOf(form)}>{form.name}</NameText>
                        </Link>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <Badge tone={live ? "strong" : "neutral"}>{live ? "Published" : "Draft"}</Badge>
                          {live && form.hasDraftChanges ? (
                            <span className="text-sm text-subtle">Draft changes</span>
                          ) : null}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums">{live ? form.counts.views.toLocaleString() : "—"}</Td>
                      <Td className="text-right tabular-nums">{live ? form.counts.confirmed.toLocaleString() : "—"}</Td>
                      <Td className={`text-right tabular-nums ${wideColumnClass}`}>
                        {live ? conversionOf(form) : "—"}
                      </Td>
                      <Td className={`truncate text-muted ${wideColumnClass}`}>
                        {topicNamesOf(shownContent(form), topics.data ?? []).join(", ") || "—"}
                      </Td>
                      <Td className={`text-subtle tabular-nums ${wideColumnClass}`} title={absolute(form.updatedAt)}>
                        {relative(form.updatedAt)}
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </TableScroll>
        )}
        {items.length > 0 ? (
          <Hint className="px-4 py-3">Sign-ups count confirmed submissions. Conversion is sign-ups ÷ views.</Hint>
        ) : null}
      </ViewBody>
      {creating ? <NewFormDialog teamId={teamId} onClose={() => setCreating(false)} /> : null}
    </Card>
  )
}

type Template = (typeof TEMPLATES)[number]["id"]

function NewFormDialog(props: { readonly teamId: TeamId; readonly onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [template, setTemplate] = useState<Template>("newsletter")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const placeholder = TEMPLATES.find((entry) => entry.id === template)?.label ?? "Newsletter"
  const create = async () => {
    setBusy(true)
    try {
      const form = await call("forms.create", {
        teamId: props.teamId,
        name: name.trim() || (template === "blank" ? "Untitled form" : `${placeholder} sign-up`),
        template,
      })
      await queryClient.invalidateQueries({ queryKey: formsKey(props.teamId) })
      await navigate({ to: "/t/$teamId/forms/$formId", params: { teamId: props.teamId, formId: form.id } })
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="New form"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void create()}>
            Create form
          </Button>
        </>
      }
    >
      <Fieldset legend="Start from">
        <RadioCards name="template" value={template} onChange={setTemplate}>
          {TEMPLATES.map((entry) => (
            <RadioCard key={entry.id} value={entry.id} label={entry.label} description={entry.description} />
          ))}
        </RadioCards>
      </Fieldset>
      <Field label="Name" htmlFor="form-name" hint="For your team. Visitors don't see it.">
        <Input
          id="form-name"
          maxLength={120}
          placeholder={template === "blank" ? "Untitled form" : `${placeholder} sign-up`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create()
          }}
        />
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}
