import { Schema } from "effect"
import {
  CustomHtml,
  EmailFont,
  EmailImage,
  EmailStyle,
  EmailStyleColors,
  EmailStyleLayout,
  EmailStyleName,
  HeaderText,
  RenderedEmail,
} from "../email.ts"
import {
  CustomHtmlMissingContent,
  EmailStyleInUse,
  EmailStyleIsDefault,
  EmailStyleNotFound,
} from "../errors/email-styles.ts"
import { ImageTooLarge, ImageUnreadable, ImageUrlUnreachable } from "../errors/images.ts"
import { EmailStyleId, TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneStyle = {
  ...InTeam,
  styleId: EmailStyleId.annotate({ description: "The email style's id, from emailStyles.list." }),
}
const Logo = Schema.String.check(Schema.isMaxLength(14_000_000)).annotate({
  title: "Logo",
  description: "The logo as base64, or a data: URL. JPEG, PNG, WebP, GIF or SVG, up to 10 MB. It's resized for email.",
})
/** Everything a style sets. Create needs a name; the rest default to the plain look (D115). */
const StyleFields = {
  layout: Schema.optional(EmailStyleLayout),
  logo: Schema.optional(Schema.NullOr(Logo)),
  logoAlign: Schema.optional(Schema.Literals(["left", "center"])),
  headerText: Schema.optional(Schema.NullOr(HeaderText.annotate({ title: "Header line" }))),
  footerAlign: Schema.optional(
    Schema.Literals(["left", "center", "right"]).annotate({
      title: "Footer alignment",
      description: "Where the footer's lines sit, inside the same column or card as the content.",
    }),
  ),
  colors: Schema.optional(EmailStyleColors),
  font: Schema.optional(EmailFont),
  customHtml: Schema.optional(Schema.NullOr(CustomHtml)),
}

export const listEmailStyles = defineTeamOperation({
  name: "emailStyles.list",
  description: "List the team's email styles: how emails look (logo, colors, font, layout). One is the default.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(EmailStyle),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/email-styles" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["email:write"],
})

export const getEmailStyle = defineTeamOperation({
  name: "emailStyles.get",
  description: "Get one email style.",
  input: Schema.Struct(OneStyle),
  output: EmailStyle,
  errors: [EmailStyleNotFound],
  http: { method: "GET", path: "/teams/:teamId/email-styles/:styleId" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["email:write"],
})

export const createEmailStyle = defineTeamOperation({
  name: "emailStyles.create",
  description:
    "Create an email style. Anything not given starts from the plain look: like a personal email, in the reader's own font.",
  input: Schema.Struct({ ...InTeam, name: EmailStyleName.annotate({ title: "Name" }), ...StyleFields }),
  output: EmailStyle,
  errors: [CustomHtmlMissingContent, ImageUnreadable, ImageTooLarge],
  http: { method: "POST", path: "/teams/:teamId/email-styles" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["email:manage"],
})

export const updateEmailStyle = defineTeamOperation({
  name: "emailStyles.update",
  description:
    "Change an email style. Draft broadcasts and templates using it change too; sent broadcasts keep the look they were sent with. Null removes the logo or header line.",
  input: Schema.Struct({
    ...OneStyle,
    name: Schema.optional(EmailStyleName.annotate({ title: "Name" })),
    ...StyleFields,
  }),
  output: EmailStyle,
  errors: [EmailStyleNotFound, CustomHtmlMissingContent, ImageUnreadable, ImageTooLarge],
  http: { method: "PATCH", path: "/teams/:teamId/email-styles/:styleId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["email:manage"],
})

export const setDefaultEmailStyle = defineTeamOperation({
  name: "emailStyles.setDefault",
  description: "Make an email style the team's default, used by templates and broadcasts that don't choose one.",
  input: Schema.Struct(OneStyle),
  output: EmailStyle,
  errors: [EmailStyleNotFound],
  http: { method: "POST", path: "/teams/:teamId/email-styles/:styleId/default" },
  // It changes how every template and draft broadcast without a style of its own looks.
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["email:manage"],
})

export const deleteEmailStyle = defineTeamOperation({
  name: "emailStyles.delete",
  description:
    "Delete an email style. Refused while it's the default or while templates or draft broadcasts use it. Sent broadcasts are unaffected.",
  input: Schema.Struct(OneStyle),
  output: EmailStyle,
  errors: [EmailStyleNotFound, EmailStyleIsDefault, EmailStyleInUse],
  http: { method: "DELETE", path: "/teams/:teamId/email-styles/:styleId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["email:manage"],
})

export const previewEmailStyle = defineTeamOperation({
  name: "emailStyles.preview",
  description:
    "Render sample content in a style, with the team's footer. Pass styleId for a saved style, and any style fields to preview unsaved changes (logo as a URL here, from an upload).",
  input: Schema.Struct({
    ...InTeam,
    styleId: Schema.optional(EmailStyleId),
    layout: Schema.optional(EmailStyleLayout),
    logoUrl: Schema.optional(Schema.NullOr(Schema.String)),
    logoAlign: Schema.optional(Schema.Literals(["left", "center"])),
    headerText: Schema.optional(Schema.NullOr(HeaderText)),
    footerAlign: Schema.optional(Schema.Literals(["left", "center", "right"])),
    colors: Schema.optional(EmailStyleColors),
    font: Schema.optional(EmailFont),
    customHtml: Schema.optional(Schema.NullOr(CustomHtml)),
  }),
  output: RenderedEmail,
  errors: [EmailStyleNotFound, CustomHtmlMissingContent],
  http: { method: "POST", path: "/teams/:teamId/email-styles/preview" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["email:write"],
})

export const uploadEmailImage = defineTeamOperation({
  name: "emailImages.upload",
  description:
    "Upload an image to use in emails. Parley resizes it for email and hosts it at a public address; put the returned url in the body as Markdown: ![description](url).",
  input: Schema.Struct({
    ...InTeam,
    image: Schema.String.check(Schema.isMaxLength(14_000_000)).annotate({
      title: "Image",
      description: "The image as base64, or a data: URL. JPEG, PNG, WebP or GIF, up to 10 MB.",
    }),
  }),
  output: EmailImage,
  errors: [ImageUnreadable, ImageTooLarge],
  http: { method: "POST", path: "/teams/:teamId/email-images" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["email:write"],
})

export const importEmailImage = defineTeamOperation({
  name: "emailImages.import",
  description:
    "Copy an image from a public https address so an email doesn't depend on the original staying up. Returns Parley's own url for it.",
  input: Schema.Struct({
    ...InTeam,
    url: Schema.String.check(Schema.isMaxLength(2000), Schema.isPattern(/^https:\/\//)).annotate({
      title: "Image address",
      description: "A public https:// address of a JPEG, PNG, WebP or GIF.",
    }),
  }),
  output: EmailImage,
  errors: [ImageUrlUnreachable, ImageUnreadable, ImageTooLarge],
  http: { method: "POST", path: "/teams/:teamId/email-images/import" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["email:write"],
})
