import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { passkeyClient } from "@better-auth/passkey/client"
import { EchoedInput, type UserText, userText } from "@parley/errors"
import { createAuthClient } from "better-auth/client"

export interface Session {
  readonly user: {
    readonly id: string
    readonly name: string
    readonly email: string
    /** Signing in asks for a code after the password (D172). */
    readonly twoFactorEnabled?: boolean | null
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
    case "PASSWORD_TOO_WEAK":
      return userText`That password is too easy to guess. Choose one rated Good or better.`
    case "INVALID_TOKEN":
      return userText`This link doesn't work anymore. Reset links work once, for an hour. Ask for a new one.`
    case "INVALID_PASSWORD":
      return userText`That isn't your current password.`
    case "INVALID_CODE":
      return userText`That code doesn't work. Codes change every 30 seconds, so enter the one showing now.`
    case "INVALID_BACKUP_CODE":
      return userText`That code doesn't work. Check it, or try another.`
    case "INVALID_TWO_FACTOR_COOKIE":
      return userText`Signing in took too long. Start over and enter your password again.`
    case "ACCOUNT_TEMPORARILY_LOCKED":
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
      return userText`Too many wrong codes. Wait a few minutes, then start over.`
    case "AUTH_CANCELLED":
    case "ERROR_CEREMONY_ABORTED":
    case "REGISTRATION_CANCELLED":
      return userText`The passkey request was canceled. Try again when you're ready.`
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
      return userText`This device already has a passkey for your account.`
    case "PASSKEY_NOT_VERIFIED":
      return userText`That passkey didn't check your fingerprint, face or PIN, so it can't be used here. Use one that does, such as your device's built-in passkey.`
    case "PASSKEY_NOT_FOUND":
      return userText`That passkey isn't set up for Parley anymore. Sign in with your password instead.`
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

/**
 * Signed in, and where to go next when an agent's sign-in request is waiting (D89). `secondStep`:
 * the password was right and the account asks for a code next (D172).
 */
export interface AuthOutcome {
  readonly failure?: UserText
  readonly next?: string
  readonly secondStep?: boolean
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
    const json = (await response.json().catch(() => ({}))) as {
      code?: string
      redirect?: boolean
      url?: string
      twoFactorRedirect?: boolean
    }
    if (!response.ok) {
      return {
        failure: messageForCode(json.code, response.status, typeof body.email === "string" ? body.email : undefined),
      }
    }
    if (json.twoFactorRedirect) return { secondStep: true }
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
export const forgetSession = <A>(result: A): A => {
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

/** Emails a link to choose a new password, if the address has an account (D172). */
export const requestPasswordReset = (email: string) =>
  post("/request-password-reset", { email, redirectTo: "/reset-password" })
/** Sets a new password from a reset link's token. Every session ends (D172). */
export const resetPassword = (token: string, newPassword: string) =>
  post("/reset-password", { token, newPassword }).then(forgetSession)

/** The second step of signing in (D172): a code from the authenticator app, or a backup code. */
export const verifyCode = (code: string, trustDevice: boolean) =>
  post("/two-factor/verify-totp", { code: code.replace(/\s/g, ""), trustDevice }).then(forgetSession)
export const verifyBackupCode = (code: string, trustDevice: boolean) =>
  post("/two-factor/verify-backup-code", { code: code.trim(), trustDevice }).then(forgetSession)

/** Better-Auth's own client, for passkeys: it runs the browser's passkey prompt (D172). */
const passkeys = () =>
  createAuthClient({
    basePath: "/api/auth",
    // An agent's sign-in request rides along, so signing in carries on to its consent page.
    plugins: [passkeyClient(), ...(agentRequest() ? [oauthProviderClient()] : [])],
  })

interface ClientResult<A> {
  readonly data: A | null
  readonly error: { readonly code?: string | undefined; readonly status: number } | null
}

const outcomeOf = <A>(result: ClientResult<A>): AuthOutcome & { readonly data?: A } => {
  if (result.error) return { failure: messageForCode(result.error.code, result.error.status, undefined) }
  const data = result.data as (A & { redirect?: boolean; url?: string }) | null
  return { ...(data?.redirect && data.url ? { next: data.url } : {}), ...(data ? { data } : {}) }
}

/**
 * Signs in with a passkey, no password or code (D172). `autoFill`: offered quietly from the email
 * field's suggestions, rather than by opening the browser's prompt.
 */
export const signInWithPasskey = async (autoFill = false) =>
  forgetSession(outcomeOf(await passkeys().signIn.passkey({ autoFill })))

export interface Passkey {
  readonly id: string
  readonly name?: string | null
  readonly createdAt: string | Date
}

/** What a sign-in setting returned, or why it couldn't change, in words to show (D172). */
export type Changed<A = unknown> = { readonly data: A; readonly failure?: undefined } | { readonly failure: UserText }

const call = async <A>(
  path: string,
  init: { method: "GET" } | { method: "POST"; body: object },
): Promise<Changed<A>> => {
  try {
    const response = await fetch(`/api/auth${path}`, {
      method: init.method,
      credentials: "same-origin",
      ...(init.method === "POST"
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }
        : {}),
    })
    const json = (await response.json().catch(() => null)) as (A & { code?: string }) | null
    if (!response.ok) return { failure: messageForCode(json?.code, response.status, undefined) }
    return { data: json as A }
  } catch {
    return { failure: userText`Parley couldn't be reached. Check your connection and try again.` }
  }
}

/** Your own sign-in settings (D172). Each returns its result or, when it fails, why. */
export const security = {
  passkeys: () => call<ReadonlyArray<Passkey>>("/passkey/list-user-passkeys", { method: "GET" }),
  addPasskey: async (name: string): Promise<Changed> => {
    const outcome = outcomeOf(await passkeys().passkey.addPasskey({ name }))
    return outcome.failure ? { failure: outcome.failure } : { data: undefined }
  },
  renamePasskey: (id: string, name: string) => call("/passkey/update-passkey", { method: "POST", body: { id, name } }),
  removePasskey: (id: string) => call("/passkey/delete-passkey", { method: "POST", body: { id } }),
  /** Starts turning on two-factor authentication: the app's setup link and the backup codes. */
  startTwoFactor: (password: string) =>
    call<{ readonly totpURI: string; readonly backupCodes: ReadonlyArray<string> }>("/two-factor/enable", {
      method: "POST",
      body: { password },
    }),
  /** Finishes turning it on, once a code from the app proves it's set up. */
  confirmTwoFactor: (code: string) =>
    call("/two-factor/verify-totp", { method: "POST", body: { code: code.replace(/\s/g, "") } }),
  turnOffTwoFactor: (password: string) => call("/two-factor/disable", { method: "POST", body: { password } }),
  newBackupCodes: (password: string) =>
    call<{ readonly backupCodes: ReadonlyArray<string> }>("/two-factor/generate-backup-codes", {
      method: "POST",
      body: { password },
    }),
  changePassword: (currentPassword: string, newPassword: string, signOutElsewhere: boolean) =>
    call("/change-password", {
      method: "POST",
      body: { currentPassword, newPassword, revokeOtherSessions: signOutElsewhere },
    }),
}
