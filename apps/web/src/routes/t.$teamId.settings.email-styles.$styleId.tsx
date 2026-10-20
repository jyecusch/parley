import {
  type EmailFont,
  type EmailStyle,
  type EmailStyleColors,
  type EmailStyleId,
  type EmailStyleLayout,
  PLAIN_COLORS,
  type RenderedEmail,
  ROLE_PERMISSIONS,
  type TeamId,
} from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useBlocker, useNavigate } from "@tanstack/react-router"
import { useEffect, useId, useRef, useState } from "react"
import { EMAIL_FRAME_CLASS, EmailPreview } from "../components/email-preview.tsx"
import { readAsDataUrl } from "../components/markdown-toolbar.tsx"
import { LoadFailed } from "../components/record.tsx"
import {
  Breadcrumb,
  BreadcrumbSeparator,
  Button,
  breadcrumbRootClass,
  Card,
  cn,
  Dialog,
  ErrorText,
  Field,
  Fieldset,
  Hint,
  Input,
  PageHeader,
  SegmentedControl,
  Select,
  Spacer,
  Textarea,
  ViewBody,
} from "../components/ui/index.ts"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/email-styles/$styleId")({ component: StyleScreen })

const team = getRouteApi("/t/$teamId")

/** What the editor changes. The logo is kept as what to send: unchanged, a new image, or removed. */
interface Draft {
  readonly name: string
  readonly layout: EmailStyleLayout
  readonly logoAlign: "left" | "center"
  readonly headerText: string
  readonly footerAlign: "left" | "center" | "right"
  readonly colors: EmailStyleColors
  readonly font: EmailFont
  readonly customHtml: string
}

type LogoChange =
  | { readonly kind: "keep" }
  | { readonly kind: "remove" }
  | { readonly kind: "set"; readonly dataUrl: string; readonly previewUrl: string }

const STARTING_HTML = `<div style="max-width:600px;margin:0 auto;padding:24px;font-family:Helvetica,Arial,sans-serif">
  {{content}}
</div>`

const draftOf = (style: EmailStyle | undefined): Draft => ({
  name: style?.name ?? "",
  layout: style?.layout ?? "plain",
  logoAlign: style?.logoAlign ?? "left",
  headerText: style?.headerText ?? "",
  footerAlign: style?.footerAlign ?? "left",
  colors: style?.colors ?? PLAIN_COLORS,
  font: style?.font ?? "default",
  customHtml: style?.customHtml ?? "",
})

function StyleScreen() {
  const { team: current } = team.useLoaderData()
  const { styleId } = Route.useParams()
  const teamId = current.id as TeamId
  const isNew = styleId === "new"
  const style = useQuery({
    queryKey: ["email-style", teamId, styleId],
    enabled: !isNew,
    queryFn: () => call("emailStyles.get", { teamId, styleId: styleId as EmailStyleId }),
  })
  const canManage = ROLE_PERMISSIONS[current.role].has("email:manage")
  if (!isNew && style.isPending) return <Card as="main" className="flex-1" />
  if (!isNew && style.isError) {
    return (
      <Card as="main" className="flex-1">
        <ViewBody>
          <LoadFailed
            title="This email style didn't load"
            message={messageOf(style.error)}
            onRetry={() => void style.refetch()}
          />
        </ViewBody>
      </Card>
    )
  }
  return <StyleEditor key={style.data?.id ?? "new"} teamId={teamId} style={style.data} canManage={canManage} />
}

const LAYOUTS: ReadonlyArray<{ readonly value: EmailStyleLayout; readonly label: string; readonly hint: string }> = [
  { value: "plain", label: "Plain", hint: "Like a personal email" },
  { value: "card", label: "Card", hint: "Content on a card" },
  { value: "custom", label: "Custom HTML", hint: "Your own layout" },
]

const COLOR_FIELDS: ReadonlyArray<{ readonly key: keyof EmailStyleColors; readonly label: string }> = [
  { key: "text", label: "Text" },
  { key: "background", label: "Background" },
  { key: "link", label: "Links" },
  { key: "button", label: "Buttons" },
  { key: "buttonText", label: "Button text" },
]

/** Editing an email style (D116), with a live preview of sample content in it. */
function StyleEditor(props: {
  readonly teamId: TeamId
  readonly style: EmailStyle | undefined
  readonly canManage: boolean
}) {
  const { teamId } = props
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(props.style)
  const [draft, setDraft] = useState(draftOf(props.style))
  const [logo, setLogo] = useState<LogoChange>({ kind: "keep" })
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [width, setWidth] = useState<"desktop" | "phone">("desktop")
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(saved)) || logo.kind !== "keep"
  const disabled = !props.canManage
  const logoUrl = logo.kind === "set" ? logo.previewUrl : logo.kind === "remove" ? null : (saved?.logoUrl ?? null)
  const contentMissing = draft.layout === "custom" && !draft.customHtml.includes("{{content}}")

  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !busy,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const save = async () => {
    setBusy(true)
    setError(undefined)
    const fields = {
      layout: draft.layout,
      logoAlign: draft.logoAlign,
      headerText: draft.headerText.trim() || null,
      footerAlign: draft.footerAlign,
      colors: draft.colors,
      font: draft.font,
      customHtml: draft.layout === "custom" ? draft.customHtml : (saved?.customHtml ?? null),
      ...(logo.kind === "set" ? { logo: logo.dataUrl } : logo.kind === "remove" ? { logo: null } : {}),
    }
    try {
      const next = saved
        ? await call("emailStyles.update", { teamId, styleId: saved.id, name: draft.name.trim(), ...fields })
        : await call("emailStyles.create", { teamId, name: draft.name.trim(), ...fields })
      setSaved(next)
      setDraft(draftOf(next))
      setLogo({ kind: "keep" })
      queryClient.setQueryData(["email-style", teamId, next.id], next)
      await queryClient.invalidateQueries({ queryKey: ["email-styles", teamId] })
      setBusy(false)
      if (!saved) {
        await navigate({
          to: "/t/$teamId/settings/email-styles/$styleId",
          params: { teamId, styleId: next.id },
          replace: true,
        })
      }
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  return (
    <Card as="main" className="flex-1">
      <PageHeader>
        <Breadcrumb>
          <span className="text-muted">Settings</span>
          <BreadcrumbSeparator />
          <Link className={breadcrumbRootClass} to="/t/$teamId/settings/email-styles" params={{ teamId }}>
            Email styles
          </Link>
          <BreadcrumbSeparator />
          <span className="truncate">{saved ? saved.name : "New email style"}</span>
        </Breadcrumb>
        <Spacer />
        {dirty && saved ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(draftOf(saved))
              setLogo({ kind: "keep" })
            }}
          >
            Discard changes
          </Button>
        ) : null}
        {props.canManage ? (
          <Button
            variant="primary"
            disabled={busy || !dirty || !draft.name.trim() || contentMissing}
            onClick={() => void save()}
          >
            {saved ? "Save" : "Create email style"}
          </Button>
        ) : null}
      </PageHeader>
      {error ? <ErrorText className="px-4 pt-2.5">{error}</ErrorText> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,28rem)_minmax(0,1fr)] overflow-auto @max-4xl/content:grid-cols-1">
        <form
          className="flex flex-col gap-5 overflow-auto border-r border-line p-5 @max-4xl/content:border-r-0"
          onSubmit={(event) => {
            event.preventDefault()
            if (dirty && draft.name.trim() && !contentMissing) void save()
          }}
        >
          <Field label="Name" htmlFor="style-name" hint="For your team. Recipients don't see it.">
            <Input
              id="style-name"
              maxLength={80}
              disabled={disabled}
              placeholder="Product newsletter"
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </Field>

          <Fieldset legend="Layout">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Layout">
              {LAYOUTS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer flex-col gap-1.5 rounded-lg p-2.5 text-sm inset-ring inset-ring-line-strong hover:bg-hover has-checked:inset-ring-2 has-checked:inset-ring-fg has-focus-visible:outline-2 has-focus-visible:outline-focus"
                >
                  <input
                    type="radio"
                    name="layout"
                    className="sr-only"
                    disabled={disabled}
                    checked={draft.layout === option.value}
                    onChange={() => {
                      set("layout", option.value)
                      if (option.value === "custom" && !draft.customHtml) set("customHtml", STARTING_HTML)
                    }}
                  />
                  <LayoutSketch layout={option.value} />
                  <span className="font-medium">{option.label}</span>
                  <span className="text-subtle">{option.hint}</span>
                </label>
              ))}
            </div>
          </Fieldset>

          {draft.layout === "custom" ? (
            <Field
              label="Custom HTML"
              htmlFor="style-html"
              error={contentMissing ? "Add {{content}} where the email's body should go." : undefined}
              hint="Put {{content}} where the body goes. Parley adds your footer right after it, in the same element, or where you put {{footer}}. Scripts, forms and iframes are removed."
            >
              <Textarea
                id="style-html"
                rows={12}
                spellCheck={false}
                disabled={disabled}
                className="font-mono text-sm"
                value={draft.customHtml}
                aria-invalid={contentMissing}
                onChange={(event) => set("customHtml", event.target.value)}
              />
            </Field>
          ) : (
            <>
              <LogoField
                teamId={teamId}
                disabled={disabled}
                url={logoUrl}
                align={draft.logoAlign}
                onAlign={(value) => set("logoAlign", value)}
                onChange={setLogo}
                onError={setError}
              />
              <Field
                label={
                  <>
                    Header line <span className="font-normal text-subtle">(optional)</span>
                  </>
                }
                htmlFor="style-header"
              >
                <Input
                  id="style-header"
                  maxLength={120}
                  disabled={disabled}
                  placeholder="The Acme newsletter"
                  value={draft.headerText}
                  onChange={(event) => set("headerText", event.target.value)}
                />
              </Field>
              <Fieldset legend="Colours">
                <div className="flex max-w-sm flex-col gap-2.5">
                  {COLOR_FIELDS.map((field) => (
                    <ColorField
                      key={field.key}
                      label={field.label}
                      disabled={disabled}
                      value={draft.colors[field.key]}
                      onChange={(value) => set("colors", { ...draft.colors, [field.key]: value })}
                    />
                  ))}
                </div>
              </Fieldset>
              <Field
                label="Font"
                htmlFor="style-font"
                hint="Email apps only show fonts the reader already has, so these are safe choices."
              >
                <Select
                  id="style-font"
                  disabled={disabled}
                  value={draft.font}
                  onChange={(event) => set("font", event.target.value as EmailFont)}
                >
                  <option value="default">The reader's default</option>
                  <option value="sans">Sans serif (Helvetica, Arial)</option>
                  <option value="serif">Serif (Georgia, Times)</option>
                </Select>
              </Field>
            </>
          )}
          <Fieldset legend="Footer">
            <SegmentedControl
              name="footer-align"
              label="Footer alignment"
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Centred" },
                { value: "right", label: "Right" },
              ]}
              value={draft.footerAlign}
              onChange={(value) => set("footerAlign", value)}
              className={cn("self-start", disabled && "pointer-events-none opacity-60")}
            />
            <Hint>Your legal name, postal address and unsubscribe link, under the content.</Hint>
          </Fieldset>
        </form>

        <section className="flex min-h-0 flex-col bg-canvas" aria-label="Preview">
          <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
            <span className="text-sm text-subtle">Preview with sample content</span>
            <Spacer />
            <SegmentedControl
              name="preview-width"
              label="Preview width"
              options={[
                { value: "desktop", label: "Desktop" },
                { value: "phone", label: "Phone" },
              ]}
              value={width}
              onChange={setWidth}
            />
          </div>
          <StylePreview
            teamId={teamId}
            styleId={saved?.id}
            draft={draft}
            logoUrl={logoUrl}
            phone={width === "phone"}
            skip={contentMissing}
          />
        </section>
      </div>
      {blocker.status === "blocked" ? (
        <Dialog
          title="Leave without saving?"
          onClose={blocker.reset}
          footer={
            <>
              <Button variant="ghost" onClick={blocker.reset}>
                Keep editing
              </Button>
              <Button variant="danger-solid" onClick={blocker.proceed}>
                Leave
              </Button>
            </>
          }
        >
          <p className="m-0">Your changes to this email style haven't been saved.</p>
        </Dialog>
      ) : null}
    </Card>
  )
}

/** A tiny picture of each layout for its choice. */
function LayoutSketch(props: { readonly layout: EmailStyleLayout }) {
  if (props.layout === "custom") {
    return (
      <span
        aria-hidden="true"
        className="grid h-11 place-items-center rounded-sm bg-primary font-mono text-xs text-on-primary [text-shadow:none]"
      >
        &lt;/&gt;
      </span>
    )
  }
  return props.layout === "card" ? (
    <span aria-hidden="true" className="block h-11 rounded-sm bg-fill p-1.5">
      <span className="block h-full rounded-xs bg-surface inset-ring inset-ring-line" />
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="flex h-11 flex-col gap-1 rounded-sm bg-surface p-1.5 inset-ring inset-ring-line"
    >
      <span className="h-1 w-4/5 rounded-full bg-control" />
      <span className="h-1 w-3/5 rounded-full bg-line-strong" />
    </span>
  )
}

/** The logo: upload, replace or remove, and whether it sits left or centred. */
function LogoField(props: {
  readonly teamId: TeamId
  readonly disabled: boolean
  readonly url: string | null
  readonly align: "left" | "center"
  readonly onAlign: (align: "left" | "center") => void
  readonly onChange: (change: LogoChange) => void
  readonly onError: (message: string) => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const choose = async (chosen: File) => {
    setBusy(true)
    try {
      const dataUrl = await readAsDataUrl(chosen)
      // Hosted once for the preview, which needs a web address; saving sends the image itself.
      const hosted = await call("emailImages.upload", { teamId: props.teamId, image: dataUrl })
      props.onChange({ kind: "set", dataUrl, previewUrl: hosted.url })
    } catch (failure) {
      props.onError(messageOf(failure))
    }
    setBusy(false)
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium">Logo</span>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="grid h-12 w-32 place-items-center overflow-hidden rounded-md bg-surface p-1.5 inset-ring inset-ring-line-strong">
          {props.url ? (
            <img src={props.url} alt="Logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-sm text-subtle">No logo</span>
          )}
        </div>
        <Button size="sm" disabled={props.disabled || busy} onClick={() => file.current?.click()}>
          {busy ? "Uploading…" : props.url ? "Replace" : "Upload"}
        </Button>
        {props.url ? (
          <Button
            size="sm"
            variant="danger"
            disabled={props.disabled || busy}
            onClick={() => props.onChange({ kind: "remove" })}
          >
            Remove
          </Button>
        ) : null}
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            if (chosen) void choose(chosen)
            event.target.value = ""
          }}
        />
      </div>
      {props.url ? (
        <SegmentedControl
          name="logo-align"
          label="Logo position"
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Centred" },
          ]}
          value={props.align}
          onChange={props.onAlign}
          className={cn(props.disabled && "pointer-events-none opacity-60")}
        />
      ) : (
        <Hint>PNG, JPEG, WebP, GIF or SVG. It's resized for email.</Hint>
      )}
    </div>
  )
}

/** A colour: the system picker and the hex code side by side, kept in step. */
function ColorField(props: {
  readonly label: string
  readonly value: string
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}) {
  const id = useId()
  const [typed, setTyped] = useState(props.value)
  useEffect(() => setTyped(props.value), [props.value])
  const valid = /^#[0-9a-fA-F]{6}$/.test(typed)
  return (
    <div className="flex items-center gap-2.5">
      <input
        type="color"
        aria-label={`${props.label} colour`}
        disabled={props.disabled}
        className="size-8 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value.toUpperCase())}
      />
      <label htmlFor={id} className="min-w-0 flex-1 text-sm">
        {props.label}
      </label>
      <Input
        id={id}
        className="h-8 w-24 font-mono text-sm uppercase"
        disabled={props.disabled}
        maxLength={7}
        value={typed}
        aria-invalid={!valid}
        onChange={(event) => {
          const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`
          setTyped(next)
          if (/^#[0-9a-fA-F]{6}$/.test(next)) props.onChange(next.toUpperCase())
        }}
      />
    </div>
  )
}

/** Sample content in the style being edited, rendered by the server so it matches what's sent. */
function StylePreview(props: {
  readonly teamId: TeamId
  readonly styleId: EmailStyleId | undefined
  readonly draft: Draft
  readonly logoUrl: string | null
  readonly phone: boolean
  readonly skip: boolean
}) {
  const [rendered, setRendered] = useState<RenderedEmail>()
  const [error, setError] = useState<string>()
  const { teamId, styleId, draft, logoUrl, skip } = props
  useEffect(() => {
    if (skip) return
    let current = true
    const timer = window.setTimeout(() => {
      call("emailStyles.preview", {
        teamId,
        ...(styleId ? { styleId } : {}),
        layout: draft.layout,
        logoUrl,
        logoAlign: draft.logoAlign,
        headerText: draft.headerText.trim() || null,
        footerAlign: draft.footerAlign,
        colors: draft.colors,
        font: draft.font,
        customHtml: draft.layout === "custom" ? draft.customHtml : null,
      }).then(
        (next) => {
          if (!current) return
          setRendered(next)
          setError(undefined)
        },
        (failure: unknown) => current && setError(messageOf(failure)),
      )
    }, 350)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [teamId, styleId, draft, logoUrl, skip])
  return (
    <>
      {error ? <ErrorText className="mx-3.5 mb-2.5">{error}</ErrorText> : null}
      <div className={cn("flex min-h-0 flex-1 flex-col", props.phone && "mx-auto w-full max-w-sm")}>
        {rendered ? (
          <EmailPreview html={rendered.html} label="Email style preview" />
        ) : (
          <div className={EMAIL_FRAME_CLASS} />
        )}
      </div>
    </>
  )
}
