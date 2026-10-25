import { CLICK_ID_PARAMETERS, type CustomField, type FormContent, readAnswers, UTM_PARAMETER } from "@parley/domain"
import type { FormValues } from "../components/form-view.tsx"

/*
 * Shared by the form page (/f/$formId) and the confirmation page: reading what embed.js passed in
 * the query, checking answers before sending them (the server checks again), and telling the
 * embedding page about size, submission and redirects.
 */

/** What embed.js passes in the form page's query string. */
export interface EmbedContext {
  readonly page: string
  readonly appearance: string | null
  readonly utm: Readonly<Record<string, string>>
  /** Ad click IDs: embed.js passes them only when the site opts in (D154). */
  readonly clickIds: Readonly<Record<string, string>>
}

export const embedContextOf = (search: string): EmbedContext => {
  const query = new URLSearchParams(search)
  const utm: Record<string, string> = {}
  const clickIds: Record<string, string> = {}
  for (const [key, value] of query) {
    if (!value) continue
    if (UTM_PARAMETER.test(key)) utm[key] = value.slice(0, 500)
    // Only from embed.js, which passes them when the site opts in (D154). On the hosted page
    // they'd come from the visitor's own address, with no site to have chosen it.
    else if (Object.hasOwn(CLICK_ID_PARAMETERS, key) && isEmbedded()) clickIds[key] = value.slice(0, 500)
  }
  return { page: (query.get("page") ?? "").slice(0, 2000), appearance: query.get("appearance"), utm, clickIds }
}

/** Problems with the answers by field key, worded as the server words them: it's the same check. */
export const checkAnswers = (
  content: FormContent,
  customFields: ReadonlyArray<CustomField>,
  values: FormValues,
): Record<string, string> =>
  readAnswers(content, new Map(customFields.map((field) => [field.id as string, field])), values).problems

/** Tells the page embedding the form something, if there is one. */
export const tellParent = (message: { readonly type: string } & Record<string, unknown>) => {
  if (typeof window === "undefined" || window.parent === window) return
  // Nothing in these messages is secret, and the embedding page's origin isn't known here.
  window.parent.postMessage(message, "*")
}

/** Keeps the embedding iframe as tall as the form (D144). */
export const reportHeight = (formId: string, element: HTMLElement): (() => void) => {
  let last = 0
  const send = () => {
    const height = Math.ceil(element.getBoundingClientRect().height)
    if (height !== last) {
      last = height
      tellParent({ type: "parley:resize", formId, height })
    }
  }
  const observer = new ResizeObserver(send)
  observer.observe(element)
  send()
  return () => observer.disconnect()
}

/** Whether the page is inside an iframe. */
export const isEmbedded = () => typeof window !== "undefined" && window.parent !== window
