import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  appearanceProblems,
  type CustomField,
  DEFAULT_COLORS,
  DEFAULT_DARK_COLORS,
  type FieldProblem,
  FORM_REDIRECT_URL,
  type Form,
  type FormAppearance,
  type FormColors,
  type FormContactField,
  type FormContent,
  type FormField,
  type FormId,
  type Segment,
  type TeamId,
  type Topic,
} from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Fragment, type ReactNode, useMemo, useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { useFields } from "../lib/custom-fields.ts"
import { appOrigin, formKey, formsKey, useTopics } from "../lib/forms.ts"
import { SaveState, useAutosave } from "./composer.tsx"
import { type FormValues, FormView, fieldKey } from "./form-view.tsx"
import { CheckIcon, ChevronDown, CloseIcon, CopyIcon, GripIcon, PlusIcon } from "./icons.tsx"
import { problemFor, problemsOf } from "./record.tsx"
import { CopyField } from "./settings.tsx"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx"
import { TitleInput } from "./ui/email.tsx"
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  ErrorText,
  Field,
  Fieldset,
  Hint,
  IconButton,
  InfoTip,
  Input,
  Notice,
  Option,
  PageHeader,
  RadioCard,
  RadioCards,
  SegmentedControl,
  Select,
  Slider,
  SmallInput,
  Spacer,
  Textarea,
  TextButton,
} from "./ui/index.ts"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.tsx"

/*
 * The form designer (D144, docs/06-forms.md): the form as visitors see it on the left, its
 * settings on the right. The draft saves on its own; Publish puts it live as a new version.
 * Copy is edited in the side panel, next to each piece, and the preview updates as you type.
 */

/** Labels for the contact fields a form can ask. */
export const CONTACT_FIELD_LABELS: Readonly<Record<FormContactField, string>> = {
  email: "Email",
  firstName: "First name",
  lastName: "Last name",
  phone: "Phone",
  company: "Company",
  title: "Job title",
  city: "City",
  region: "State or region",
  country: "Country",
}

/** Contact fields "Set on every sign-up" can fill, as import targets name them. */
const SET_TARGETS: ReadonlyArray<{ readonly key: string; readonly label: string }> = [
  { key: "company", label: "Company" },
  { key: "title", label: "Job title" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
]

interface DraftState {
  readonly name: string
  readonly content: FormContent
  readonly allowedSites: ReadonlyArray<string> | null
}

const stateOf = (form: Form): DraftState => ({ name: form.name, content: form.draft, allowedSites: form.allowedSites })

/** The designer's tabs; the open one is in the address, so a refresh or a shared link keeps it. */
export const DESIGNER_TABS = ["fields", "submit", "topics", "style", "embed"] as const
export type DesignerTab = (typeof DESIGNER_TABS)[number]

export function FormDesigner(props: {
  readonly teamId: TeamId
  readonly form: Form
  readonly canWrite: boolean
  readonly tab: DesignerTab
  readonly onTab: (tab: DesignerTab) => void
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
    // Problems the designer shows beside their fields aren't sent: the server would only refuse them.
    if (appearanceProblems(value.content.appearance).length > 0) throw new Error("rules")
    if (redirectProblem(value.content)) throw new Error("page address")
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

  const discard = () => {
    const published = saved.published
    if (published) setDraft((current) => ({ ...current, content: published }))
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
          className="inline-flex h-8 items-center rounded-md px-2.5 text-muted no-underline hover:bg-hover hover:text-fg"
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
                <AfterSubmitPanel content={content} problems={fieldProblems} onChange={setContent} />
              </TabsContent>
              <TabsContent value="topics" className="p-4">
                <TopicsPanel teamId={teamId} content={content} topics={topics.data ?? []} onChange={setContent} />
              </TabsContent>
              <TabsContent value="style" className="p-4">
                <StylePanel
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
          label="Preview on"
          options={[
            { value: "dark", label: "Dark page" },
            { value: "light", label: "Light page" },
          ]}
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

type ContentChange = (change: (current: FormContent) => FormContent) => void

/** Fields that aren't consent boxes (those live under Topics), in order. */
const inputFields = (content: FormContent) => content.fields.filter((field) => field.kind !== "consent")
const consentFields = (content: FormContent) => content.fields.filter((field) => field.kind === "consent")

function FieldsPanel(props: {
  readonly content: FormContent
  readonly customFields: ReadonlyArray<CustomField>
  readonly onChange: ContentChange
}) {
  const { content, onChange } = props
  const inputs = inputFields(content)
  const setInputs = (next: ReadonlyArray<FormField>) =>
    onChange((current) => ({ ...current, fields: [...next, ...consentFields(current)] }))
  const update = (index: number, change: Partial<FormField>) =>
    setInputs(inputs.map((field, i) => (i === index ? ({ ...field, ...change } as FormField) : field)))
  const move = (from: number, to: number) => {
    if (to < 0 || to >= inputs.length || from === to) return
    const next = [...inputs]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    setInputs(next)
  }
  const used = new Set(inputs.map(fieldKey))
  const contactOptions = (Object.keys(CONTACT_FIELD_LABELS) as Array<FormContactField>).filter(
    (field) => field !== "email" && !used.has(field),
  )
  const customOptions = props.customFields.filter((field) => !used.has(`custom:${field.id}`))

  return (
    <div className="flex flex-col gap-5">
      <Fieldset legend="Copy" section>
        <Field label="Title" htmlFor="form-title">
          <Input
            id="form-title"
            maxLength={120}
            value={content.title}
            onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Description" htmlFor="form-description">
          <Textarea
            id="form-description"
            rows={2}
            maxLength={500}
            value={content.description}
            onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Button" htmlFor="form-button">
            <Input
              id="form-button"
              maxLength={60}
              value={content.submitLabel}
              onChange={(event) => onChange((current) => ({ ...current, submitLabel: event.target.value }))}
            />
          </Field>
          <Field
            label="Under the button"
            htmlFor="form-fine-print"
            info="Small print under the button. Your privacy policy link follows it, if the team has one (Settings → Forms)."
          >
            <Input
              id="form-fine-print"
              maxLength={300}
              value={content.finePrint}
              onChange={(event) => onChange((current) => ({ ...current, finePrint: event.target.value }))}
            />
          </Field>
        </div>
      </Fieldset>

      <Fieldset
        legend="Fields"
        section
        info="Every answer is saved to the contact. Consent boxes for topics are under Topics."
      >
        <SortableFields
          fields={inputs}
          customFields={props.customFields}
          onMove={move}
          onUpdate={update}
          onRemove={(index) => setInputs(inputs.filter((_, i) => i !== index))}
        />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <TextButton className="self-start">
                <PlusIcon className="size-3.5" />
                Add field
              </TextButton>
            }
          />
          <DropdownMenuContent className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Contact fields</DropdownMenuLabel>
              {contactOptions.map((field) => (
                <DropdownMenuItem
                  key={field}
                  onClick={() =>
                    setInputs([
                      ...inputs,
                      { kind: "contact", field, label: CONTACT_FIELD_LABELS[field], required: false },
                    ])
                  }
                >
                  {CONTACT_FIELD_LABELS[field]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {customOptions.length > 0 ? (
              <DropdownMenuGroup>
                <DropdownMenuLabel>Custom fields</DropdownMenuLabel>
                {customOptions.map((field) => (
                  <DropdownMenuItem
                    key={field.id}
                    onClick={() =>
                      setInputs([...inputs, { kind: "custom", fieldId: field.id, label: field.name, required: false }])
                    }
                  >
                    <span className="truncate">{field.name}</span>
                    <span className="ml-auto text-sm text-subtle">{field.type.replace("-", " ")}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </Fieldset>

      <Fieldset legend="Captured automatically" section>
        <div className="flex items-center gap-1">
          <Option>
            <Checkbox
              checked={content.captureTracking}
              onChange={(event) => onChange((current) => ({ ...current, captureTracking: event.target.checked }))}
            />
            Page and tracking parameters
          </Option>
          <InfoTip label="page and tracking parameters">
            The page the form is on and its UTM parameters, plus ad click IDs when the site passes them (Embed →
            Tracking). Each submission shows where it came from.
          </InfoTip>
        </div>
      </Fieldset>

      <SetOnEverySignUp content={content} customFields={props.customFields} onChange={onChange} />
    </div>
  )
}

/** Fixed values every sign-up gets (D144), such as Source = Launch page. */
function SetOnEverySignUp(props: {
  readonly content: FormContent
  readonly customFields: ReadonlyArray<CustomField>
  readonly onChange: ContentChange
}) {
  const entries = Object.entries(props.content.set)
  const targets = [
    ...SET_TARGETS,
    ...props.customFields.map((field) => ({ key: `custom:${field.id}`, label: field.name })),
  ]
  const write = (next: ReadonlyArray<readonly [string, string]>) =>
    props.onChange((current) => ({ ...current, set: Object.fromEntries(next) }))
  const free = targets.filter((target) => !(target.key in props.content.set))
  return (
    <Fieldset
      legend="Set on every sign-up"
      section
      info="Values every sign-up gets, such as Source = Website footer. A sign-up's own answer wins."
    >
      {entries.map(([key, value], index) => (
        <div key={key} className="flex items-center gap-2">
          <Select
            aria-label="Field"
            className="flex-1"
            value={key}
            onChange={(event) =>
              write(entries.map((entry, i) => (i === index ? ([event.target.value, entry[1]] as const) : entry)))
            }
          >
            {targets
              .filter((target) => target.key === key || !(target.key in props.content.set))
              .map((target) => (
                <option key={target.key} value={target.key}>
                  {target.label}
                </option>
              ))}
          </Select>
          <Input
            aria-label="Value"
            className="flex-1"
            maxLength={500}
            value={value}
            onChange={(event) =>
              write(entries.map((entry, i) => (i === index ? ([entry[0], event.target.value] as const) : entry)))
            }
          />
          <IconButton size="xs" label="Remove" onClick={() => write(entries.filter((_, i) => i !== index))}>
            <CloseIcon className="size-4" />
          </IconButton>
        </div>
      ))}
      {free.length > 0 ? (
        <TextButton className="self-start" onClick={() => write([...entries, [free[0]?.key ?? "", ""] as const])}>
          <PlusIcon className="size-3.5" />
          Add a value
        </TextButton>
      ) : null}
    </Fieldset>
  )
}

/**
 * Whether the draft can be saved: nothing is still being filled in. Until then it waits ("Not
 * saved yet"), which isn't an error: the field itself says what it needs.
 */
const draftComplete = (value: DraftState) =>
  appearanceProblems(value.content.appearance).length === 0 && !redirectProblem(value.content)

/** The draft fields whose problems show beside them, by the path the server names them. */
const INLINE_FIELDS: ReadonlySet<string> = new Set(["draft.afterSubmit.url"])

/** What's wrong with the page address visitors go to, if anything. */
const redirectProblem = (content: FormContent) =>
  content.afterSubmit.kind === "redirect" && !FORM_REDIRECT_URL.test(content.afterSubmit.url.trim())
    ? "Enter the page's full address, like https://example.com/thanks."
    : undefined

function AfterSubmitPanel(props: {
  readonly content: FormContent
  /** Problems from the last save, by field. */
  readonly problems: ReadonlyArray<FieldProblem> | undefined
  readonly onChange: ContentChange
}) {
  const { content, onChange } = props
  const after = content.afterSubmit
  // Checked as they type, but only shown once they've left the field, so a half-typed address
  // isn't called wrong.
  const [left, setLeft] = useState(false)
  const urlProblem =
    (left ? redirectProblem(content) : undefined) ?? problemFor(props.problems, "draft.afterSubmit.url")
  return (
    <div className="flex flex-col gap-5">
      <Fieldset legend="After they submit" section>
        <RadioCards
          name="after-submit"
          value={after.kind}
          onChange={(kind) =>
            onChange((current) => ({
              ...current,
              afterSubmit:
                kind === "message"
                  ? { kind: "message", title: "Check your inbox", body: "Click the link we sent you to confirm." }
                  : { kind: "redirect", url: "https://" },
            }))
          }
        >
          <RadioCard value="message" label="Show a message" />
          <RadioCard value="redirect" label="Go to a page" />
        </RadioCards>
        {after.kind === "message" ? (
          <>
            <Field label="Heading" htmlFor="after-title">
              <Input
                id="after-title"
                maxLength={120}
                value={after.title}
                onChange={(event) =>
                  onChange((current) => ({ ...current, afterSubmit: { ...after, title: event.target.value } }))
                }
              />
            </Field>
            <Field label="Message" htmlFor="after-body">
              <Textarea
                id="after-body"
                rows={3}
                maxLength={500}
                value={after.body}
                onChange={(event) =>
                  onChange((current) => ({ ...current, afterSubmit: { ...after, body: event.target.value } }))
                }
              />
            </Field>
          </>
        ) : (
          <Field
            label="Page address"
            htmlFor="after-url"
            info="Such as a thank-you page on your site. A full address, starting with https://."
            error={urlProblem}
          >
            <Input
              id="after-url"
              type="url"
              maxLength={2000}
              placeholder="https://example.com/thanks"
              aria-invalid={urlProblem ? true : undefined}
              onBlur={() => setLeft(true)}
              value={after.url}
              onChange={(event) =>
                onChange((current) => ({ ...current, afterSubmit: { kind: "redirect", url: event.target.value } }))
              }
            />
          </Field>
        )}
      </Fieldset>
      <Fieldset legend="Confirming their email" section>
        <div className="flex items-center gap-1">
          <Option>
            <Checkbox
              checked={content.doubleOptIn}
              onChange={(event) => {
                const on = event.target.checked
                onChange((current) => withConfirmCopy({ ...current, doubleOptIn: on }))
              }}
            />
            Ask them to confirm by email
          </Option>
          <InfoTip label="confirming by email">
            Nothing reaches your contacts until they click the link, so bots and typos leave no trace. Someone who had
            unsubscribed always has to confirm before they're subscribed again.
          </InfoTip>
        </div>
        {content.doubleOptIn ? null : (
          <Notice tone="warn">Sign-ups become contacts straight away. In the EU you may need proof they asked.</Notice>
        )}
      </Fieldset>
    </div>
  )
}

/**
 * The fields as cards to reorder (dnd-kit): drag a card by its grip, or focus the grip and use
 * Space and the arrow keys. The dragged card follows the pointer, tilted, while a faded copy holds
 * its place. Email stays first: the form always asks it first (D144).
 */
function SortableFields(props: {
  readonly fields: ReadonlyArray<FormField>
  readonly customFields: ReadonlyArray<CustomField>
  readonly onMove: (from: number, to: number) => void
  readonly onUpdate: (index: number, change: Partial<FormField>) => void
  readonly onRemove: (index: number) => void
}) {
  const sensors = useSensors(
    // A few pixels of movement before a drag starts, so clicking the grip doesn't drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [active, setActive] = useState<string>()
  const keys = props.fields.map(fieldKey)
  const labelOf = (key: string | number) => props.fields.find((field) => fieldKey(field) === key)?.label ?? "Field"
  const [first, ...rest] = props.fields
  const activeIndex = active === undefined ? -1 : keys.indexOf(active)
  const activeField = activeIndex >= 0 ? props.fields[activeIndex] : undefined
  const card = (field: FormField, index: number, handle?: ReactNode) => (
    <FieldCard
      field={field}
      customFields={props.customFields}
      handle={handle}
      onUpdate={(change) => props.onUpdate(index, change)}
      onRemove={() => props.onRemove(index)}
    />
  )
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setActive(String(event.active.id))}
      onDragCancel={() => setActive(undefined)}
      onDragEnd={(event) => {
        setActive(undefined)
        if (!event.over || event.active.id === event.over.id) return
        props.onMove(keys.indexOf(String(event.active.id)), keys.indexOf(String(event.over.id)))
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "To move a field, press Space, then the arrow keys, then Space again to drop it or Escape to cancel.",
        },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over ? `${labelOf(active.id)} is now at position ${keys.indexOf(String(over.id)) + 1}.` : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `${labelOf(active.id)} dropped at position ${keys.indexOf(String(over.id)) + 1}.`
              : `${labelOf(active.id)} dropped.`,
          onDragCancel: ({ active }) => `Moving ${labelOf(active.id)} canceled.`,
        },
      }}
    >
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {first ? <li>{card(first, 0)}</li> : null}
        <SortableContext items={keys.slice(1)} strategy={verticalListSortingStrategy}>
          {rest.map((field, offset) => (
            <SortableField key={fieldKey(field)} id={fieldKey(field)} label={field.label}>
              {(handle) => card(field, offset + 1, handle)}
            </SortableField>
          ))}
        </SortableContext>
      </ol>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeField ? (
          <div className="rotate-2 cursor-grabbing rounded-lg bg-raised shadow-pop motion-reduce:rotate-0">
            {card(activeField, activeIndex, <GripIcon className="size-4" />)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/** One reorderable field: the grip starts a drag; while dragging, the card stays as a faded slot. */
function SortableField(props: {
  readonly id: string
  readonly label: string
  readonly children: (handle: ReactNode) => ReactNode
}) {
  const sortable = useSortable({ id: props.id })
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={cn(sortable.isDragging && "opacity-35")}
    >
      {props.children(
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          className="grid size-6 cursor-grab touch-none place-items-center rounded-sm text-subtle hover:bg-hover hover:text-fg active:cursor-grabbing"
          aria-label={`Move ${props.label}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripIcon className="size-4" />
        </button>,
      )}
    </li>
  )
}

/** A field's card: what it asks, its label and placeholder, and whether it's required. */
function FieldCard(props: {
  readonly field: FormField
  readonly customFields: ReadonlyArray<CustomField>
  /** The grip, for fields that can move; Email has none. */
  readonly handle?: ReactNode
  readonly onUpdate: (change: Partial<FormField>) => void
  readonly onRemove: () => void
}) {
  const { field } = props
  const isEmail = field.kind === "contact" && field.field === "email"
  const custom = field.kind === "custom" ? props.customFields.find((entry) => entry.id === field.fieldId) : undefined
  const kindLabel = field.kind === "contact" ? CONTACT_FIELD_LABELS[field.field] : (custom?.name ?? "Custom field")
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-fill p-2.5">
      <div className="flex items-center gap-1.5">
        {props.handle}
        <span className={cn("min-w-0 truncate text-sm text-muted", !props.handle && "pl-1")}>{kindLabel}</span>
        {isEmail ? (
          <InfoTip label="why email is always asked">
            Every sign-up needs an email address: it's how Parley finds or creates the contact, and how it confirms the
            sign-up. So it's always asked first, and required.
          </InfoTip>
        ) : null}
        <span className="flex-1" />
        {isEmail ? null : (
          <IconButton size="xs" label={`Remove ${field.label}`} onClick={props.onRemove}>
            <CloseIcon className="size-4" />
          </IconButton>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label={`${kindLabel}: label`}
          placeholder="Label"
          maxLength={120}
          value={field.label}
          onChange={(event) => props.onUpdate({ label: event.target.value })}
        />
        <Input
          aria-label={`${kindLabel}: placeholder`}
          placeholder="Placeholder"
          maxLength={120}
          value={"placeholder" in field ? (field.placeholder ?? "") : ""}
          onChange={(event) =>
            props.onUpdate(event.target.value ? { placeholder: event.target.value } : { placeholder: undefined })
          }
        />
      </div>
      {isEmail ? null : (
        <Option>
          <Checkbox checked={field.required} onChange={(event) => props.onUpdate({ required: event.target.checked })} />
          Required
        </Option>
      )}
    </div>
  )
}

/** Template copy that only fits one way of signing up: with a confirmation email, and without. */
const CONFIRM_COPY = {
  on: {
    title: "Check your inbox",
    body: "Click the link we sent you to confirm.",
    finePrint: "We'll email you to confirm.",
  },
  off: { title: "You're in", body: "Thanks for signing up.", finePrint: "Unsubscribe anytime." },
} as const

/**
 * Copy still on the template's words for the other way of signing up, swapped to fit: turning
 * double opt-in off shouldn't leave "Check your inbox" behind. Edited copy is left alone.
 */
const withConfirmCopy = (content: FormContent): FormContent => {
  const from = content.doubleOptIn ? CONFIRM_COPY.off : CONFIRM_COPY.on
  const to = content.doubleOptIn ? CONFIRM_COPY.on : CONFIRM_COPY.off
  const message = content.afterSubmit
  return {
    ...content,
    finePrint: content.finePrint === from.finePrint ? to.finePrint : content.finePrint,
    afterSubmit:
      message.kind === "message" && message.title === from.title
        ? { kind: "message", title: to.title, body: to.body }
        : message,
  }
}

function TopicsPanel(props: {
  readonly teamId: TeamId
  readonly content: FormContent
  readonly topics: ReadonlyArray<Topic>
  readonly onChange: ContentChange
}) {
  const { content, onChange, teamId } = props
  const queryClient = useQueryClient()
  const consents = consentFields(content)
  const segments = useQuery({ queryKey: ["segments", teamId], queryFn: () => call("segments.list", { teamId }) })
  const fixed = (segments.data ?? []).filter((segment: Segment) => segment.kind === "fixed")
  const [newTopic, setNewTopic] = useState("")
  const [error, setError] = useState<string>()
  const setConsents = (next: ReadonlyArray<FormField>) =>
    onChange((current) => ({ ...current, fields: [...inputFields(current), ...next] }))
  const used = new Set(consents.map((field) => (field.kind === "consent" ? (field.topicId as string) : "")))
  const free = props.topics.filter((topic) => !used.has(topic.id))
  const add = (topic: Topic) =>
    setConsents([
      ...consents,
      { kind: "consent", topicId: topic.id, label: `Send me ${topic.name.toLowerCase()}.`, required: false },
    ])
  const create = async () => {
    const name = newTopic.trim()
    if (!name) return
    try {
      const topic = await call("topics.create", { teamId, name: name as never, mode: "opt-in" })
      await queryClient.invalidateQueries({ queryKey: ["topics", teamId] })
      setNewTopic("")
      setError(undefined)
      add(topic)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <Fieldset
        legend="Consent boxes"
        section
        info="Each box joins a topic when it's ticked, and starts unticked. Opt-in topics reach only people who joined them; opt-out topics reach everyone subscribed who hasn't left."
      >
        {consents.map((field, index) => {
          if (field.kind !== "consent") return null
          const topic = props.topics.find((entry) => entry.id === field.topicId)
          return (
            <div key={field.topicId} className="flex flex-col gap-2 rounded-lg bg-fill p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {topic?.name ?? "A deleted topic"}{" "}
                  <span className="text-subtle">· {topic?.mode === "opt-in" ? "opt-in" : "opt-out"}</span>
                </span>
                <IconButton
                  size="xs"
                  label="Remove"
                  onClick={() => setConsents(consents.filter((_, i) => i !== index))}
                >
                  <CloseIcon className="size-4" />
                </IconButton>
              </div>
              <Textarea
                aria-label={`Wording for ${topic?.name ?? "the topic"}`}
                rows={2}
                maxLength={300}
                value={field.label}
                onChange={(event) =>
                  setConsents(
                    consents.map((entry, i) => (i === index ? { ...field, label: event.target.value } : entry)),
                  )
                }
              />
              <Option>
                <Checkbox
                  checked={field.required}
                  onChange={(event) =>
                    setConsents(
                      consents.map((entry, i) => (i === index ? { ...field, required: event.target.checked } : entry)),
                    )
                  }
                />
                Required to submit
              </Option>
            </div>
          )
        })}
        {free.length > 0 ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <TextButton className="self-start">
                  <PlusIcon className="size-3.5" />
                  Add a consent box
                </TextButton>
              }
            />
            <DropdownMenuContent className="w-64">
              {free.map((topic) => (
                <DropdownMenuItem key={topic.id} onClick={() => add(topic)}>
                  <span className="truncate">{topic.name}</span>
                  <span className="ml-auto text-sm text-subtle">{topic.mode}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <div className="flex items-end gap-2">
          <Field label="New opt-in topic" htmlFor="new-topic" className="flex-1">
            <Input
              id="new-topic"
              maxLength={60}
              placeholder="Product updates"
              value={newTopic}
              onChange={(event) => setNewTopic(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create()
              }}
            />
          </Field>
          <Button variant="secondary" size="lg" disabled={!newTopic.trim()} onClick={() => void create()}>
            Create and add
          </Button>
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Fieldset>
      <Field
        label="Add every sign-up to a segment"
        htmlFor="form-segment"
        info="A fixed segment every confirmed sign-up joins, such as a launch list. Dynamic segments pick their own contacts, so they aren't offered."
      >
        <Select
          id="form-segment"
          value={content.segmentId ?? ""}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              segmentId: (event.target.value || null) as FormContent["segmentId"],
            }))
          }
        >
          <option value="">No segment</option>
          {fixed.map((segment) => (
            <option key={segment.id} value={segment.id}>
              {segment.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}

/** A form's rules as editable text: `.Button { text-transform: uppercase; }`. */
const rulesToText = (rules: FormAppearance["rules"]) =>
  Object.entries(rules)
    .map(
      ([selector, body]) =>
        `${selector} {\n${Object.entries(body)
          .map(([p, v]) => `  ${p}: ${v};`)
          .join("\n")}\n}`,
    )
    .join("\n\n")

const textToRules = (text: string): FormAppearance["rules"] => {
  const rules: Record<string, Record<string, string>> = {}
  for (const match of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = (match[1] ?? "").trim()
    if (!selector) continue
    const body: Record<string, string> = {}
    for (const declaration of (match[2] ?? "").split(";")) {
      const at = declaration.indexOf(":")
      if (at < 0) continue
      const property = declaration.slice(0, at).trim().toLowerCase()
      const value = declaration.slice(at + 1).trim()
      if (property && value) body[property] = value
    }
    rules[selector] = { ...rules[selector], ...body }
  }
  return rules
}

const COLOR_MODE_OPTIONS = [
  { value: "fixed", label: "Fixed" },
  { value: "light-dark", label: "Light and dark" },
] as const

const EDITING_OPTIONS = [
  { value: "light", label: "Light mode" },
  { value: "dark", label: "Dark mode" },
] as const

/** A scheme's colors, in the order the panel lists them (D148). */
const COLORS: ReadonlyArray<readonly [Exclude<keyof FormColors & string, "background">, string]> = [
  ["heading", "Heading"],
  ["text", "Text"],
  ["muted", "Muted text"],
  ["accent", "Accent"],
  ["buttonText", "Button text"],
  ["border", "Field border"],
]

const HEX = /^#[0-9a-f]{6}$/i

/** One color: a swatch to pick it and its value to type, kept in step. */
function ColourRow(props: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={`${props.label} color`}
        className="size-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-default disabled:opacity-40"
        value={HEX.test(props.value) ? props.value : "#888888"}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <label htmlFor={props.id} className="flex-1">
        {props.label}
      </label>
      <SmallInput
        id={props.id}
        className="w-28 font-mono"
        maxLength={60}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  )
}

function StylePanel(props: {
  readonly appearance: FormAppearance
  readonly problems: ReadonlyArray<{ readonly userMessage: string }>
  readonly onChange: ContentChange
  /** The preview's page; with light and dark colors, also which set is being edited. */
  readonly page: "dark" | "light"
  readonly onPage: (page: "dark" | "light") => void
}) {
  const { appearance } = props
  const [rulesText, setRulesText] = useState(() => rulesToText(appearance.rules))
  const setAppearance = (change: Partial<FormAppearance>) =>
    props.onChange((current) => ({ ...current, appearance: { ...current.appearance, ...change } }))
  // Fixed colors are one set; light and dark edits whichever mode the preview shows.
  const set: "colors" | "darkColors" =
    appearance.colorMode === "light-dark" && props.page === "dark" ? "darkColors" : "colors"
  const colors = appearance[set]
  const setColor = (key: keyof FormColors, value: string) =>
    props.onChange((current) => ({
      ...current,
      appearance: { ...current.appearance, [set]: { ...current.appearance[set], [key]: value } },
    }))
  const seeThrough = colors.background === "transparent"
  return (
    <div className="flex flex-col gap-5">
      <Fieldset
        legend="Colors"
        section
        info="Fixed: the same colors whatever the visitor's light or dark mode. Light and dark: one set for each, switching with the visitor's mode."
      >
        <SegmentedControl
          name="color-mode"
          label="Colors"
          options={COLOR_MODE_OPTIONS}
          value={appearance.colorMode}
          onChange={(colorMode) => setAppearance({ colorMode })}
        />
        {appearance.colorMode === "light-dark" ? (
          <SegmentedControl
            name="editing-mode"
            label="Colors for"
            options={EDITING_OPTIONS}
            value={props.page}
            onChange={props.onPage}
          />
        ) : null}
        <div className="flex flex-col gap-2">
          {COLORS.map(([key, label]) => (
            <ColourRow
              key={key}
              id={`color-${set}-${key}`}
              label={label}
              value={colors[key]}
              onChange={(value) => setColor(key, value)}
            />
          ))}
          <ColourRow
            id={`color-${set}-background`}
            label="Background"
            value={seeThrough ? "" : colors.background}
            disabled={seeThrough}
            onChange={(value) => setColor("background", value)}
          />
          <div className="flex items-center gap-1">
            <Option>
              <Checkbox
                checked={seeThrough}
                onChange={(event) =>
                  setColor(
                    "background",
                    event.target.checked
                      ? "transparent"
                      : (set === "darkColors" ? DEFAULT_DARK_COLORS : DEFAULT_COLORS).background,
                  )
                }
              />
              See-through
            </Option>
            <InfoTip label="see-through">Shows the page behind the form instead of a background color.</InfoTip>
          </div>
        </div>
      </Fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Font"
          htmlFor="form-font"
          info="Any font the page already loads, or one from the font stylesheet below."
        >
          <Input
            id="form-font"
            maxLength={120}
            placeholder="System"
            value={appearance.fontFamily ?? ""}
            onChange={(event) => setAppearance({ fontFamily: event.target.value.trim() ? event.target.value : null })}
          />
        </Field>
        <Field label="Labels" htmlFor="form-labels">
          <Select
            id="form-labels"
            value={appearance.labels}
            onChange={(event) => setAppearance({ labels: event.target.value as FormAppearance["labels"] })}
          >
            <option value="above">Above</option>
            <option value="floating">Floating</option>
            <option value="hidden">Hidden</option>
          </Select>
        </Field>
      </div>
      <Field
        label="Font stylesheet"
        htmlFor="form-font-url"
        info="A stylesheet that loads the font, such as https://fonts.googleapis.com/css2?family=Inter."
      >
        <Input
          id="form-font-url"
          type="url"
          maxLength={500}
          placeholder="https://"
          value={appearance.fonts[0] ?? ""}
          onChange={(event) =>
            setAppearance({ fonts: event.target.value.startsWith("https://") ? [event.target.value] : [] })
          }
        />
      </Field>
      <Slider
        label="Corners"
        labelClassName="w-24"
        min={0}
        max={24}
        step={1}
        value={appearance.radius}
        format={(n) => `${n}px`}
        onChange={(radius) => setAppearance({ radius })}
      />
      <Slider
        label="Spacing"
        labelClassName="w-24"
        min={8}
        max={32}
        step={1}
        value={appearance.spacing}
        format={(n) => `${n}px`}
        onChange={(spacing) => setAppearance({ spacing })}
      />
      <Field
        label="Rules"
        htmlFor="form-rules"
        info="CSS for the details colors and fonts don't cover, on .Form, .Title, .Description, .Label, .Input, .Checkbox, .Button, .FinePrint and .Message, with :hover, :focus or --invalid."
      >
        <Textarea
          id="form-rules"
          rows={6}
          className="font-mono text-sm"
          spellCheck={false}
          placeholder={".Button {\n  text-transform: uppercase;\n}"}
          value={rulesText}
          onChange={(event) => {
            setRulesText(event.target.value)
            setAppearance({ rules: textToRules(event.target.value) })
          }}
        />
      </Field>
      {props.problems.length > 0 ? (
        <div className="flex flex-col gap-1">
          {props.problems.map((problem) => (
            <ErrorText key={problem.userMessage}>{problem.userMessage}</ErrorText>
          ))}
          <Hint>Changes save once the rules are fixed.</Hint>
        </div>
      ) : null}
    </div>
  )
}

function EmbedPanel(props: {
  readonly teamId: TeamId
  readonly form: Form
  readonly appearance: FormAppearance
  readonly allowedSites: ReadonlyArray<string> | null
  readonly onSites: (sites: ReadonlyArray<string> | null) => void
}) {
  const { form, teamId } = props
  const origin = appOrigin()
  const [site, setSite] = useState("")
  // Tracking options belong to the site, which answers for its visitors' consent (D154).
  const [remember, setRemember] = useState<"off" | "visit" | "30" | "90">("off")
  const [clickIds, setClickIds] = useState(false)
  const options = [
    remember === "off" ? null : remember === "visit" ? "data-remember-utm" : `data-remember-utm="${remember}"`,
    clickIds ? "data-click-ids" : null,
  ].filter((entry): entry is string => entry !== null)
  // One line that wraps to fit, never hand-broken lines that also scroll.
  const optionText = options.map((entry) => ` ${entry}`).join("")
  const snippet = `<script src="${origin}/embed.js" data-parley-form="${form.id}"${optionText} async></script>`
  const everyPage = `<script src="${origin}/embed.js"${optionText} async></script>`
  const override = useMemo(() => {
    const example = { colors: { accent: props.appearance.colors.accent } }
    return `data-appearance='${JSON.stringify(example)}'`
  }, [props.appearance])
  const sites = props.allowedSites
  const addSite = () => {
    const value = site
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
    if (!value || sites?.includes(value)) return
    props.onSites([...(sites ?? []), value])
    setSite("")
  }

  const trackingSummary =
    remember === "off" && !clickIds
      ? "Off"
      : [REMEMBER_SUMMARY[remember], clickIds ? "click IDs" : null].filter(Boolean).join(" · ")
  const sitesSummary =
    sites === null
      ? "Any site"
      : sites.length === 0
        ? "No sites yet"
        : `Only ${sites.length} site${sites.length === 1 ? "" : "s"}`

  return (
    <div className="flex flex-col gap-5">
      {form.published === null ? (
        <Notice>Publish the form first. Until then, the snippet and link show nothing.</Notice>
      ) : null}
      <section className="flex flex-col gap-2">
        <Heading
          title="Embed snippet"
          info="Paste it where the form should appear. It sizes itself and passes on the page's UTM parameters. The options below add to it."
        />
        <SnippetCopy value={snippet} />
      </section>
      <section className="flex flex-col gap-2">
        <Heading
          title="Hosted link"
          info="The form on its own page, for social posts and emails. It works whatever sites you allow."
        />
        <CopyField value={`${origin}/f/${form.id}`} label="hosted link" />
      </section>

      <section className="flex flex-col">
        <h3 className="m-0 mb-1 text-sm font-normal text-muted">Options</h3>
        <OptionRow
          title="Tracking"
          info="What your site passes on about where a visitor came from. These change the embed snippet, and your site stores and sends them."
          summary={trackingSummary}
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <label htmlFor="remember-utm">Remember UTM parameters</label>
              <InfoTip label="remembering UTM parameters">
                Without it, a submission gets only the UTM parameters of the page the form is on. Remembering keeps the
                ones from the page a visitor lands on, in your site's browser storage, for as long as you pick.
              </InfoTip>
            </div>
            <Select
              id="remember-utm"
              value={remember}
              onChange={(event) => setRemember(event.target.value as typeof remember)}
            >
              <option value="off">No, only the page the form is on</option>
              <option value="visit">For the visit</option>
              <option value="30">For 30 days</option>
              <option value="90">For 90 days</option>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Option>
              <Checkbox checked={clickIds} onChange={(event) => setClickIds(event.target.checked)} />
              Pass ad click IDs
            </Option>
            <InfoTip label="click IDs">
              Google, Meta, Microsoft, LinkedIn, TikTok and X add an ID to ad clicks. Passing it lets you tie a sign-up
              to the ad.
            </InfoTip>
          </div>
          {remember !== "off" ? (
            <div className="flex flex-col gap-1.5">
              <Heading
                title="Also add to every page"
                small
                info="Catches the page a visitor lands on, before they reach the form. The same options, without a form."
              />
              <CopyField value={everyPage} label="every-page snippet" code />
            </div>
          ) : null}
          <Hint>Check your privacy policy and cookie consent cover these.</Hint>
        </OptionRow>
        <OptionRow
          title="Where it can appear"
          info="Browsers refuse to show the form on any other site. The hosted link always works."
          summary={sitesSummary}
        >
          <SegmentedControl
            name="where"
            label="Where it can appear"
            options={[
              { value: "any", label: "Any site" },
              { value: "only", label: "Only these sites" },
            ]}
            value={sites === null ? "any" : "only"}
            onChange={(value) => props.onSites(value === "any" ? null : [])}
            className="self-start"
          />
          {sites !== null ? (
            <>
              {sites.length > 0 ? (
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {sites.map((entry) => (
                    <li
                      key={entry}
                      className="inline-flex items-center gap-1 rounded-md bg-fill py-0.5 pr-0.5 pl-2 text-sm"
                    >
                      {entry}
                      <IconButton
                        size="xs"
                        label={`Remove ${entry}`}
                        onClick={() => props.onSites(sites.filter((s) => s !== entry))}
                      >
                        <CloseIcon className="size-3.5" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex gap-2">
                <Input
                  aria-label="Add a site"
                  placeholder="nitric.io or *.nitric.io"
                  value={site}
                  onChange={(event) => setSite(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addSite()
                  }}
                />
                <Button variant="secondary" size="lg" onClick={addSite} disabled={!site.trim()}>
                  Add
                </Button>
              </div>
            </>
          ) : null}
        </OptionRow>
        <OptionRow
          title="Match the page"
          info="Make the form match the page it's on. Add this to the embed snippet; only what it names changes. Here, the accent color."
          summary="Accent color"
        >
          <CopyField value={override} label="appearance override" code />
        </OptionRow>
      </section>

      {form.published !== null ? <SeenOnLink teamId={teamId} formId={form.id} /> : null}
    </div>
  )
}

const REMEMBER_SUMMARY = { off: null, visit: "for the visit", "30": "30 days", "90": "90 days" } as const

/** A section heading with its info tip. */
function Heading(props: { readonly title: string; readonly info: string; readonly small?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {props.small ? <span>{props.title}</span> : <h3 className="m-0 font-medium">{props.title}</h3>}
      <InfoTip label={props.title.toLowerCase()}>{props.info}</InfoTip>
    </div>
  )
}

/** The embed snippet, wrapped to fit (never scrolled), with one plain button to copy it all. */
function SnippetCopy(props: { readonly value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(props.value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <>
      <output
        aria-label="Embed snippet"
        className="rounded-md bg-fill px-3 py-2.5 font-mono text-sm leading-6 select-text"
      >
        {/* Long addresses may break after a slash, never mid-word; the copy is untouched. */}
        {props.value.split(/(?<=[^<]\/)/).map((part, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of a fixed string, never reordered
          <Fragment key={index}>
            {part}
            <wbr />
          </Fragment>
        ))}
      </output>
      <Button variant="primary" onClick={() => void copy()}>
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy embed snippet"}
      </Button>
    </>
  )
}

/** One of the Embed tab's options, folded to a line that says how it's set (design asset A). */
function OptionRow(props: {
  readonly title: string
  readonly info: string
  readonly summary: string
  readonly children: ReactNode
}) {
  return (
    <Collapsible className="border-t border-line last:border-b">
      <div className="flex h-11 items-center gap-1">
        <CollapsibleTrigger className="group flex h-8 items-center gap-2 rounded text-fg">
          <ChevronDown className="size-3.5 -rotate-90 text-subtle transition-transform group-data-panel-open:rotate-0" />
          {props.title}
        </CollapsibleTrigger>
        <InfoTip label={props.title.toLowerCase()}>{props.info}</InfoTip>
        <span className="ml-auto truncate text-sm text-muted">{props.summary}</span>
      </div>
      <CollapsibleContent className="flex flex-col gap-3 pb-4 pl-5.5">{props.children}</CollapsibleContent>
    </Collapsible>
  )
}

/** Where the form is seen, in one line; the details are with its submissions. */
function SeenOnLink(props: { readonly teamId: TeamId; readonly formId: FormId }) {
  const analytics = useQuery({
    queryKey: [...formKey(props.teamId, props.formId), "analytics"],
    queryFn: () => call("forms.analytics", { teamId: props.teamId, formId: props.formId }),
  })
  const pages = analytics.data?.pages ?? []
  const views = pages.reduce((sum, entry) => sum + entry.views, 0)
  const signUps = pages.reduce((sum, entry) => sum + entry.confirmed, 0)
  const top = pages[0]
  return (
    <Link
      to="/t/$teamId/forms/$formId/submissions"
      params={{ teamId: props.teamId, formId: props.formId }}
      search={{ tab: "seen-on" }}
      className="flex items-center gap-2.5 rounded-lg bg-hover p-3 text-fg no-underline shadow-card hover:bg-active"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">
          {pages.length === 0 ? "Not seen yet" : `Seen on ${pages.length} page${pages.length === 1 ? "" : "s"}`}
        </span>
        {pages.length > 0 ? (
          <span className="truncate text-sm text-muted">
            {views.toLocaleString()} views · {signUps.toLocaleString()} sign-ups
            {top ? ` · top: ${top.page || "Hosted page"}` : ""}
          </span>
        ) : null}
      </span>
      <span className="text-sm text-muted">Submissions</span>
    </Link>
  )
}
