import type { AppearanceOverride, CustomField, DatabaseUnavailable, FormContent, FormId } from "@parley/domain"
import type { Challenge } from "altcha-lib"
import { Context, type Effect } from "effect"

/*
 * The public side of forms (D144–D147): what the form page, embed.js, the submit endpoint and the
 * confirmation link ask of the server. Nobody is signed in here; every call is about one form or
 * one confirmation token, and answers only what a visitor may see.
 */

/** The captcha a form's page loads (D147). */
export type CaptchaChallenge =
  /** Built-in proof of work: ALTCHA's widget solves `challenge` and sends the solution back. */
  | { readonly provider: "builtin"; readonly challenge: Challenge }
  | { readonly provider: "turnstile"; readonly siteKey: string; readonly mode: "invisible" | "managed" }

/** Everything the form page needs to show a published form. */
export interface RenderedForm {
  readonly formId: FormId
  readonly version: number
  readonly content: FormContent
  readonly customFields: ReadonlyArray<CustomField>
  readonly privacyPolicyUrl: string | null
  /** Signed: form, time and nonce (D147). The submission must bring it back. */
  readonly renderToken: string
  readonly captcha: CaptchaChallenge
}

/** Where a rendering happens, for analytics and appearance overrides. */
export interface RenderContext {
  /** The host page's URL, from embed.js (or "" on the hosted page). */
  readonly page: string
  /** Appearance overrides from the embed snippet; invalid ones are ignored. */
  readonly appearance?: AppearanceOverride | undefined
  /** The visitor's address, for the proof of work's difficulty (D147). */
  readonly ip?: string | undefined
  /** False when the page reloads the form for a fresh token after a failed try: not another view. */
  readonly countView?: boolean | undefined
}

/** A visitor's submission, as the form page sends it. */
export interface SubmissionInput {
  readonly renderToken: string
  readonly values: Readonly<Record<string, unknown>>
  /** The honeypot's value: anything but "" means a bot (D147). */
  readonly honeypot: string
  /** The built-in proof of work's solution, or the Turnstile token. */
  readonly captchaToken: string
  readonly page: string
  readonly utm: Readonly<Record<string, string>>
  /** Ad click IDs, sent only when the embedding site opts in (D154). */
  readonly clickIds: Readonly<Record<string, string>>
}

/** Who sent a request, for rate limits and the consent record (D150). */
export interface Visitor {
  readonly ip: string
  readonly userAgent: string
}

/**
 * What the visitor is told. Identical whether the email was new, existed or the submission was
 * held as spam (D145); only problems with the answers themselves are reported.
 */
export type SubmissionOutcome =
  | { readonly kind: "accepted"; readonly afterSubmit: FormContent["afterSubmit"]; readonly confirmByEmail: boolean }
  | { readonly kind: "invalid"; readonly problems: Readonly<Record<string, string>> }
  | { readonly kind: "unavailable" }

/** The page a confirmation link shows. */
export type ConfirmationPage =
  | {
      readonly kind: "confirmed"
      readonly content: FormContent
      readonly privacyPolicyUrl: string | null
    }
  | { readonly kind: "invalid" }

export class FormRuntime extends Context.Service<
  FormRuntime,
  {
    /** A published form to show, or undefined when there's none (deleted, never published). */
    readonly render: (
      formId: string,
      context: RenderContext,
    ) => Effect.Effect<RenderedForm | undefined, DatabaseUnavailable>
    /** The hostnames that may frame a form, for CSP frame-ancestors; null for any site. */
    readonly allowedSites: (formId: string) => Effect.Effect<ReadonlyArray<string> | null, DatabaseUnavailable>
    readonly submit: (
      formId: string,
      input: SubmissionInput,
      visitor: Visitor,
    ) => Effect.Effect<SubmissionOutcome, DatabaseUnavailable>
    readonly confirm: (token: string, visitor: Visitor) => Effect.Effect<ConfirmationPage, DatabaseUnavailable>
  }
>()("@parley/core/FormRuntime") {}
