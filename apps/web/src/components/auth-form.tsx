import type { UserText } from "@parley/errors"
import { useNavigate } from "@tanstack/react-router"
import type { FormEvent, ReactNode } from "react"
import { signOut } from "../lib/auth.ts"
import { ParleyMark } from "./logo.tsx"
import { Button, ErrorText, FieldLabel, Input } from "./ui/index.ts"
import { AuthHeading, AuthPage, LinkButton } from "./ui/public.tsx"

/** Who's signed in, with a way out, so nobody gets stuck in a step under the wrong account. */
export function SignedInAs(props: { readonly email: string }) {
  const navigate = useNavigate()
  return (
    <p className="m-0 border-t border-line pt-3 text-sm text-muted">
      Signed in as {props.email}.{" "}
      <LinkButton
        onClick={async () => {
          await signOut()
          await navigate({ to: "/sign-in" })
        }}
      >
        Sign out
      </LinkButton>
    </p>
  )
}

export function AuthForm(props: {
  readonly title: string
  readonly intro: string
  readonly submitLabel: string
  readonly busy: boolean
  readonly error: UserText | undefined
  readonly onSubmit: (form: FormData) => void
  readonly children: ReactNode
  readonly footer: ReactNode
  /** Shown between the heading and the fields, such as invitations to join instead (D131). */
  readonly before?: ReactNode
  /** Shown last, such as who's signed in. */
  readonly after?: ReactNode
  /** Holds the submit button back, such as while a new password is too easy to guess (D172). */
  readonly cannotSubmit?: boolean
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    props.onSubmit(new FormData(event.currentTarget))
  }
  return (
    <AuthPage>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <ParleyMark className="h-8 self-start" />
        <AuthHeading title={props.title}>{props.intro}</AuthHeading>
        {props.before}
        {props.children}
        {props.error ? <ErrorText className="text-base">{props.error}</ErrorText> : null}
        <Button variant="primary" size="lg" wide type="submit" disabled={props.busy || props.cannotSubmit}>
          {props.submitLabel}
        </Button>
        <p className="m-0 text-sm text-muted [&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2">{props.footer}</p>
        {props.after}
      </form>
    </AuthPage>
  )
}

export function Field(props: {
  readonly label: string
  readonly name: string
  readonly type?: string
  readonly autoComplete?: string
  readonly autoFocus?: boolean
  readonly inputMode?: "numeric"
  readonly defaultValue?: string
  readonly onChange?: (value: string) => void
  /** Beside the label, such as "Forgot password?". */
  readonly aside?: ReactNode
}) {
  return (
    <div>
      {props.aside ? (
        <div className="flex items-baseline justify-between gap-3">
          <FieldLabel htmlFor={props.name}>{props.label}</FieldLabel>
          <span className="text-sm text-muted [&_a]:text-muted [&_a]:underline-offset-2 [&_a:hover]:text-fg">
            {props.aside}
          </span>
        </div>
      ) : (
        <FieldLabel htmlFor={props.name}>{props.label}</FieldLabel>
      )}
      <Input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        inputMode={props.inputMode}
        defaultValue={props.defaultValue}
        required
        {...(props.onChange ? { onChange: (event) => props.onChange?.(event.target.value) } : {})}
      />
    </div>
  )
}
