import { Config, Effect, Option, Redacted } from "effect"

/**
 * A secret that rotates (D152): its current value, if set, and its previous values, which still
 * read what they wrote. Once email really goes out (RESEND_API_KEY), it must be set: falling back
 * to the sign-in secret would tie it to that secret's rotation, which keeps no previous values.
 */
export const rotatingSecret = (name: string, previousName: string, required: string) =>
  Effect.gen(function* () {
    const own = yield* Config.option(Config.Redacted(name)).pipe(Effect.orDie)
    const previous = yield* Config.option(Config.Redacted(previousName)).pipe(Effect.orDie)
    const sendsForReal = yield* Config.option(Config.String("RESEND_API_KEY")).pipe(Effect.orDie)
    if (Option.isNone(own) && Option.isSome(sendsForReal) && sendsForReal.value.trim() !== "") {
      return yield* Effect.die(new Error(`${name} is required when RESEND_API_KEY is set: ${required}`))
    }
    return {
      current: Option.map(own, Redacted.value),
      previous: Option.match(previous, {
        onSome: (value) =>
          Redacted.value(value)
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ""),
        onNone: (): ReadonlyArray<string> => [],
      }),
    }
  })
