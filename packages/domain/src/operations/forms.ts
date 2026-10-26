import { Schema } from "effect"
import { SegmentNotFound, SenderNotReady, TopicNotFound } from "../errors/broadcasts.ts"
import { FormNotFound, SubmissionNotFound } from "../errors/forms.ts"
import {
  Form,
  FormAnalytics,
  FormContent,
  FormName,
  FormSettings,
  Submission,
  SubmissionPage,
  SubmissionStatus,
} from "../forms.ts"
import { FormId, SubmissionId, TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneForm = { ...InTeam, formId: FormId.annotate({ description: "The form, from forms.list." }) }

/** Where a new form starts (docs/06-forms.md). */
export const FormTemplate = Schema.Literals(["newsletter", "waitlist", "event", "blank"]).annotate({
  title: "Template",
  description: "newsletter, waitlist or event start with fitting fields and copy; blank asks for email only.",
})

const SiteList = Schema.NullOr(
  Schema.Array(
    Schema.String.check(Schema.isMaxLength(253), Schema.isPattern(/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,63}$/i)),
  ).check(Schema.isMaxLength(50)),
).annotate({
  title: "Where it can appear",
  description: 'Hostnames that may embed the form, such as "nitric.io" or "*.nitric.io". Null for any site.',
})

export const listForms = defineTeamOperation({
  name: "forms.list",
  description: "The team's forms, with their counts: views, submissions, confirmed, waiting, expired and spam.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(Form),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/forms" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const getForm = defineTeamOperation({
  name: "forms.get",
  description: "One form: its draft, what's published, where it can appear, and its counts.",
  input: Schema.Struct(OneForm),
  output: Form,
  errors: [FormNotFound],
  http: { method: "GET", path: "/teams/:teamId/forms/:formId" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createForm = defineTeamOperation({
  name: "forms.create",
  description:
    "Create a form from a template. It starts as a draft: edit it with forms.update, then forms.publish to put it live. Embed it with the snippet in the app, or link to https://<parley>/f/<form id>.",
  input: Schema.Struct({ ...InTeam, name: FormName.annotate({ title: "Name" }), template: FormTemplate }),
  output: Form,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/forms" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const updateForm = defineTeamOperation({
  name: "forms.update",
  description:
    "Change a form's name, its draft (copy, fields, behavior and appearance, replaced whole), or where it can appear. Draft changes reach visitors only when published.",
  input: Schema.Struct({
    ...OneForm,
    name: Schema.optional(FormName.annotate({ title: "Name" })),
    draft: Schema.optional(FormContent),
    allowedSites: Schema.optional(SiteList),
  }),
  output: Form,
  errors: [FormNotFound, TopicNotFound, SegmentNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/forms/:formId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "email:write"],
})

export const publishForm = defineTeamOperation({
  name: "forms.publish",
  description:
    "Put a form's draft live, as a new version. Submissions record which version they saw. A form with double opt-in needs the team's sender set up first (emailSettings), since it emails a confirmation link.",
  input: Schema.Struct(OneForm),
  output: Form,
  errors: [FormNotFound, SenderNotReady, TopicNotFound, SegmentNotFound],
  http: { method: "POST", path: "/teams/:teamId/forms/:formId/publish" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const deleteForm = defineTeamOperation({
  name: "forms.delete",
  description:
    "Delete a form. It stops accepting submissions at once. Contacts it created stay, and so do their consent records.",
  input: Schema.Struct(OneForm),
  output: Form,
  errors: [FormNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/forms/:formId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const formAnalytics = defineTeamOperation({
  name: "forms.analytics",
  description:
    "Where a form's submissions come from: views and confirmed submissions by page, and confirmed submissions by UTM source, medium and campaign.",
  input: Schema.Struct(OneForm),
  output: FormAnalytics,
  errors: [FormNotFound],
  http: { method: "GET", path: "/teams/:teamId/forms/:formId/analytics" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const listSubmissions = defineTeamOperation({
  name: "forms.submissions",
  description:
    "A form's submissions, newest first: confirmed ones (with the contact they created or updated), ones waiting for the visitor to confirm, expired ones, and spam with the reason it was held. Each has its consent record: the form version, title, fine print and privacy policy link shown, each consent box's wording and whether it was ticked, and when and from where (IP, browser) it was sent and confirmed.",
  input: Schema.Struct({
    ...OneForm,
    status: Schema.optional(SubmissionStatus),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
    cursor: Schema.optional(Schema.String),
  }),
  output: SubmissionPage,
  errors: [FormNotFound],
  http: { method: "GET", path: "/teams/:teamId/forms/:formId/submissions" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const releaseSubmission = defineTeamOperation({
  name: "forms.releaseSubmission",
  description: "Treat a submission held as spam as a real one: it's handled as if just sent, double opt-in included.",
  input: Schema.Struct({ ...OneForm, submissionId: SubmissionId }),
  output: Submission,
  errors: [FormNotFound, SubmissionNotFound],
  http: { method: "POST", path: "/teams/:teamId/forms/:formId/submissions/:submissionId/release" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "records:write"],
})

export const getFormSettings = defineTeamOperation({
  name: "formSettings.get",
  description:
    "The team's settings for all its forms: the captcha (D147), disposable-email blocking and privacy policy link.",
  input: Schema.Struct(InTeam),
  output: FormSettings,
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/form-settings" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const updateFormSettings = defineTeamOperation({
  name: "formSettings.update",
  description:
    "Change the team's form settings. For Turnstile, send its site key, mode and secret key; the secret is stored encrypted and never returned. Leave the secret out to keep the stored one.",
  input: Schema.Struct({
    ...InTeam,
    captcha: Schema.optional(
      Schema.Union([
        Schema.Struct({ provider: Schema.Literal("builtin") }),
        Schema.Struct({
          provider: Schema.Literal("turnstile"),
          siteKey: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(200)),
          mode: Schema.Literals(["invisible", "managed"]),
          secretKey: Schema.optional(
            Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(200)),
          ),
        }),
      ]),
    ),
    blockDisposableEmails: Schema.optional(Schema.Boolean),
    privacyPolicyUrl: Schema.optional(
      Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000), Schema.isPattern(/^https:\/\/[^\s]+$/))),
    ),
  }),
  output: FormSettings,
  errors: [],
  http: { method: "PATCH", path: "/teams/:teamId/form-settings" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["email:manage"],
})
