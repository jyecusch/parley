import { type UserText, userText } from "@parley/errors"

export interface Session {
  readonly user: { readonly id: string; readonly name: string; readonly email: string }
}

/** Better-Auth's error codes, in our words. Its own message text is never shown (docs/02). */
const messageForCode = (code: string | undefined): UserText => {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return userText`That email and password don't match. Check them and try again.`
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return userText`There's already an account with that email. Sign in instead.`
    case "PASSWORD_TOO_SHORT":
      return userText`Use at least 8 characters for your password.`
    case "INVALID_EMAIL":
      return userText`Enter a full email address, like jane@example.com.`
    default:
      return userText`We couldn't sign you in just now. Nothing was changed. Try again in a moment.`
  }
}

const post = async (path: string, body: unknown): Promise<UserText | undefined> => {
  try {
    const response = await fetch(`/api/auth${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (response.ok) return undefined
    const json = (await response.json().catch(() => ({}))) as { code?: string }
    return messageForCode(json.code)
  } catch {
    return userText`Parley couldn't be reached. Check your connection and try again.`
  }
}

export const signIn = (email: string, password: string) => post("/sign-in/email", { email, password })
export const signUp = (name: string, email: string, password: string) =>
  post("/sign-up/email", { name, email, password })
export const signOut = () => post("/sign-out", {})

export const getSession = async (): Promise<Session | null> => {
  const response = await fetch("/api/auth/get-session", { credentials: "same-origin" })
  if (!response.ok) return null
  return ((await response.json()) as Session | null) ?? null
}
