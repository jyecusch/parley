import { DEFAULT_APPEARANCE, FORM_CONFIRM_COPY, type FormContent } from "@parley/domain"

const { on } = FORM_CONFIRM_COPY

/** Where a new form starts (docs/06-forms.md): fitting fields and copy, double opt-in on. */
export type FormTemplateName = "newsletter" | "waitlist" | "event" | "blank"

const email = {
  kind: "contact",
  field: "email",
  label: "Email",
  placeholder: "you@company.com",
  required: true,
} as const
const firstName = { kind: "contact", field: "firstName", label: "First name", required: false } as const
const lastName = { kind: "contact", field: "lastName", label: "Last name", required: false } as const
const company = { kind: "contact", field: "company", label: "Company", required: false } as const

const base = {
  doubleOptIn: true,
  senderId: null,
  segmentId: null,
  set: {},
  captureTracking: true,
  appearance: DEFAULT_APPEARANCE,
} as const

/** A new form's draft. Consent boxes need a topic, so the templates add none; the designer does. */
export const templateContent = (template: FormTemplateName): FormContent => {
  switch (template) {
    case "newsletter":
      return {
        ...base,
        title: "Get our newsletter",
        description: "News and updates from us, now and then. Unsubscribe any time.",
        submitLabel: "Subscribe",
        finePrint: on.finePrint,
        fields: [email, firstName],
        afterSubmit: { kind: "message", title: on.title, body: on.body },
      }
    case "waitlist":
      return {
        ...base,
        title: "Join the waitlist",
        description: "Be the first to know when we open up.",
        submitLabel: "Join the waitlist",
        finePrint: on.finePrint,
        fields: [email, firstName, company],
        afterSubmit: {
          kind: "message",
          title: on.title,
          body: "Click the link we sent you to join the waitlist.",
        },
      }
    case "event":
      return {
        ...base,
        title: "Save your spot",
        description: "Register and we'll send you the details.",
        submitLabel: "Register",
        finePrint: "We'll email you to confirm your spot.",
        fields: [email, firstName, lastName, company],
        afterSubmit: {
          kind: "message",
          title: on.title,
          body: "Click the link we sent you to confirm your spot.",
        },
      }
    case "blank":
      return {
        ...base,
        title: "",
        description: "",
        submitLabel: "Submit",
        finePrint: "",
        fields: [email],
        afterSubmit: { kind: "message", title: "Thanks", body: "Check your inbox to confirm." },
      }
  }
}
