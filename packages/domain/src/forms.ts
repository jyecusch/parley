import { Schema } from "effect"
import type { CustomField } from "./custom-field.ts"
import { CustomFieldId, FormId, SegmentId, SenderId, SubmissionId, TopicId } from "./ids.ts"

/*
 * Forms (D144–D150): forms a team designs in Parley and embeds on its websites.
 * See docs/06-forms.md.
 */

const Timestamp = Schema.String.annotate({ description: "ISO 8601 timestamp" })
const Text = (max: number) => Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(max))

/** Contact fields a form can ask for. Email is always asked, first. */
export const FormContactField = Schema.Literals([
  "email",
  "firstName",
  "lastName",
  "phone",
  "company",
  "title",
  "city",
  "region",
  "country",
])
export type FormContactField = typeof FormContactField.Type

/**
 * One field on a form: a contact field, a custom field, or a consent checkbox that joins a topic
 * (D149). Consent boxes are never ticked to start with.
 */
export const FormField = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("contact"),
    field: FormContactField,
    label: Text(120),
    placeholder: Schema.optional(Text(120)),
    required: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("custom"),
    fieldId: CustomFieldId,
    label: Text(120),
    placeholder: Schema.optional(Text(120)),
    required: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("consent"),
    topicId: TopicId,
    /** The words beside the checkbox: kept in each submission's consent record (D150). */
    label: Text(300),
    required: Schema.Boolean,
  }),
]).annotate({ title: "Form field" })
export type FormField = typeof FormField.Type

/** A page to send visitors to after submitting: https, with a host that has a dot. */
export const FORM_REDIRECT_URL = /^https:\/\/[^\s/]+\.[^\s/]+(\/[^\s]*)?$/

/** What a visitor sees after submitting: a message, or another page. */
export const AfterSubmit = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("message"), title: Text(120), body: Text(500) }),
  Schema.Struct({
    kind: Schema.Literal("redirect"),
    url: Schema.String.check(Schema.isMaxLength(2000), Schema.isPattern(FORM_REDIRECT_URL)).annotate({
      title: "Page address",
      description: "Where visitors go after submitting: a full https address, like https://example.com/thanks.",
    }),
  }),
])
export type AfterSubmit = typeof AfterSubmit.Type

/** A CSS color: hex, rgb(), hsl(), oklch() or a named color. */
export const CssColor = Schema.String.check(
  Schema.isMaxLength(60),
  Schema.isPattern(/^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\([0-9.,%\s/a-z-]+\)|[a-z]{3,20})$/),
)

/** A set of a form's colors (D148). The background can be see-through: the page's own shows. */
export const FormColors = Schema.Struct({
  heading: CssColor.annotate({ title: "Heading" }),
  text: CssColor.annotate({ title: "Text" }),
  /** Descriptions, hints and the fine print. */
  muted: CssColor.annotate({ title: "Muted text" }),
  /** The button and the focus ring. */
  accent: CssColor.annotate({ title: "Accent" }),
  buttonText: CssColor.annotate({ title: "Button text" }),
  background: Schema.Union([CssColor, Schema.Literal("transparent")]).annotate({
    title: "Background",
    description: 'A color, or "transparent" to show the page behind the form.',
  }),
  border: CssColor.annotate({ title: "Field border" }),
})
export type FormColors = typeof FormColors.Type

/**
 * How a form looks (D148), the same shape in the designer, the embed snippet and the API.
 * `colorMode` is "fixed" (`colors` always, whatever the visitor's light or dark mode) or
 * "light-dark" (`colors` in light mode, `darkColors` in dark mode). Font, size, corners, spacing and labels are shared. Rules style a fixed set of public classes,
 * with an allowlist of properties checked on save.
 */
/** Where a form's font stylesheets may come from: Google Fonts, Bunny Fonts and Adobe Fonts. */
export const FONT_HOSTS = ["fonts.googleapis.com", "fonts.bunny.net", "use.typekit.net"] as const
/** A font family's name: letters, digits, spaces and hyphens. */
export const FONT_FAMILY = /^[\p{L}\p{N} _-]*$/u
export const FONT_STYLESHEET = new RegExp(
  `^https://(${FONT_HOSTS.map((host) => host.replaceAll(".", "\\.")).join("|")})/`,
)

export const FormAppearance = Schema.Struct({
  colorMode: Schema.Literals(["fixed", "light-dark"]).annotate({
    title: "Colors",
    description: '"fixed": the same colors always. "light-dark": colors in light mode, darkColors in dark mode.',
  }),
  colors: FormColors.annotate({ title: "Colors", description: "Always when fixed; in light mode otherwise." }),
  darkColors: FormColors.annotate({ title: "Dark mode colors", description: 'Only with "light-dark".' }),
  /** A font family's name, such as "Inter": letters, digits, spaces and hyphens, so it can't break out of the CSS. */
  fontFamily: Schema.NullOr(Text(120).check(Schema.isPattern(FONT_FAMILY))),
  /** In px, 12–20. */
  fontSizeBase: Schema.Number.check(Schema.isBetween({ minimum: 12, maximum: 20 })),
  /** Corner radius in px, 0–24. */
  radius: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 24 })),
  /** Space between fields in px, 8–32. */
  spacing: Schema.Number.check(Schema.isBetween({ minimum: 8, maximum: 32 })),
  labels: Schema.Literals(["above", "hidden"]),
  /** Selector (".Button", ".Input:focus", ".Input--invalid"…) to CSS properties. */
  rules: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(200)))),
  /**
   * Stylesheets with @font-face, from a font service (FONT_HOSTS) only: any other stylesheet on
   * Parley's own page could read what visitors type or hide the consent wording (D148).
   */
  fonts: Schema.Array(Schema.String.check(Schema.isMaxLength(500), Schema.isPattern(FONT_STYLESHEET))).check(
    Schema.isMaxLength(3),
  ),
})
export type FormAppearance = typeof FormAppearance.Type

/** Some of a form's colors, to override one by one. */
const FormColorsOverride = Schema.Struct({
  heading: Schema.optional(FormColors.fields.heading),
  text: Schema.optional(FormColors.fields.text),
  muted: Schema.optional(FormColors.fields.muted),
  accent: Schema.optional(FormColors.fields.accent),
  buttonText: Schema.optional(FormColors.fields.buttonText),
  background: Schema.optional(FormColors.fields.background),
  border: Schema.optional(FormColors.fields.border),
})

/**
 * Overrides from where a form is embedded (D148): any part of the appearance but its font
 * stylesheets, colors one by one. What isn't given stays as the form has it. Fonts aren't
 * overridable: anyone can write an override into the form's address.
 */
export const AppearanceOverride = Schema.Struct({
  colorMode: Schema.optional(FormAppearance.fields.colorMode),
  colors: Schema.optional(FormColorsOverride),
  darkColors: Schema.optional(FormColorsOverride),
  fontFamily: Schema.optional(FormAppearance.fields.fontFamily),
  fontSizeBase: Schema.optional(FormAppearance.fields.fontSizeBase),
  radius: Schema.optional(FormAppearance.fields.radius),
  spacing: Schema.optional(FormAppearance.fields.spacing),
  labels: Schema.optional(FormAppearance.fields.labels),
  rules: Schema.optional(FormAppearance.fields.rules),
})
export type AppearanceOverride = typeof AppearanceOverride.Type

/** Everything a form's version holds: its copy, fields, behavior and look. */
export const FormContent = Schema.Struct({
  title: Text(120),
  description: Text(500),
  submitLabel: Text(60),
  /** Shown under the button, with the team's privacy policy link. */
  finePrint: Text(300),
  fields: Schema.Array(FormField).check(Schema.isMaxLength(30)),
  afterSubmit: AfterSubmit,
  /** On by default (D146): nothing touches contacts until the confirmation link is clicked. */
  doubleOptIn: Schema.Boolean,
  /** Who the confirmation email is from; null, or a sender deleted since, means the team's default sender (D162). */
  senderId: Schema.NullOr(SenderId),
  /** A fixed segment every confirmed submission's contact joins, or null. */
  segmentId: Schema.NullOr(SegmentId),
  /** Values set on every submission, keyed like import targets ("custom:<field id>", "title"). */
  set: Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(500))),
  /** Record the page the form is on and its tracking parameters with each submission (D153). */
  captureTracking: Schema.Boolean,
  appearance: FormAppearance,
})
export type FormContent = typeof FormContent.Type

export const FormName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(120))

/** Counts over a form's life (D144 analytics). */
export const FormCounts = Schema.Struct({
  views: Schema.Number,
  submitted: Schema.Number,
  confirmed: Schema.Number,
  waiting: Schema.Number,
  /** Never confirmed within the link's 7 days (D146). */
  expired: Schema.Number,
  spam: Schema.Number,
})
export type FormCounts = typeof FormCounts.Type

export const Form = Schema.Struct({
  id: FormId,
  name: Schema.String,
  /** What the designer edits. */
  draft: FormContent,
  /** What visitors see, or null before the first publish. */
  published: Schema.NullOr(FormContent),
  /** Increases with each publish; consent records name the version shown (D150). */
  version: Schema.Number,
  /** Whether the draft differs from what's published. */
  hasDraftChanges: Schema.Boolean,
  /** Hostnames that may frame the form ("nitric.io", "*.nitric.io"), or null for any site. */
  allowedSites: Schema.NullOr(Schema.Array(Schema.String)),
  counts: FormCounts,
  publishedAt: Schema.NullOr(Timestamp),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Form = typeof Form.Type

export const SubmissionStatus = Schema.Literals(["waiting", "confirmed", "spam", "expired"])
export type SubmissionStatus = typeof SubmissionStatus.Type

/** One visitor's answers (D146), with what happened to them. */
/** One consent box as the visitor saw it, and whether they ticked it (D150). */
export const ConsentEntry = Schema.Struct({
  topicId: Schema.String,
  topicName: Schema.String,
  /** The box's exact wording. */
  label: Schema.String,
  ticked: Schema.Boolean,
})
export type ConsentEntry = typeof ConsentEntry.Type

/** What a submission stores as proof of what the visitor saw and agreed to (D150). */
export const StoredConsent = Schema.Struct({
  /** The form version shown. */
  version: Schema.Number,
  title: Schema.String,
  /** The line under the button, exactly as shown. */
  finePrint: Schema.String,
  privacyPolicyUrl: Schema.NullOr(Schema.String),
  consents: Schema.Array(ConsentEntry),
})
export type StoredConsent = typeof StoredConsent.Type

/** Where a submission was sent or confirmed from. */
const Origin = Schema.Struct({ at: Timestamp, ip: Schema.String, userAgent: Schema.String })

/** A submission's consent record (D150): what was shown and agreed to, and when and from where. */
export const ConsentRecord = Schema.Struct({
  ...StoredConsent.fields,
  sent: Origin,
  /** Null until confirmed, and for a submission applied without a confirmation link. */
  confirmed: Schema.NullOr(Origin.annotate({ description: "When the confirmation link was clicked, and from where." })),
})
export type ConsentRecord = typeof ConsentRecord.Type

export const Submission = Schema.Struct({
  id: SubmissionId,
  formId: FormId,
  email: Schema.String,
  /** Answers by field: contact fields by name, custom fields as "custom:<id>", consent as "topic:<id>". */
  values: Schema.Record(Schema.String, Schema.Unknown),
  status: SubmissionStatus,
  /** Why it was held as spam, in plain words ("Sent 0.4s after the form loaded"). */
  spamReason: Schema.NullOr(Schema.String),
  /** The contact it created or updated, once confirmed. */
  contactId: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(Schema.Literals(["created", "updated"])),
  /** The page the form was on, and its tracking parameters (D153). */
  page: Schema.NullOr(Schema.String),
  utm: Schema.Record(Schema.String, Schema.String),
  /** Ad click IDs, by parameter ("gclid"), when the embedding site passes them (D154). */
  clickIds: Schema.Record(Schema.String, Schema.String),
  version: Schema.Number,
  createdAt: Timestamp,
  confirmedAt: Schema.NullOr(Timestamp),
  consent: ConsentRecord,
})
export type Submission = typeof Submission.Type

export const SubmissionPage = Schema.Struct({
  items: Schema.Array(Submission),
  nextCursor: Schema.NullOr(Schema.String),
})

/** The captcha a team's forms use (D147). Secrets are write-only and stored encrypted. */
export const CaptchaSettings = Schema.Union([
  Schema.Struct({ provider: Schema.Literal("builtin") }),
  Schema.Struct({
    provider: Schema.Literal("turnstile"),
    siteKey: Text(200),
    mode: Schema.Literals(["invisible", "managed"]),
    /** Whether a secret key is stored. It's never sent back. */
    hasSecret: Schema.Boolean,
  }),
])
export type CaptchaSettings = typeof CaptchaSettings.Type

/** A team's settings for all its forms. */
export const FormSettings = Schema.Struct({
  captcha: CaptchaSettings,
  blockDisposableEmails: Schema.Boolean,
  privacyPolicyUrl: Schema.NullOr(Schema.String),
})
export type FormSettings = typeof FormSettings.Type

const UtmCount = Schema.Struct({ value: Schema.String, confirmed: Schema.Number })

/** Where a form's submissions come from (D144 analytics), over its life. */
export const FormAnalytics = Schema.Struct({
  /** By page: host and path, or "" for the hosted page. */
  pages: Schema.Array(Schema.Struct({ page: Schema.String, views: Schema.Number, confirmed: Schema.Number })),
  /** Confirmed submissions by utm_source, utm_medium and utm_campaign; "" for none. */
  sources: Schema.Array(UtmCount),
  mediums: Schema.Array(UtmCount),
  campaigns: Schema.Array(UtmCount),
})
export type FormAnalytics = typeof FormAnalytics.Type

/**
 * The ad click IDs a form records when the embedding site opts in (D154), with the network each
 * belongs to.
 */
export const CLICK_ID_PARAMETERS: Readonly<Record<string, string>> = {
  gclid: "Google Ads",
  gbraid: "Google Ads",
  wbraid: "Google Ads",
  fbclid: "Meta",
  msclkid: "Microsoft Ads",
  li_fat_id: "LinkedIn",
  ttclid: "TikTok",
  twclid: "X",
}

/** A UTM parameter's name: utm_ then lowercase letters and underscores, as GA4's utm_source_platform. */
export const UTM_PARAMETER = /^utm_[a-z][a-z_]{0,39}$/

/** Where a submission came from (D153): the page and its tracking parameters, as a submission recorded them. */
export const Tracking = Schema.Struct({
  page: Schema.NullOr(Schema.String),
  utm: Schema.Record(Schema.String, Schema.String),
  clickIds: Schema.Record(Schema.String, Schema.String),
})
export type Tracking = typeof Tracking.Type

/** Contact fields a form can set on every submission (`set`), besides custom fields. */
export const FORM_SET_FIELDS = ["company", "title", "city", "country"] as const

/**
 * A fixed value from `set` (always text) as the value its custom field takes: a number, a
 * checkbox's true or false, or a multi-select's option ids separated by ";". Undefined when the
 * text isn't one.
 */
export const setValueOf = (
  type: CustomField["type"],
  text: string,
): string | number | boolean | ReadonlyArray<string> | undefined => {
  if (type === "number") return text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : undefined
  if (type === "checkbox") return text === "true" ? true : text === "false" ? false : undefined
  if (type === "multi-select")
    return text
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
  return text
}

/**
 * Copy that fits one way of confirming only: with a confirmation email (`on`), and without. New
 * forms start with it, and the designer swaps it when double opt-in changes, unless it was edited.
 */
export const FORM_CONFIRM_COPY = {
  on: {
    title: "Check your inbox",
    body: "Click the link we sent you to confirm.",
    finePrint: "We'll email you to confirm.",
  },
  off: { title: "You're in", body: "Thanks for signing up.", finePrint: "Unsubscribe anytime." },
} as const
