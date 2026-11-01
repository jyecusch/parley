import type { ZxcvbnFactory } from "@zxcvbn-ts/core"

/**
 * How hard a password is to guess, scored 0 to 4 by zxcvbn (D172). The web app shows it as you
 * type and the server refuses anything below Good, so both judge by the same rule.
 */
export interface PasswordStrength {
  readonly score: 0 | 1 | 2 | 3 | 4
  readonly label: (typeof STRENGTH_LABELS)[number]
  /** zxcvbn's reason, such as "This is a commonly used password." */
  readonly warning: string | null
}

export const STRENGTH_LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"] as const

/** The lowest score a new password may have: Good. */
export const ENOUGH_STRENGTH = 3

/** The checker and its dictionaries are a few hundred KB, so they load on first use. */
let checker: Promise<ZxcvbnFactory> | undefined
const load = () => {
  checker ??= Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
    import("@zxcvbn-ts/language-en"),
  ]).then(
    ([core, common, en]) =>
      new core.ZxcvbnFactory({
        translations: en.translations,
        graphs: common.adjacencyGraphs,
        dictionary: { ...common.dictionary, ...en.dictionary },
      }),
  )
  return checker
}

/** `context`: words a guesser would try first for this person, such as their name and email. */
export const passwordStrength = async (
  password: string,
  context: ReadonlyArray<string> = [],
): Promise<PasswordStrength> => {
  const result = (await load()).check(password, [...context])
  return {
    score: result.score,
    label: STRENGTH_LABELS[result.score],
    warning: result.feedback.warning || result.feedback.suggestions[0] || null,
  }
}
