import type { UserText } from "@parley/errors"
import type { FormEvent, ReactNode } from "react"
import { ParleyMark } from "./logo.tsx"
import { Button, ErrorText, FieldLabel, Input } from "./ui/index.ts"
import { AuthHeading, AuthPage } from "./ui/public.tsx"

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
    <AuthPage>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <ParleyMark className="h-8 self-start" />
        <AuthHeading title={props.title}>{props.intro}</AuthHeading>
        {props.children}
        {props.error ? <ErrorText className="text-base">{props.error}</ErrorText> : null}
        <Button variant="primary" size="lg" wide type="submit" disabled={props.busy}>
          {props.submitLabel}
        </Button>
        <p className="m-0 text-sm text-muted [&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2">{props.footer}</p>
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
}) {
  return (
    <div>
      <FieldLabel htmlFor={props.name}>{props.label}</FieldLabel>
      <Input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        required
      />
    </div>
  )
}
