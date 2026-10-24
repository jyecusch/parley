import {
  type DatabaseUnavailable,
  type Form,
  type FormId,
  FormNotFound,
  type Submission,
  type SubmissionId,
  SubmissionNotFound,
  type TeamId,
} from "@parley/domain"
import { Effect } from "effect"
import { Forms } from "../services/forms.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const FormInTeamProver = defineProof("FormInTeam")

/** Form F belongs to team T and isn't deleted. */
export interface FormInTeam<F, T> extends Proof<"FormInTeam", [F, T]> {
  readonly team: Named<T, TeamId>
  readonly form: Named<F, FormId>
  readonly found: Form
}

export const proveFormInTeam = <P, T, F>(
  member: MemberOf<P, T>,
  form: Named<F, FormId>,
): Effect.Effect<FormInTeam<F, T>, FormNotFound | DatabaseUnavailable, Forms> =>
  Effect.gen(function* () {
    const forms = yield* Forms
    const found = yield* forms.locate(member.team.value, form.value)
    if (!found) return yield* new FormNotFound({ team: member.teamName, formId: form.value })
    return { ...FormInTeamProver.prove(form, member.team), team: member.team, form, found }
  })

const SubmissionOfFormProver = defineProof("SubmissionOfForm")

/** Submission S was made on form F. */
export interface SubmissionOfForm<S, F> extends Proof<"SubmissionOfForm", [S, F]> {
  readonly submission: Named<S, SubmissionId>
  readonly found: Submission
}

export const proveSubmissionOfForm = <P, T, F, S>(
  member: MemberOf<P, T>,
  form: FormInTeam<F, T>,
  submission: Named<S, SubmissionId>,
): Effect.Effect<SubmissionOfForm<S, F>, SubmissionNotFound | DatabaseUnavailable, Forms> =>
  Effect.gen(function* () {
    const forms = yield* Forms
    const found = yield* forms.locateSubmission(form.form.value, submission.value)
    if (!found) return yield* new SubmissionNotFound({ team: member.teamName, submissionId: submission.value })
    return { ...SubmissionOfFormProver.prove(submission, form.form), submission, found }
  })
