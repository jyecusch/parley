import {
  CLICK_ID_PARAMETERS,
  type Form,
  type FormContent,
  type Submission,
  type TeamId,
  type Topic,
  type Tracking,
} from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { call } from "./client.ts"

/*
 * Forms in the web app (D144): their query keys and the small things the screens share.
 */

export const formsKey = (teamId: TeamId) => ["forms", teamId] as const
export const formKey = (teamId: TeamId, formId: string) => ["forms", teamId, formId] as const

export const useForms = (teamId: TeamId) =>
  useQuery({ queryKey: formsKey(teamId), queryFn: () => call("forms.list", { teamId }) })

export const useTopics = (teamId: TeamId) =>
  useQuery({ queryKey: ["topics", teamId], queryFn: () => call("topics.list", { teamId }) })

/** Confirmed submissions ÷ views, as a percentage with one decimal, or "—" before any view. */
export const conversionOf = (form: Pick<Form, "counts">) =>
  form.counts.views > 0 ? `${((form.counts.confirmed / form.counts.views) * 100).toFixed(1)}%` : "—"

/** The content visitors see, or the draft before the first publish. */
export const shownContent = (form: Form): FormContent => form.published ?? form.draft

/** The topics a form's consent boxes join, by name. */
export const topicNamesOf = (content: FormContent, topics: ReadonlyArray<Topic>) =>
  content.fields
    .flatMap((field) => (field.kind === "consent" ? [field.topicId as string] : []))
    .map((id) => topics.find((topic) => topic.id === id)?.name)
    .filter((name): name is string => name !== undefined)

/** Where a form appears, in a few words, for the list. */
export const whereOf = (form: Form) =>
  form.published === null
    ? "Not published yet"
    : form.allowedSites === null
      ? "Any site"
      : form.allowedSites.length === 0
        ? "Hosted page only"
        : form.allowedSites.join(", ")

/** What happened to a submission, in a few words (as the submissions table says it). */
export const whatHappened = (submission: Submission) => {
  switch (submission.status) {
    case "confirmed":
      return submission.outcome === "created" ? "Confirmed · new contact" : "Confirmed · existing contact"
    case "waiting":
      return "Waiting"
    case "expired":
      return "Expired · never confirmed"
    case "spam":
      return submission.spamReason ? `Spam · ${submission.spamReason}` : "Spam"
  }
}

const MAIN_UTM = ["utm_source", "utm_medium", "utm_campaign"] as const

/**
 * Where a submission came from (D153), for a person: source / medium / campaign, then the other UTM
 * parameters and any ad click, or undefined when nothing was recorded.
 */
export const cameFrom = (
  tracking: Pick<Tracking, "utm" | "clickIds">,
): { readonly main: string; readonly more: ReadonlyArray<string> } | undefined => {
  const main = MAIN_UTM.map((key) => tracking.utm[key])
    .filter((value): value is string => Boolean(value))
    .join(" / ")
  const more = [
    ...Object.entries(tracking.utm)
      .filter(([key]) => !(MAIN_UTM as ReadonlyArray<string>).includes(key))
      .map(([key, value]) => `${key.slice(4).replaceAll("_", " ")}: ${value}`),
    ...[...new Set(Object.keys(tracking.clickIds).map((key) => CLICK_ID_PARAMETERS[key] ?? key))].map(
      (network) => `${network} ad click`,
    ),
  ]
  if (!main && more.length === 0) return undefined
  return { main: main || "No source given", more }
}

/** Where the app is served from, for embed snippets and hosted page links. */
export const appOrigin = () => (typeof window === "undefined" ? "" : window.location.origin)

export const TEMPLATES = [
  { id: "newsletter", label: "Newsletter", description: "Email and first name, with a consent box." },
  { id: "waitlist", label: "Waitlist", description: "For a launch: email, and what they'd use it for." },
  { id: "event", label: "Event", description: "Name, email and company for a webinar or meetup." },
  { id: "blank", label: "Blank", description: "Just an email field. Add the rest yourself." },
] as const
