import { type CheckedExposureManifest, type ExposureManifest, includedOperationNames } from "../exposure.ts"
import type { OperationName } from "./index.ts"

const declarations = {
  "teams.list": {
    http: { kind: "included", method: "GET", path: "/teams" },
    mcp: { kind: "included" },
  },
  "teams.create": {
    http: { kind: "included", method: "POST", path: "/teams" },
    mcp: { kind: "included" },
  },
  "teams.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId" },
    mcp: { kind: "included" },
  },
  "members.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/members" },
    mcp: { kind: "included" },
  },
  "members.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/members/:userId" },
    mcp: { kind: "included" },
  },
  "members.remove": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/members/:userId" },
    mcp: { kind: "included" },
  },
  "invitations.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/invitations" },
    mcp: { kind: "included" },
  },
  "invitations.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/invitations" },
    mcp: { kind: "included" },
  },
  "invitations.revoke": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/invitations/:invitationId/revoke" },
    mcp: { kind: "included" },
  },
  "invitations.get": {
    http: { kind: "included", method: "GET", path: "/invitations/:invitationId" },
    mcp: { kind: "included" },
  },
  "invitations.accept": {
    http: { kind: "included", method: "POST", path: "/invitations/:invitationId/accept" },
    mcp: { kind: "included" },
  },
  "invitations.mine": {
    http: { kind: "included", method: "GET", path: "/invitations" },
    mcp: { kind: "included" },
  },
  "invitations.decline": {
    http: { kind: "included", method: "POST", path: "/invitations/:invitationId/decline" },
    mcp: { kind: "included" },
  },
  "contacts.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/contacts" },
    mcp: { kind: "included" },
  },
  "contacts.get": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/contacts/:contactId" },
    mcp: { kind: "included" },
  },
  "contacts.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/contacts" },
    mcp: { kind: "included" },
  },
  "contacts.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/contacts/:contactId" },
    mcp: { kind: "included" },
  },
  "contacts.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/contacts/:contactId" },
    mcp: { kind: "included" },
  },
  "contacts.restore": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/contacts/:contactId/restore" },
    mcp: { kind: "included" },
  },
  "contacts.updateMany": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/contacts/update-many" },
    mcp: { kind: "included" },
  },
  "contacts.deleteMany": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/contacts/delete-many" },
    mcp: { kind: "included" },
  },
  "contacts.restoreMany": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/contacts/restore-many" },
    mcp: { kind: "included" },
  },
  "contacts.activity": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/contacts/:contactId/activity" },
    mcp: { kind: "included" },
  },
  "contacts.export": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/contacts/export" },
    mcp: { kind: "included" },
  },
  "contacts.setAvatar": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/contacts/:contactId/avatar" },
    mcp: { kind: "included" },
  },
  "contacts.removeAvatar": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/contacts/:contactId/avatar" },
    mcp: { kind: "included" },
  },
  "contacts.import": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/contacts/import" },
    mcp: { kind: "included" },
  },
  "contacts.subscriptions": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/contacts/:contactId/subscriptions" },
    mcp: { kind: "included" },
  },
  "contacts.updateSubscriptions": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/contacts/:contactId/subscriptions" },
    mcp: { kind: "included" },
  },
  "companies.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/companies" },
    mcp: { kind: "included" },
  },
  "companies.get": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/companies/:companyId" },
    mcp: { kind: "included" },
  },
  "companies.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/companies" },
    mcp: { kind: "included" },
  },
  "companies.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/companies/:companyId" },
    mcp: { kind: "included" },
  },
  "companies.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/companies/:companyId" },
    mcp: { kind: "included" },
  },
  "companies.restore": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/companies/:companyId/restore" },
    mcp: { kind: "included" },
  },
  "companies.updateMany": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/companies/update-many" },
    mcp: { kind: "included" },
  },
  "companies.deleteMany": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/companies/delete-many" },
    mcp: { kind: "included" },
  },
  "companies.restoreMany": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/companies/restore-many" },
    mcp: { kind: "included" },
  },
  "companies.activity": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/companies/:companyId/activity" },
    mcp: { kind: "included" },
  },
  "companies.export": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/companies/export" },
    mcp: { kind: "included" },
  },
  "companies.setLogo": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/companies/:companyId/logo" },
    mcp: { kind: "included" },
  },
  "companies.removeLogo": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/companies/:companyId/logo" },
    mcp: { kind: "included" },
  },
  "companies.import": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/companies/import" },
    mcp: { kind: "included" },
  },
  "imports.start": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/imports" },
    mcp: { kind: "included" },
  },
  "imports.get": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/imports/:importId" },
    mcp: { kind: "included" },
  },
  "imports.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/imports" },
    mcp: { kind: "included" },
  },
  "imports.cancel": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/imports/:importId/cancel" },
    mcp: { kind: "included" },
  },
  "affiliations.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/companies/:companyId/affiliations" },
    mcp: { kind: "included" },
  },
  "affiliations.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/affiliations" },
    mcp: { kind: "included" },
  },
  "affiliations.createMany": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/affiliations/create-many" },
    mcp: { kind: "included" },
  },
  "affiliations.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/affiliations/:affiliationId" },
    mcp: { kind: "included" },
  },
  "affiliations.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/affiliations/:affiliationId" },
    mcp: { kind: "included" },
  },
  "fields.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/fields" },
    mcp: { kind: "included" },
  },
  "fields.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/fields" },
    mcp: { kind: "included" },
  },
  "fields.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/fields/:fieldId" },
    mcp: { kind: "included" },
  },
  "fields.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/fields/:fieldId" },
    mcp: { kind: "included" },
  },
  "savedViews.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/saved-views" },
    mcp: { kind: "included" },
  },
  "savedViews.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/saved-views" },
    mcp: { kind: "included" },
  },
  "savedViews.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/saved-views/:viewId" },
    mcp: { kind: "included" },
  },
  "savedViews.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/saved-views/:viewId" },
    mcp: { kind: "included" },
  },
  "notes.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/notes" },
    mcp: { kind: "included" },
  },
  "notes.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/notes" },
    mcp: { kind: "included" },
  },
  "notes.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/notes/:noteId" },
    mcp: { kind: "included" },
  },
  "notes.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/notes/:noteId" },
    mcp: { kind: "included" },
  },
  "apiKeys.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/api-keys" },
    mcp: { kind: "included" },
  },
  "apiKeys.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/api-keys" },
    mcp: { kind: "included" },
  },
  "apiKeys.revoke": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/api-keys/:apiKeyId/revoke" },
    mcp: { kind: "included" },
  },
  "connections.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/connections" },
    mcp: { kind: "included" },
  },
  "connections.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/connections" },
    mcp: { kind: "included" },
  },
  "connections.revoke": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/connections/:connectionId/revoke" },
    mcp: { kind: "included" },
  },
  "serviceAccounts.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/service-accounts" },
    mcp: { kind: "included" },
  },
  "serviceAccounts.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/service-accounts" },
    mcp: { kind: "included" },
  },
  "serviceAccounts.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/service-accounts/:serviceAccountId" },
    mcp: { kind: "included" },
  },
  "serviceAccounts.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/service-accounts/:serviceAccountId" },
    mcp: { kind: "included" },
  },
  "senders.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/senders" },
    mcp: { kind: "included" },
  },
  "senders.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/senders" },
    mcp: { kind: "included" },
  },
  "senders.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/senders/:senderId" },
    mcp: { kind: "included" },
  },
  "senders.setDefault": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/senders/:senderId/default" },
    mcp: { kind: "included" },
  },
  "senders.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/senders/:senderId" },
    mcp: { kind: "included" },
  },
  "emailStyles.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/email-styles" },
    mcp: { kind: "included" },
  },
  "emailStyles.get": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/email-styles/:styleId" },
    mcp: { kind: "included" },
  },
  "emailStyles.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/email-styles" },
    mcp: { kind: "included" },
  },
  "emailStyles.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/email-styles/:styleId" },
    mcp: { kind: "included" },
  },
  "emailStyles.setDefault": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/email-styles/:styleId/default" },
    mcp: { kind: "included" },
  },
  "emailStyles.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/email-styles/:styleId" },
    mcp: { kind: "included" },
  },
  "emailStyles.preview": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/email-styles/preview" },
    mcp: { kind: "included" },
  },
  "emailImages.upload": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/email-images" },
    mcp: { kind: "included" },
  },
  "emailImages.import": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/email-images/import" },
    mcp: { kind: "included" },
  },
  "sendingDomains.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/sending-domains" },
    mcp: { kind: "included" },
  },
  "sendingDomains.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/sending-domains" },
    mcp: { kind: "included" },
  },
  "sendingDomains.verify": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/sending-domains/:sendingDomainId/verify" },
    mcp: { kind: "included" },
  },
  "sendingDomains.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/sending-domains/:sendingDomainId" },
    mcp: { kind: "included" },
  },
  "forms.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/forms" },
    mcp: { kind: "included" },
  },
  "forms.get": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/forms/:formId" },
    mcp: { kind: "included" },
  },
  "forms.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/forms" },
    mcp: { kind: "included" },
  },
  "forms.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/forms/:formId" },
    mcp: { kind: "included" },
  },
  "forms.publish": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/forms/:formId/publish" },
    mcp: { kind: "included" },
  },
  "forms.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/forms/:formId" },
    mcp: { kind: "included" },
  },
  "forms.analytics": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/forms/:formId/analytics" },
    mcp: { kind: "included" },
  },
  "forms.submissions": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/forms/:formId/submissions" },
    mcp: { kind: "included" },
  },
  "forms.releaseSubmission": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/forms/:formId/submissions/:submissionId/release" },
    mcp: { kind: "included" },
  },
  "formSettings.get": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/form-settings" },
    mcp: { kind: "included" },
  },
  "formSettings.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/form-settings" },
    mcp: { kind: "included" },
  },
  "topics.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/topics" },
    mcp: { kind: "included" },
  },
  "topics.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/topics" },
    mcp: { kind: "included" },
  },
  "topics.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/topics/:topicId" },
    mcp: { kind: "included" },
  },
  "topics.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/topics/:topicId" },
    mcp: { kind: "included" },
  },
  "segments.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/segments" },
    mcp: { kind: "included" },
  },
  "segments.get": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/segments/:segmentId" },
    mcp: { kind: "included" },
  },
  "segments.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/segments" },
    mcp: { kind: "included" },
  },
  "segments.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/segments/:segmentId" },
    mcp: { kind: "included" },
  },
  "segments.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/segments/:segmentId" },
    mcp: { kind: "included" },
  },
  "segments.contacts": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/segments/:segmentId/contacts" },
    mcp: { kind: "included" },
  },
  "segments.addContacts": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/segments/:segmentId/contacts" },
    mcp: { kind: "included" },
  },
  "segments.removeContacts": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/segments/:segmentId/contacts/remove" },
    mcp: { kind: "included" },
  },
  "templates.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/templates" },
    mcp: { kind: "included" },
  },
  "templates.get": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/templates/:templateId" },
    mcp: { kind: "included" },
  },
  "templates.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/templates" },
    mcp: { kind: "included" },
  },
  "templates.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/templates/:templateId" },
    mcp: { kind: "included" },
  },
  "templates.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/templates/:templateId" },
    mcp: { kind: "included" },
  },
  "templates.preview": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/templates/:templateId/preview" },
    mcp: { kind: "included" },
  },
  "broadcasts.list": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/broadcasts" },
    mcp: { kind: "included" },
  },
  "broadcasts.get": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/broadcasts/:broadcastId" },
    mcp: { kind: "included" },
  },
  "broadcasts.create": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/broadcasts" },
    mcp: { kind: "included" },
  },
  "broadcasts.update": {
    http: { kind: "included", method: "PATCH", path: "/teams/:teamId/broadcasts/:broadcastId" },
    mcp: { kind: "included" },
  },
  "broadcasts.delete": {
    http: { kind: "included", method: "DELETE", path: "/teams/:teamId/broadcasts/:broadcastId" },
    mcp: { kind: "included" },
  },
  "broadcasts.duplicate": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/broadcasts/:broadcastId/duplicate" },
    mcp: { kind: "included" },
  },
  "broadcasts.preview": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/broadcasts/:broadcastId/preview" },
    mcp: { kind: "included" },
  },
  "broadcasts.testSend": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/broadcasts/:broadcastId/test-send" },
    mcp: { kind: "included" },
  },
  "broadcasts.send": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/broadcasts/:broadcastId/send" },
    mcp: { kind: "included" },
  },
  "broadcasts.cancel": {
    http: { kind: "included", method: "POST", path: "/teams/:teamId/broadcasts/:broadcastId/cancel" },
    mcp: { kind: "included" },
  },
  "broadcasts.recipients": {
    http: { kind: "included", method: "GET", path: "/teams/:teamId/broadcasts/:broadcastId/recipients" },
    mcp: { kind: "included" },
  },
} as const satisfies ExposureManifest<OperationName>

/** operationExposures requires an explicit HTTP and MCP decision for every registered operation. */
export const operationExposures = declarations satisfies CheckedExposureManifest<typeof declarations>

export const httpOperationNames = includedOperationNames(operationExposures, "http")
export type HttpOperationName = (typeof httpOperationNames)[number]

export const mcpOperationNames = includedOperationNames(operationExposures, "mcp")
export type McpOperationName = (typeof mcpOperationNames)[number]
