import { EchoedInput, type UserText, userText } from "@parley/errors"

export interface Session {
  readonly user: {
    readonly id: string
    readonly name: string
    readonly email: string
  }
}

/** Better-Auth's error codes and statuses, in our words. Its own message text is never shown (docs/02). */
const messageForCode = (code: string | undefined, status: number, email: string | undefined): UserText => {
  if (status === 429) return userText`Too many attempts in a short time. Wait a minute, then try again.`
  if (status >= 500) {
    return userText`Something went wrong on Parley's side, so you weren't signed in. Try again; if it keeps happening, the server's log says why.`
  }
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
    case "EMAIL_NOT_VERIFIED":
      // Signing in unconfirmed sends a fresh link (D163).
      return email
        ? userText`Confirm your email address first. We've sent a new link to ${EchoedInput.fromRequest(email)}.`
        : userText`Confirm your email address first. We've sent you a new link.`
    case "INVALID_ORIGIN":
      return userText`Parley is set up for a different address than the one you're using. Open it at the address in its settings, or update that address.`
    default:
      return userText`We couldn't sign you in just now. Nothing was changed. Try again in a moment.`
  }
}

/** Signed in, and where to go next when an agent's sign-in request is waiting (D89). */
export interface AuthOutcome {
  readonly failure?: UserText
  readonly next?: string
}

const post = async (path: string, body: Record<string, unknown>): Promise<AuthOutcome> => {
  const request = agentRequest()
  try {
    const response = await fetch(`/api/auth${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request ? { ...body, oauth_query: request } : body),
    })
    const json = (await response.json().catch(() => ({}))) as { code?: string; redirect?: boolean; url?: string }
    if (!response.ok) {
      return {
        failure: messageForCode(json.code, response.status, typeof body.email === "string" ? body.email : undefined),
      }
    }
    return json.redirect && json.url ? { next: json.url } : {}
  } catch {
    return { failure: userText`Parley couldn't be reached. Check your connection and try again.` }
  }
}

/**
 * An agent's sign-in request (D89): the signed query Parley's sign-in and consent pages are
 * opened with. Read from the address bar exactly as sent, because it is signed.
 */
export const agentRequest = (): string | undefined => {
  if (typeof window === "undefined") return undefined
  const params = new URLSearchParams(window.location.search)
  return params.has("sig") && params.has("client_id") ? window.location.search.slice(1) : undefined
}

/** Carries an agent's sign-in request on to another page. */
export const withAgentRequest = (path: string) => {
  const request = agentRequest()
  return request ? `${path}?${request}` : path
}

/**
 * The session, read once and reused briefly: every navigation in the app checks it, and a fresh
 * read each time adds up fast for a team sharing one IP address.
 */
const SESSION_REUSE_MS = 30_000
let remembered: { readonly at: number; readonly session: Promise<Session | null> } | undefined

/** Forget the remembered session, so the next check asks the server. */
const forgetSession = <A>(result: A): A => {
  remembered = undefined
  return result
}

export const signIn = (email: string, password: string) =>
  post("/sign-in/email", { email, password }).then(forgetSession)
/** `returnTo` is where the email-confirmation link leads, such as back to an invitation (D130). */
export const signUp = (name: string, email: string, password: string, returnTo?: string) =>
  post("/sign-up/email", { name, email, password, ...(returnTo ? { callbackURL: returnTo } : {}) }).then(forgetSession)
export const signOut = () => post("/sign-out", {}).then(forgetSession)
/** Sends the email-confirmation link again (D163). `returnTo` is where it leads, as at sign-up. */
export const resendConfirmation = (email: string, returnTo?: string) =>
  post("/send-verification-email", { email, ...(returnTo ? { callbackURL: returnTo } : {}) })

/**
 * The signed-in session, or null when nobody is signed in. A failed check (the server is busy or
 * unreachable) rejects rather than returning null, so it never looks like being signed out.
 */
export const getSession = (): Promise<Session | null> => {
  if (remembered && Date.now() - remembered.at < SESSION_REUSE_MS) return remembered.session
  const session = fetch("/api/auth/get-session", { credentials: "same-origin" }).then(async (response) => {
    if (!response.ok) throw new Error("Couldn't check whether you're signed in. Try again in a moment.")
    return ((await response.json()) as Session | null) ?? null
  })
  remembered = { at: Date.now(), session }
  session.catch(() => {
    if (remembered?.session === session) remembered = undefined
  })
  return session
}
