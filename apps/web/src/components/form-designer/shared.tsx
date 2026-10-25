import { countryCodeOf, FORM_REDIRECT_URL, type FormContactField, type FormContent } from "@parley/domain"
import { ChevronDown, ChevronUp } from "../icons.tsx"
import { IconButton } from "../ui/index.ts"

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

export type ContentChange = (change: (current: FormContent) => FormContent) => void

/** Fields that aren't consent boxes (those live under Topics), in order. */
export const inputFields = (content: FormContent) => content.fields.filter((field) => field.kind !== "consent")
export const consentFields = (content: FormContent) => content.fields.filter((field) => field.kind === "consent")

/** What's wrong with a fixed value the server would refuse, if anything; the rest it checks itself. */
export const setValueProblem = (target: string, value: string) =>
  value.trim() === "" || (target === "country" && !countryCodeOf(value))

/** What's wrong with the page address visitors go to, if anything. */
export const redirectProblem = (content: FormContent) =>
  content.afterSubmit.kind === "redirect" && !FORM_REDIRECT_URL.test(content.afterSubmit.url.trim())
    ? "Enter the page's full address, like https://example.com/thanks."
    : undefined

/** Move up and Move down for a card in a list, the way custom fields reorder in Settings. */
export function MoveButtons(props: {
  readonly label: string
  readonly index: number
  readonly count: number
  readonly onMove: (to: number) => void
}) {
  return (
    <>
      <IconButton
        size="xs"
        label={`Move ${props.label} up`}
        disabled={props.index === 0}
        onClick={() => props.onMove(props.index - 1)}
      >
        <ChevronUp className="size-4" />
      </IconButton>
      <IconButton
        size="xs"
        label={`Move ${props.label} down`}
        disabled={props.index === props.count - 1}
        onClick={() => props.onMove(props.index + 1)}
      >
        <ChevronDown className="size-4" />
      </IconButton>
    </>
  )
}

/** The preview's page, which with light and dark colors is also the set being edited: one wording, one order. */
export const PAGE_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const

/** How long embed.js remembers UTM parameters, if at all (D154). */
export const REMEMBER_OPTIONS = ["off", "visit", "30", "90"] as const
/** The Embed tab's tracking options, which shape the snippet. */
export interface EmbedTracking {
  readonly remember: (typeof REMEMBER_OPTIONS)[number]
  readonly clickIds: boolean
}
