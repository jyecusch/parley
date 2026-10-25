import type { CustomField, FormContent, FormField } from "@parley/domain"
import { appearanceCss } from "@parley/domain"
import { type FormEvent, type ReactNode, useEffect, useRef } from "react"

/*
 * A form as visitors see it (D144): the one renderer behind the designer's preview, the embedded
 * form and the hosted page. Plain, accessible markup with the public classes appearance rules
 * style (D148): real labels, autocomplete, the honeypot hidden from people and screen readers.
 * It's not built on the app's kit: it runs on other people's sites, styled only by its appearance.
 */

/** Answers by field key: contact fields by name, "custom:<id>", and "topic:<id>" for consent. */
export type FormValues = Readonly<Record<string, string | boolean | ReadonlyArray<string>>>

/** A field's key in the answers. */
export const fieldKey = (field: FormField): string =>
  field.kind === "contact"
    ? field.field
    : field.kind === "custom"
      ? `custom:${field.fieldId}`
      : `topic:${field.topicId}`

const AUTOCOMPLETE: Readonly<Record<string, string>> = {
  email: "email",
  firstName: "given-name",
  lastName: "family-name",
  phone: "tel",
  company: "organization",
  title: "organization-title",
  city: "address-level2",
  region: "address-level1",
  country: "country-name",
}

const INPUT_TYPE: Readonly<Record<string, string>> = { email: "email", phone: "tel" }

export interface FormViewProps {
  readonly content: FormContent
  /** The team's custom fields, for the custom fields the form asks. */
  readonly customFields: ReadonlyArray<CustomField>
  readonly privacyPolicyUrl: string | null
  readonly values: FormValues
  readonly onChange: (key: string, value: string | boolean | ReadonlyArray<string>) => void
  readonly onSubmit: () => void
  /** "sent" shows the after-submit message in place of the form. */
  readonly state?: "form" | "sent"
  readonly busy?: boolean
  /** Problems by field key, and one for the whole form under "form". */
  readonly errors?: Readonly<Record<string, string>>
  /** Unique per rendering, so several forms on one page keep their ids apart. */
  readonly idPrefix?: string
  /** Things the live form adds, such as a captcha widget, just above the button. */
  readonly beforeButton?: ReactNode
  /** Forces light or dark mode for light and dark colors, as the designer's preview does. */
  readonly mode?: "light" | "dark"
  /** The title's heading level: 1 on the hosted page, where the form is the page; 2 inside a site's page. */
  readonly titleLevel?: 1 | 2
}

export function FormView(props: FormViewProps) {
  const { content } = props
  const prefix = props.idPrefix ?? "pf"
  const errors = props.errors ?? {}
  const css = appearanceCss(content.appearance, `.Form[data-form="${prefix}"]`, props.mode)
  const form = useRef<HTMLFormElement>(null)
  const message = useRef<HTMLDivElement>(null)
  /** Set by a submit, so the problems it brings back move focus to the first one; typing doesn't. */
  const focusProblem = useRef(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (props.busy) return
    focusProblem.current = true
    props.onSubmit()
  }
  const sent = props.state === "sent" && content.afterSubmit.kind === "message"
  // Screen readers hear the message once it replaces the form: focus moves to it.
  useEffect(() => {
    if (sent) message.current?.focus()
  }, [sent])
  useEffect(() => {
    if (!focusProblem.current || Object.keys(errors).length === 0) return
    focusProblem.current = false
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors])
  const Title = props.titleLevel === 1 ? "h1" : "h2"

  if (sent && content.afterSubmit.kind === "message") {
    return (
      <div className="Form" data-form={prefix}>
        <style>{css}</style>
        {content.appearance.fonts.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <div className="Message" ref={message} tabIndex={-1}>
          <Title className="Title">{content.afterSubmit.title}</Title>
          <p className="Description">{content.afterSubmit.body}</p>
        </div>
      </div>
    )
  }

  return (
    <form
      ref={form}
      className="Form"
      data-form={prefix}
      onSubmit={submit}
      noValidate
      aria-busy={props.busy || undefined}
    >
      <style>{css}</style>
      {content.appearance.fonts.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {content.title ? <Title className="Title">{content.title}</Title> : null}
      {content.description ? <p className="Description">{content.description}</p> : null}
      {content.fields.map((field) => (
        <FieldView
          key={fieldKey(field)}
          field={field}
          id={`${prefix}-${fieldKey(field).replace(/[^a-zA-Z0-9-]/g, "-")}`}
          customFields={props.customFields}
          value={props.values[fieldKey(field)]}
          error={errors[fieldKey(field)]}
          onChange={(value) => props.onChange(fieldKey(field), value)}
        />
      ))}
      {/* People never see or fill this; bots that fill every field give themselves away (D147). */}
      <div className="Honey" aria-hidden="true">
        <label htmlFor={`${prefix}-website`}>Website</label>
        <input
          id={`${prefix}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={typeof props.values._website === "string" ? props.values._website : ""}
          onChange={(event) => props.onChange("_website", event.target.value)}
        />
      </div>
      {props.beforeButton}
      {errors.form ? (
        <p className="Error" role="alert">
          {errors.form}
        </p>
      ) : null}
      {/* aria-disabled, not disabled, so focus stays on the button while it sends. */}
      <button className="Button" type="submit" aria-disabled={props.busy || undefined}>
        {props.busy ? "Sending…" : content.submitLabel}
      </button>
      {content.finePrint || props.privacyPolicyUrl ? (
        <p className="FinePrint">
          {content.finePrint}
          {content.finePrint && props.privacyPolicyUrl ? " " : null}
          {props.privacyPolicyUrl ? (
            <a href={props.privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
              Privacy policy
            </a>
          ) : null}
        </p>
      ) : null}
    </form>
  )
}

function FieldView(props: {
  readonly field: FormField
  readonly id: string
  readonly customFields: ReadonlyArray<CustomField>
  readonly value: string | boolean | ReadonlyArray<string> | undefined
  readonly error: string | undefined
  readonly onChange: (value: string | boolean | ReadonlyArray<string>) => void
}) {
  const { field, id, error } = props
  const errorId = error ? `${id}-error` : undefined
  const text = typeof props.value === "string" ? props.value : ""
  const errorLine = error ? (
    <p className="Error" id={errorId}>
      {error}
    </p>
  ) : null

  if (field.kind === "consent") {
    return (
      <div className="Field">
        <label className="Checkbox" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={props.value === true}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            onChange={(event) => props.onChange(event.target.checked)}
          />
          <span>{field.label}</span>
        </label>
        {errorLine}
      </div>
    )
  }

  const label = (
    <label className="Label" htmlFor={id}>
      {field.label}
      {field.required ? null : <span className="Optional"> Optional</span>}
    </label>
  )
  const inputClass = error ? "Input Input--invalid" : "Input"

  if (field.kind === "custom") {
    const definition = props.customFields.find((entry) => entry.id === field.fieldId)
    if (definition?.type === "single-select") {
      return (
        <div className="Field">
          {label}
          <select
            id={id}
            className={inputClass}
            value={text}
            required={field.required}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            onChange={(event) => props.onChange(event.target.value)}
          >
            <option value="">{field.placeholder ?? "Choose one"}</option>
            {definition.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {errorLine}
        </div>
      )
    }
    if (definition?.type === "multi-select") {
      const chosen = Array.isArray(props.value) ? props.value : []
      return (
        <fieldset className="Field" aria-describedby={errorId}>
          <legend className="Label">{field.label}</legend>
          {definition.options.map((option) => (
            <label key={option.id} className="Checkbox" htmlFor={`${id}-${option.id}`}>
              <input
                id={`${id}-${option.id}`}
                type="checkbox"
                checked={chosen.includes(option.id)}
                onChange={(event) =>
                  props.onChange(
                    event.target.checked ? [...chosen, option.id] : chosen.filter((entry) => entry !== option.id),
                  )
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
          {errorLine}
        </fieldset>
      )
    }
    if (definition?.type === "checkbox") {
      return (
        <div className="Field">
          <label className="Checkbox" htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={props.value === true}
              onChange={(event) => props.onChange(event.target.checked)}
            />
            <span>{field.label}</span>
          </label>
          {errorLine}
        </div>
      )
    }
    const type =
      definition?.type === "number"
        ? "number"
        : definition?.type === "date"
          ? "date"
          : definition?.type === "url"
            ? "url"
            : definition?.type === "email"
              ? "email"
              : definition?.type === "phone"
                ? "tel"
                : "text"
    return (
      <div className="Field">
        {label}
        <input
          id={id}
          className={inputClass}
          type={type}
          value={text}
          placeholder={field.placeholder}
          required={field.required}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          onChange={(event) => props.onChange(event.target.value)}
        />
        {errorLine}
      </div>
    )
  }

  return (
    <div className="Field">
      {label}
      <input
        id={id}
        className={inputClass}
        type={INPUT_TYPE[field.field] ?? "text"}
        name={field.field}
        autoComplete={AUTOCOMPLETE[field.field]}
        inputMode={field.field === "email" ? "email" : undefined}
        value={text}
        placeholder={field.placeholder}
        required={field.required}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {errorLine}
    </div>
  )
}
