import { ENOUGH_STRENGTH, type PasswordStrength, passwordStrength } from "@parley/domain"
import { useEffect, useState } from "react"
import { FieldLabel as FieldTitle } from "./ui/field.tsx"
import { FieldLabel, Hint, Input } from "./ui/index.ts"
import { Meter } from "./ui/meter.tsx"

const TONES = ["danger", "danger", "warn", "ok", "ok"] as const

/**
 * A field for choosing a password, with how hard it is to guess underneath (D172). Anything below
 * Good is refused, here and by the server, so `onEnough` tells the form whether to allow it.
 */
export function NewPasswordField(props: {
  readonly id: string
  readonly name: string
  readonly label: string
  /** Words a guesser would try first, such as the person's name and email. */
  readonly context?: ReadonlyArray<string>
  readonly autoFocus?: boolean
  /** Labeled like the dialog's other fields, rather than like a sign-in page's. */
  readonly inDialog?: boolean
  readonly onEnough: (enough: boolean) => void
}) {
  const { onEnough, context } = props
  const [password, setPassword] = useState("")
  const [strength, setStrength] = useState<PasswordStrength>()
  const contextKey = (context ?? []).join("\n")
  useEffect(() => {
    let current = true
    if (!password) {
      setStrength(undefined)
      onEnough(false)
      return
    }
    void passwordStrength(password, contextKey ? contextKey.split("\n") : []).then((result) => {
      if (!current) return
      setStrength(result)
      onEnough(result.score >= ENOUGH_STRENGTH)
    })
    return () => {
      current = false
    }
  }, [password, contextKey, onEnough])
  const hintId = `${props.id}-strength`
  return (
    <div className="flex flex-col gap-1.5">
      {props.inDialog ? (
        <FieldTitle htmlFor={props.id}>{props.label}</FieldTitle>
      ) : (
        <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      )}
      <Input
        id={props.id}
        name={props.name}
        type="password"
        autoComplete="new-password"
        autoFocus={props.autoFocus}
        required
        aria-describedby={hintId}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Meter
        className="mt-1"
        aria-label="Password strength"
        min={0}
        max={4}
        value={strength?.score ?? 0}
        getAriaValueText={() => strength?.label ?? "Not entered"}
        tone={strength ? TONES[strength.score] : "primary"}
      />
      <Hint>
        <span id={hintId} aria-live="polite">
          {strength ? (
            <>
              <span className="font-medium text-fg">{strength.label}.</span>{" "}
              {strength.score >= ENOUGH_STRENGTH
                ? (strength.warning ?? "Hard to guess.")
                : `${strength.warning ?? "Too easy to guess."} Use one rated Good or better.`}
            </>
          ) : (
            "Use one rated Good or better: a few unrelated words works well."
          )}
        </span>
      </Hint>
    </div>
  )
}
