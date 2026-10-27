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
        <Button variant="primary" size="lg" wide type="submit" disabled={props.busy}>
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
