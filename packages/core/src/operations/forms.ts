import type {
  createForm,
  deleteForm,
  formAnalytics,
  getForm,
  getFormSettings,
  listForms,
  listSubmissions,
  OperationInput,
  publishForm,
  releaseSubmission,
  updateForm,
  updateFormSettings,
} from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveFormInTeam, proveSubmissionOfForm } from "../proofs/form-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import {
  proveCanManageEmail,
  proveCanReadRecords,
  proveCanWriteEmail,
  proveCanWriteRecords,
} from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { Forms } from "../services/forms.ts"
import { Sending } from "../services/sending.ts"

export const list = (principal: Principal, input: OperationInput<typeof listForms>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const forms = yield* Forms
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return yield* forms.list(member)
    }),
  )

export const get = (principal: Principal, input: OperationInput<typeof getForm>) =>
  named(principal, input.teamId, input.formId, (principal, team, form) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return (yield* proveFormInTeam(member, form)).found
    }),
  )

export const create = (principal: Principal, input: OperationInput<typeof createForm>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const forms = yield* Forms
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      return yield* forms.create(access, input.name, input.template)
    }),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateForm>) =>
  named(principal, input.teamId, input.formId, (principal, team, form) =>
    Effect.gen(function* () {
      const forms = yield* Forms
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveFormInTeam(member, form)
      return yield* forms.update(target, input, access)
    }),
  )

export const publish = (principal: Principal, input: OperationInput<typeof publishForm>) =>
  named(principal, input.teamId, input.formId, (principal, team, form) =>
    Effect.gen(function* () {
      const forms = yield* Forms
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveFormInTeam(member, form)
      // Double opt-in emails a confirmation link, so it needs a ready sender before it can go live (D146, D162).
      if (target.found.draft.doubleOptIn) yield* sending.sendAs(member, target.found.draft.senderId)
      return yield* forms.publish(target, access)
    }),
  )

export const remove = (principal: Principal, input: OperationInput<typeof deleteForm>) =>
  named(principal, input.teamId, input.formId, (principal, team, form) =>
    Effect.gen(function* () {
      const forms = yield* Forms
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveFormInTeam(member, form)
      return yield* forms.delete(target, access)
    }),
  )

export const analytics = (principal: Principal, input: OperationInput<typeof formAnalytics>) =>
  named(principal, input.teamId, input.formId, (principal, team, form) =>
    Effect.gen(function* () {
      const forms = yield* Forms
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return yield* forms.analytics(yield* proveFormInTeam(member, form))
    }),
  )

export const submissions = (principal: Principal, input: OperationInput<typeof listSubmissions>) =>
  named(principal, input.teamId, input.formId, (principal, team, form) =>
    Effect.gen(function* () {
      const forms = yield* Forms
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return yield* forms.submissions(yield* proveFormInTeam(member, form), input)
    }),
  )

export const release = (principal: Principal, input: OperationInput<typeof releaseSubmission>) =>
  named(principal, input.teamId, input.formId, (principal, team, form) =>
    Effect.gen(function* () {
      const forms = yield* Forms
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteRecords(member)
      const target = yield* proveFormInTeam(member, form)
      return yield* named(input.submissionId, (submission) =>
        Effect.gen(function* () {
          const found = yield* proveSubmissionOfForm(member, target, submission)
          return yield* forms.release(found, access)
        }),
      )
    }),
  )

export const settings = (principal: Principal, input: OperationInput<typeof getFormSettings>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const forms = yield* Forms
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return yield* forms.settings(member)
    }),
  )

export const updateSettings = (principal: Principal, input: OperationInput<typeof updateFormSettings>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const forms = yield* Forms
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      return yield* forms.updateSettings(access, input)
    }),
  )
