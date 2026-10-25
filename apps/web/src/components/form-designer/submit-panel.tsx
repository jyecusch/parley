import { type FieldProblem, FORM_CONFIRM_COPY, type FormContent } from "@parley/domain"
import { useState } from "react"
import { problemFor } from "../record.tsx"
import {
  Checkbox,
  Field,
  Fieldset,
  InfoTip,
  Input,
  Notice,
  Option,
  RadioCard,
  RadioCards,
  Textarea,
} from "../ui/index.ts"
import { type ContentChange, redirectProblem } from "./shared.tsx"

export function AfterSubmitPanel(props: {
  readonly content: FormContent
  /** Problems from the last save, by field. */
  readonly problems: ReadonlyArray<FieldProblem> | undefined
  readonly onChange: ContentChange
}) {
  const { content, onChange } = props
  const after = content.afterSubmit
  // Checked as they type, but only shown once they've left the field, so a half-typed address
  // isn't called wrong.
  const [left, setLeft] = useState(false)
  const urlProblem =
    (left ? redirectProblem(content) : undefined) ?? problemFor(props.problems, "draft.afterSubmit.url")
  return (
    <div className="flex flex-col gap-5">
      <Fieldset legend="After they submit" section>
        <RadioCards
          name="after-submit"
          value={after.kind}
          onChange={(kind) =>
            onChange((current) => ({
              ...current,
              afterSubmit:
                kind === "message"
                  ? {
                      kind: "message",
                      ...(current.doubleOptIn ? FORM_CONFIRM_COPY.on : FORM_CONFIRM_COPY.off),
                    }
                  : { kind: "redirect", url: "https://" },
            }))
          }
        >
          <RadioCard value="message" label="Show a message" />
          <RadioCard value="redirect" label="Go to a page" />
        </RadioCards>
        {after.kind === "message" ? (
          <>
            <Field label="Title" htmlFor="after-title">
              <Input
                id="after-title"
                maxLength={120}
                value={after.title}
                onChange={(event) =>
                  onChange((current) => ({ ...current, afterSubmit: { ...after, title: event.target.value } }))
                }
              />
            </Field>
            <Field label="Message" htmlFor="after-body">
              <Textarea
                id="after-body"
                rows={3}
                maxLength={500}
                value={after.body}
                onChange={(event) =>
                  onChange((current) => ({ ...current, afterSubmit: { ...after, body: event.target.value } }))
                }
              />
            </Field>
          </>
        ) : (
          <Field
            label="Page address"
            htmlFor="after-url"
            info="Such as a thank-you page on your site. A full address, starting with https://."
            error={urlProblem}
          >
            <Input
              id="after-url"
              type="url"
              maxLength={2000}
              placeholder="https://example.com/thanks"
              aria-invalid={urlProblem ? true : undefined}
              onBlur={() => setLeft(true)}
              value={after.url}
              onChange={(event) =>
                onChange((current) => ({ ...current, afterSubmit: { kind: "redirect", url: event.target.value } }))
              }
            />
          </Field>
        )}
      </Fieldset>
      <Fieldset legend="Confirming their email" section>
        <div className="flex items-center gap-1">
          <Option>
            <Checkbox
              checked={content.doubleOptIn}
              onChange={(event) => {
                const on = event.target.checked
                onChange((current) => withConfirmCopy({ ...current, doubleOptIn: on }))
              }}
            />
            Ask them to confirm by email
          </Option>
          <InfoTip label="confirming by email">
            Nothing reaches your contacts until they click the link, so bots and typos leave no trace. Someone who had
            unsubscribed always has to confirm before they're subscribed again.
          </InfoTip>
        </div>
        {content.doubleOptIn ? null : (
          <Notice tone="warn">
            Submissions become contacts straight away. In the EU you may need proof they asked.
          </Notice>
        )}
      </Fieldset>
    </div>
  )
}

/**
 * Copy still on the template's words for the other way of signing up, swapped to fit: turning
 * double opt-in off shouldn't leave "Check your inbox" behind. Edited copy is left alone.
 */
const withConfirmCopy = (content: FormContent): FormContent => {
  const from = content.doubleOptIn ? FORM_CONFIRM_COPY.off : FORM_CONFIRM_COPY.on
  const to = content.doubleOptIn ? FORM_CONFIRM_COPY.on : FORM_CONFIRM_COPY.off
  const message = content.afterSubmit
  return {
    ...content,
    finePrint: content.finePrint === from.finePrint ? to.finePrint : content.finePrint,
    afterSubmit:
      message.kind === "message" && message.title === from.title
        ? { kind: "message", title: to.title, body: to.body }
        : message,
  }
}
