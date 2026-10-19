import type { UserText } from "@parley/errors"
import type { FormEvent, ReactNode } from "react"

export function AuthForm(props: {
  readonly title: string
  readonly intro: string
  readonly submitLabel: string
  readonly busy: boolean
  readonly error: UserText | undefined
  readonly onSubmit: (form: FormData) => void
  readonly children: ReactNode
  readonly footer: ReactNode
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    props.onSubmit(new FormData(event.currentTarget))
  }
  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <span className="logo" style={{ width: 28, height: 28, fontSize: 14, borderRadius: 7 }} aria-hidden="true">
          P
        </span>
        <div>
          <h1>{props.title}</h1>
          <p>{props.intro}</p>
        </div>
        {props.children}
        {props.error ? (
          <p className="form-error" role="alert">
            {props.error}
          </p>
        ) : null}
        <button className="btn primary wide" type="submit" disabled={props.busy}>
          {props.submitLabel}
        </button>
        <p className="sm-t">{props.footer}</p>
      </form>
    </main>
  )
}

export function Field(props: {
  readonly label: string
  readonly name: string
  readonly type?: string
  readonly autoComplete?: string
  readonly autoFocus?: boolean
}) {
  return (
    <div>
      <label className="ilabel" htmlFor={props.name}>
        {props.label}
      </label>
      <input
        className="inp"
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        // biome-ignore lint/a11y/noAutofocus: the first field of a single-purpose sign-in screen
        autoFocus={props.autoFocus}
        required
      />
    </div>
  )
}
