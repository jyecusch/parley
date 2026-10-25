import type { Form, FormAppearance, FormId, TeamId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Fragment, type ReactNode, useId, useMemo, useState } from "react"
import { call } from "../../lib/client.ts"
import { useCopy } from "../../lib/copy.ts"
import { appOrigin, formKey } from "../../lib/forms.ts"
import { CheckIcon, ChevronDown, CloseIcon, CopyIcon } from "../icons.tsx"
import { CopyField } from "../settings.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx"
import {
  Button,
  Checkbox,
  Field,
  Hint,
  IconButton,
  InfoTip,
  Input,
  Notice,
  Option,
  SegmentedControl,
  Select,
} from "../ui/index.ts"
import type { EmbedTracking } from "./shared.tsx"

export function EmbedPanel(props: {
  readonly teamId: TeamId
  readonly form: Form
  readonly appearance: FormAppearance
  readonly allowedSites: ReadonlyArray<string> | null
  readonly onSites: (sites: ReadonlyArray<string> | null) => void
  /** Tracking options belong to the site, which answers for its visitors' consent (D154). */
  readonly tracking: EmbedTracking
  readonly onTracking: (tracking: EmbedTracking) => void
}) {
  const { form, teamId } = props
  const origin = appOrigin()
  const [site, setSite] = useState("")
  const { remember, clickIds } = props.tracking
  const setRemember = (next: EmbedTracking["remember"]) => props.onTracking({ ...props.tracking, remember: next })
  const setClickIds = (next: boolean) => props.onTracking({ ...props.tracking, clickIds: next })
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
      : [REMEMBER_SUMMARY[remember], clickIds ? (remember === "off" ? "Click IDs" : "click IDs") : null]
          .filter(Boolean)
          .join(" · ")
  const sitesSummary =
    sites === null
      ? "Any site"
      : sites.length === 0
        ? "Hosted page only"
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
          title="Hosted page"
          info="The form on its own page, for social posts and emails. It works whatever sites you allow."
        />
        <CopyField value={`${origin}/f/${form.id}`} label="hosted page link" />
      </section>

      <section className="flex flex-col">
        <h3 className="m-0 mb-1 text-sm font-normal text-muted">Options</h3>
        <OptionRow
          title="Tracking"
          info="What your site passes on about where a visitor came from. These change the embed snippet, and your site stores and sends them."
          summary={trackingSummary}
        >
          <Field
            label="Remember UTM parameters"
            htmlFor="remember-utm"
            info="Without it, a submission gets only the UTM parameters of the page the form is on. Remembering keeps the ones from the page a visitor lands on, in your site's browser storage, for as long as you pick."
          >
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
          </Field>
          <div className="flex items-center gap-1">
            <Option>
              <Checkbox checked={clickIds} onChange={(event) => setClickIds(event.target.checked)} />
              Pass ad click IDs
            </Option>
            <InfoTip label="click IDs">
              Google, Meta, Microsoft, LinkedIn, TikTok and X add an ID to ad clicks. Passing it lets you tie a
              submission to the ad.
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
          info="Browsers refuse to show the form on any other site. The hosted page always works."
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
                        <CloseIcon className="size-4" />
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

const REMEMBER_SUMMARY = { off: null, visit: "For the visit", "30": "30 days", "90": "90 days" } as const

/** A section heading with its info tip. */
export function Heading(props: { readonly title: string; readonly info: string; readonly small?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {props.small ? <span>{props.title}</span> : <h3 className="m-0 font-medium">{props.title}</h3>}
      <InfoTip label={props.title.toLowerCase()}>{props.info}</InfoTip>
    </div>
  )
}

/** The embed snippet, wrapped to fit (never scrolled), with one plain button to copy it all. */
function SnippetCopy(props: { readonly value: string }) {
  const { copied, copy } = useCopy()
  return (
    <>
      {/* code, not output: an output is a live region, and would read the whole tag at every change. */}
      <code className="block rounded-md bg-fill px-3 py-2.5 font-mono text-sm leading-6 select-text">
        {/* Long addresses may break after a slash, never mid-word; the copy is untouched. */}
        {props.value.split(/(?<=[^<]\/)/).map((part, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of a fixed string, never reordered
          <Fragment key={index}>
            {part}
            <wbr />
          </Fragment>
        ))}
      </code>
      <Button variant="primary" onClick={() => void copy(props.value)}>
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
  const summaryId = useId()
  return (
    <Collapsible className="border-t border-line last:border-b">
      <div className="flex h-11 items-center gap-1">
        {/* The summary describes the trigger, so screen readers hear how it's set. */}
        <CollapsibleTrigger
          className="group flex h-8 items-center gap-2 rounded font-medium text-fg"
          aria-describedby={summaryId}
        >
          <ChevronDown className="size-3.5 -rotate-90 text-subtle transition-transform group-data-panel-open:rotate-0" />
          {props.title}
        </CollapsibleTrigger>
        <InfoTip label={props.title.toLowerCase()}>{props.info}</InfoTip>
        <span id={summaryId} className="ml-auto truncate text-sm text-muted">
          {props.summary}
        </span>
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
  const confirmed = pages.reduce((sum, entry) => sum + entry.confirmed, 0)
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
            {views.toLocaleString()} views · {confirmed.toLocaleString()} confirmed
            {top ? ` · top: ${top.page || "Hosted page"}` : ""}
          </span>
        ) : null}
      </span>
      <span className="text-sm text-muted">Seen on</span>
    </Link>
  )
}
