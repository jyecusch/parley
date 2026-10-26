import {
  CLICK_ID_PARAMETERS,
  type CustomField,
  type CustomValue,
  type FormContent,
  formFieldKey,
  type Submission,
  type TeamId,
} from "@parley/domain"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { formatValue } from "../lib/custom-fields.ts"
import { cameFrom, whatHappened } from "../lib/forms.ts"
import { CheckIcon, CloseIcon } from "./icons.tsx"
import { PanelBar, PanelSubtitle } from "./record.tsx"
import { DropdownMenuItem } from "./ui/dropdown-menu.tsx"
import {
  Button,
  buttonClass,
  PanelBody,
  PanelHeader,
  PropertyRow,
  RecordPanel,
  RecordTitle,
  Section,
  SectionHeader,
} from "./ui/index.ts"

/** Spam is kept this long before it's deleted, unless released (D147). */
const SPAM_DAYS = 30

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
const when = (iso: string) => dateFormat.format(new Date(iso))

/**
 * One submission, opened from the Submissions screen (D160, design asset "Submission detail"): its
 * answers, where it came from, and its consent record (D150), with Release for spam.
 */
export function SubmissionPanel(props: {
  readonly teamId: TeamId
  readonly submission: Submission
  /** The form's content, for its fields' labels. */
  readonly content: FormContent | undefined
  readonly customFields: ReadonlyArray<CustomField>
  readonly position: { readonly index: number; readonly total: number }
  readonly onMove: (delta: number) => void
  readonly onClose: () => void
  readonly canWrite: boolean
  readonly releasing: boolean
  readonly onRelease: () => void
}) {
  const { submission } = props
  const consent = submission.consent
  const came = cameFrom(submission)
  const otherUtms = Object.entries(submission.utm).filter(
    ([key]) => !["utm_source", "utm_medium", "utm_campaign"].includes(key),
  )
  const answers = (props.content?.fields ?? []).filter((field) => field.kind !== "consent")
  const spamUntil = new Date(new Date(submission.createdAt).getTime() + SPAM_DAYS * 24 * 60 * 60 * 1000)

  return (
    <RecordPanel aria-label={`Submission from ${submission.email}`}>
      <PanelHeader>
        <PanelBar
          noun="submission"
          position={props.position}
          onMove={props.onMove}
          layout={undefined}
          onToggleLayout={undefined}
          onClose={props.onClose}
          menu={(closeMenu) => (
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard?.writeText(submission.email)
                closeMenu()
              }}
            >
              Copy email
            </DropdownMenuItem>
          )}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <RecordTitle>{submission.email}</RecordTitle>
          <PanelSubtitle>
            <span className={submission.status === "spam" ? "text-warn" : undefined}>{whatHappened(submission)}</span>
          </PanelSubtitle>
          <PanelSubtitle>Submitted {when(submission.createdAt)}</PanelSubtitle>
        </div>
        {submission.contactId ? (
          <Link
            className={buttonClass({ variant: "secondary", size: "sm" })}
            to="/t/$teamId/contacts"
            params={{ teamId: props.teamId }}
            search={{ contact: submission.contactId }}
          >
            Open contact
          </Link>
        ) : null}
        {submission.status === "spam" && props.canWrite ? (
          <div className="flex items-center gap-3">
            <Button size="sm" variant="primary" disabled={props.releasing} onClick={props.onRelease}>
              {props.releasing ? "Releasing…" : "Release"}
            </Button>
            <span className="text-sm text-subtle">Deleted {spamUntil.toLocaleDateString()} unless released</span>
          </div>
        ) : null}
      </PanelHeader>
      <PanelBody>
        <Section>
          <SectionHeader>Answers</SectionHeader>
          <div className="flex flex-col gap-1">
            <Row label="Email">{submission.email}</Row>
            {answers
              .filter((field) => !(field.kind === "contact" && field.field === "email"))
              .map((field) => {
                const key = formFieldKey(field)
                const definition =
                  field.kind === "custom" ? props.customFields.find((entry) => entry.id === field.fieldId) : undefined
                const value = submission.values[key]
                const text =
                  value === undefined || value === "" || (Array.isArray(value) && value.length === 0)
                    ? undefined
                    : definition
                      ? formatValue(definition, value as CustomValue)
                      : String(value)
                return (
                  <Row key={key} label={field.label}>
                    {text ?? <span className="text-subtle">—</span>}
                  </Row>
                )
              })}
          </div>
        </Section>
        <Section>
          <SectionHeader>Came from</SectionHeader>
          <div className="flex flex-col gap-1">
            <Row label="Page">{submission.page ?? "Hosted page"}</Row>
            {came ? <Row label="Campaign">{came.main}</Row> : null}
            {otherUtms.length > 0 ? (
              <Row label="Other UTMs">
                {otherUtms.map(([key, value]) => (
                  <div key={key}>
                    {key}: {value}
                  </div>
                ))}
              </Row>
            ) : null}
            {Object.keys(submission.clickIds).length > 0 ? (
              <Row label="Click ID">
                {Object.keys(submission.clickIds)
                  .map((key) => `${CLICK_ID_PARAMETERS[key] ?? key} (${key})`)
                  .join(", ")}
              </Row>
            ) : null}
          </div>
        </Section>
        <Section>
          <SectionHeader>Consent record</SectionHeader>
          <div className="flex flex-col gap-1">
            <Row label="Form">
              Version {consent.version}
              {consent.title ? ` · “${consent.title}”` : ""}
            </Row>
            {consent.finePrint ? <Row label="Fine print">{consent.finePrint}</Row> : null}
            <Row label="Privacy policy">
              {consent.privacyPolicyUrl ? (
                <a href={consent.privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="text-fg">
                  {consent.privacyPolicyUrl.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                <span className="text-subtle">None</span>
              )}
            </Row>
            {consent.consents.length > 0 ? (
              <Row label="Consent boxes">
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {consent.consents.map((entry) => (
                    <li key={entry.topicId} className="flex items-start gap-2">
                      {entry.ticked ? (
                        <CheckIcon className="mt-1 size-4 text-ok" />
                      ) : (
                        <CloseIcon className="mt-1 size-4 text-subtle" />
                      )}
                      <span className="min-w-0">
                        <span className="block">{entry.label}</span>
                        <span className="block text-sm text-subtle">
                          {entry.topicName || "A deleted topic"} · {entry.ticked ? "ticked" : "not ticked"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Row>
            ) : null}
            <Row label="Submitted from">
              <Origin ip={consent.sent.ip} userAgent={consent.sent.userAgent} />
            </Row>
            {consent.confirmed ? (
              <Row label="Confirmed">
                <span className="block">
                  {when(consent.confirmed.at)} from {consent.confirmed.ip}
                </span>
                <span className="block text-sm break-all text-subtle">{consent.confirmed.userAgent}</span>
              </Row>
            ) : null}
          </div>
        </Section>
      </PanelBody>
    </RecordPanel>
  )
}

function Row(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <PropertyRow label={props.label}>
      <div className="py-1 leading-6 break-words">{props.children}</div>
    </PropertyRow>
  )
}

function Origin(props: { readonly ip: string; readonly userAgent: string }) {
  return (
    <>
      <span className="block">{props.ip || "—"}</span>
      {props.userAgent ? <span className="block text-sm break-all text-subtle">{props.userAgent}</span> : null}
    </>
  )
}
