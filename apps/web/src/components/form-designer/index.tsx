import {
  appearanceProblems,
  type CustomField,
  type FieldProblem,
  type Form,
  type FormContent,
  type TeamId,
} from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { call, messageOf } from "../../lib/client.ts"
import { useFields } from "../../lib/custom-fields.ts"
import { formKey, formsKey, useTopics } from "../../lib/forms.ts"
import { SaveState, useAutosave } from "../composer.tsx"
import { type FormValues, FormView } from "../form-view.tsx"
import { problemsOf } from "../record.tsx"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb.tsx"
import { TitleInput } from "../ui/email.tsx"
import {
  Badge,
  Button,
  buttonClass,
  Card,
  cn,
  ErrorText,
  InfoTip,
  Notice,
  PageHeader,
  SegmentedControl,
  Spacer,
} from "../ui/index.ts"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.tsx"
import { EmbedPanel } from "./embed-panel.tsx"
import { FieldsPanel } from "./fields-panel.tsx"
import { type EmbedTracking, PAGE_OPTIONS, redirectProblem, setValueProblem } from "./shared.tsx"

export { type EmbedTracking, REMEMBER_OPTIONS } from "./shared.tsx"

import { StylePanel } from "./style-panel.tsx"
import { AfterSubmitPanel } from "./submit-panel.tsx"
import { TopicsPanel } from "./topics-panel.tsx"

/*
 * The form designer (D144, docs/06-forms.md): the form as visitors see it on the left, its
 * settings on the right. The draft saves on its own; Publish puts it live as a new version.
 * Copy is edited in the side panel, next to each piece, and the preview updates as you type.
 */

interface DraftState {
  readonly name: string
  readonly content: FormContent
  readonly allowedSites: ReadonlyArray<string> | null
}

const stateOf = (form: Form): DraftState => ({
  name: form.name,
  content: form.draft,
  allowedSites: form.allowedSites,
})

/** The designer's tabs; the open one is in the address, so a refresh or a shared link keeps it. */
export const DESIGNER_TABS = ["fields", "submit", "topics", "style", "embed"] as const
export type DesignerTab = (typeof DESIGNER_TABS)[number]

export function FormDesigner(props: {
  readonly teamId: TeamId
  readonly form: Form
  readonly canWrite: boolean
  readonly tab: DesignerTab
  readonly onTab: (tab: DesignerTab) => void
  readonly tracking: EmbedTracking
  readonly onTracking: (tracking: EmbedTracking) => void
}) {
  const { teamId } = props
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(props.form)
  const [draft, setDraft] = useState<DraftState>(() => stateOf(props.form))
  const [error, setError] = useState<string>()
  const [publishing, setPublishing] = useState(false)
  /** The page the preview sits on; with "Match the visitor", also the scheme it shows. */
  const [previewPage, setPreviewPage] = useState<"dark" | "light">("dark")
  const { fields: customFields } = useFields(teamId, "contact")
  const topics = useTopics(teamId)
  const settings = useQuery({
    queryKey: ["form-settings", teamId],
    queryFn: () => call("formSettings.get", { teamId }),
  })

  const problems = appearanceProblems(draft.content.appearance)
  const [fieldProblems, setFieldProblems] = useState<ReadonlyArray<FieldProblem>>()
  const content = draft.content
  const setContent = (change: (current: FormContent) => FormContent) =>
    setDraft((current) => ({ ...current, content: change(current.content) }))

  const save = async (value: DraftState) => {
    try {
      const next = await call("forms.update", {
        teamId,
        formId: saved.id,
        name: value.name.trim() || "Untitled form",
        draft: value.content,
        allowedSites: value.allowedSites,
      })
      setSaved(next)
      setError(undefined)
      setFieldProblems(undefined)
      queryClient.setQueryData(formKey(teamId, next.id), next)
      void queryClient.invalidateQueries({ queryKey: formsKey(teamId), exact: true })
    } catch (failure) {
      // Problems with a field the designer shows go beside it; anything else, at the top.
      const problems = problemsOf(failure)
      setFieldProblems(problems)
      const elsewhere = problems?.filter((problem) => !INLINE_FIELDS.has(problem.field))
      setError(problems && elsewhere?.length === 0 ? undefined : messageOf(failure))
      throw failure
    }
  }
  const state = useAutosave(draft, stateOf(saved), save, { isComplete: draftComplete })

  const publish = async () => {
    setPublishing(true)
    try {
      // The server publishes its draft, so this one is saved first.
      if (JSON.stringify(draft) !== JSON.stringify(stateOf(saved))) await save(draft)
      const next = await call("forms.publish", { teamId, formId: saved.id })
      setSaved(next)
      setError(undefined)
      queryClient.setQueryData(formKey(teamId, next.id), next)
      void queryClient.invalidateQueries({ queryKey: formsKey(teamId), exact: true })
    } catch (failure) {
      setError(messageOf(failure))
    }
    setPublishing(false)
  }

  /** Bumped by Discard changes, so panels holding text of their own (the rules) start again. */
  const [discarded, setDiscarded] = useState(0)
  const discard = () => {
    const published = saved.published
    if (published) setDraft((current) => ({ ...current, content: published }))
    setDiscarded((count) => count + 1)
  }

  const live = saved.published !== null
  const changed = !live || saved.hasDraftChanges || JSON.stringify(content) !== JSON.stringify(saved.draft)

  return (
    <Card as="main" className="grow-999 basis-140">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/t/$teamId/forms" params={{ teamId }} />}>Forms</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage render={(props) => <h1 {...props} className="flex min-w-0" />}>
                <TitleInput
                  aria-label="Form name"
                  maxLength={120}
                  readOnly={!props.canWrite}
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                />
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {live ? (
          saved.hasDraftChanges ? (
            <Badge>Draft changes</Badge>
          ) : (
            <Badge tone="strong">Published</Badge>
          )
        ) : (
          <Badge>Draft</Badge>
        )}
        {props.canWrite ? <SaveState state={state} /> : null}
        <Spacer />
        <Link
          className={cn(buttonClass({ variant: "ghost" }), "no-underline")}
          to="/t/$teamId/forms/$formId/submissions"
          params={{ teamId, formId: saved.id }}
        >
          Submissions <span className="ml-1.5 tabular-nums text-subtle">{saved.counts.submitted.toLocaleString()}</span>
        </Link>
        {props.canWrite && live && saved.hasDraftChanges ? (
          <Button variant="secondary" onClick={discard}>
            Discard changes
          </Button>
        ) : null}
        {props.canWrite ? (
          <Button
            variant="primary"
            disabled={publishing || !changed || !draftComplete(draft)}
            onClick={() => void publish()}
          >
            {publishing ? "Publishing…" : live ? "Publish changes" : "Publish"}
          </Button>
        ) : null}
      </PageHeader>
      {error ? <ErrorText className="border-b border-line px-4 py-2">{error}</ErrorText> : null}
      {/* Side by side, each scrolling on its own, so the preview is the window's height; stacked on narrow screens. */}
      <div className="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-y-auto">
        <Preview
          content={content}
          customFields={customFields}
          privacyPolicyUrl={settings.data?.privacyPolicyUrl ?? null}
          page={previewPage}
          onPage={setPreviewPage}
        />
        <aside
          aria-label="Form settings"
          className="flex min-h-0 w-96 shrink-0 flex-col border-l border-line max-lg:w-full"
        >
          <Tabs className="flex-1" value={props.tab} onValueChange={(value) => props.onTab(value as DesignerTab)}>
            <TabsList>
              <TabsTrigger value="fields">Fields</TabsTrigger>
              <TabsTrigger value="submit">Submit</TabsTrigger>
              <TabsTrigger value="topics">Topics</TabsTrigger>
              <TabsTrigger value="style">Style</TabsTrigger>
              <TabsTrigger value="embed">Embed</TabsTrigger>
            </TabsList>
            <fieldset disabled={!props.canWrite} className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
              <TabsContent value="fields" className="p-4">
                <FieldsPanel content={content} customFields={customFields} onChange={setContent} />
              </TabsContent>
              <TabsContent value="submit" className="p-4">
                <AfterSubmitPanel teamId={teamId} content={content} problems={fieldProblems} onChange={setContent} />
              </TabsContent>
              <TabsContent value="topics" className="p-4">
                <TopicsPanel teamId={teamId} content={content} topics={topics} onChange={setContent} />
              </TabsContent>
              <TabsContent value="style" className="p-4">
                <StylePanel
                  key={discarded}
                  appearance={content.appearance}
                  problems={problems}
                  onChange={setContent}
                  page={previewPage}
                  onPage={setPreviewPage}
                />
              </TabsContent>
              <TabsContent value="embed" className="p-4">
                <EmbedPanel
                  teamId={teamId}
                  form={saved}
                  appearance={content.appearance}
                  allowedSites={draft.allowedSites}
                  onSites={(allowedSites) => setDraft((current) => ({ ...current, allowedSites }))}
                  tracking={props.tracking}
                  onTracking={props.onTracking}
                />
              </TabsContent>
            </fieldset>
          </Tabs>
        </aside>
      </div>
    </Card>
  )
}

/** The form as visitors see it, on a dark or light page, submitting to its after-submit state. */
function Preview(props: {
  readonly content: FormContent
  readonly customFields: ReadonlyArray<CustomField>
  readonly privacyPolicyUrl: string | null
  readonly page: "dark" | "light"
  readonly onPage: (page: "dark" | "light") => void
}) {
  const { page, onPage: setPage } = props
  const [values, setValues] = useState<FormValues>({})
  const [sent, setSent] = useState(false)
  return (
    <section
      aria-label="Preview"
      className={cn(
        "relative flex min-h-0 min-w-0 grow-999 basis-112 flex-col items-center justify-center-safe overflow-auto bg-dots px-8 py-20 max-lg:min-h-112",
        page === "dark" ? "bg-canvas" : "bg-zinc-100",
      )}
    >
      {/* On the app's own surface, so it reads the same over a dark or a light preview page. It
          floats in the padding above the form, so the form sits in the middle of the preview. */}
      <div className="absolute top-8 flex items-center gap-2 rounded-lg bg-surface shadow-card">
        <SegmentedControl
          name="preview-page"
          label="Preview page"
          options={PAGE_OPTIONS}
          value={page}
          onChange={setPage}
        />
        <InfoTip label="the preview" className="mr-1.5">
          It works like the real form: submit it to see what visitors see next. Nothing is saved.
        </InfoTip>
        {sent ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSent(false)
              setValues({})
            }}
          >
            Show the form again
          </Button>
        ) : null}
      </div>
      <div className="w-full max-w-md">
        {sent && props.content.afterSubmit.kind === "redirect" ? (
          <Notice>Visitors go to {props.content.afterSubmit.url}</Notice>
        ) : (
          <FormView
            content={props.content}
            mode={page}
            customFields={props.customFields}
            privacyPolicyUrl={props.privacyPolicyUrl}
            values={values}
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
            onSubmit={() => setSent(true)}
            state={sent ? "sent" : "form"}
            idPrefix="designer"
          />
        )}
      </div>
    </section>
  )
}

/**
 * Whether the draft can be saved: nothing is still being filled in. Until then it waits ("Not
 * saved yet"), which isn't an error: the field itself says what it needs.
 */
const draftComplete = (value: DraftState) =>
  appearanceProblems(value.content.appearance).length === 0 &&
  !redirectProblem(value.content) &&
  !Object.entries(value.content.set).some(([target, text]) => setValueProblem(target, text))

/** The draft fields whose problems show beside them, by the path the server names them. */
const INLINE_FIELDS: ReadonlySet<string> = new Set(["draft.afterSubmit.url"])
