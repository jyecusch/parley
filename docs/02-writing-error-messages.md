# The friend who picks up the phone

*How we write the words users (and agents) see when something goes wrong in Parley.*

---

It's 4:55pm on a Friday. Priya has spent twenty minutes cleaning up a contact record before a sales call: new title, new phone number, three paragraphs of notes. She hits Save.

> **Something went wrong.**

Did it save? Should she hit Save again? Will that create a duplicate? Is it her fault? Is the whole app down, or only this record? She copies her notes into a text file, just in case, and refreshes. The notes are gone. Or maybe they aren't; she can't tell, because she's now looking at a different tab.

Every one of those questions had an answer, and the system knew most of them. It just didn't say.

This post covers how Parley says them.

## Where this comes from

In 2021 Wix went through every error message in its product, more than seven thousand of them, and rewrote the ones that didn't help ([Jenni Nadler, "When life gives you lemons, write better error messages"](https://medium.com/)). Their CEO's framing stuck with the team: generic errors are "the result of bad development and product", not a copywriting problem.

That's the stance we're taking. A bad message is usually a missing error *type*. If the code can't tell "you were removed" apart from "the database is down", no writer can produce a good sentence for either one. So in Parley the type comes first ([01 — Errors are data](./01-errors-are-data.md)), and this post is about what we write *once we have it*.

## The four parts of a good message

Every `userMessage` answers up to four questions, in this order:

1. **What happened, and why.** Be specific. If we know the cause, say it.
2. **What's safe.** Say what was *not* lost: "Your changes are still here." Users worry about their data before they think about anything else. In Parley that sentence is a promise we keep: unsaved edits survive a failed save and a re-sign-in (D48).
3. **How to fix it, and who can.** Name the role. "A team admin can…", "Whoever created this API key can…", "You can…". A fix that only an admin can apply is no use to someone with the `member` role who doesn't know that.
4. **A way out.** Try later, pick another option, ask someone. Never a dead end.

Not every message needs all four. "That email address is already used by Sam Lee." needs only the first, because the fix is obvious. But *consider* all four every time.

Here's Priya's Friday rewritten, for the case that actually happened (her session expired):

> **You were signed out, so this contact wasn't saved.** Your changes are still here. Sign in again and they'll be saved.

What happened and why, what's safe, how to fix it, a way out. Three sentences.

## Four ways to get it wrong

**The wrong tone.** "Whoops!", "Uh oh!", "Yikes!" A CRM holds users' pipelines, their customer relationships and, soon, their email sends. When something goes wrong, the stakes are real. Be plain and calm. No jokes, no alarm, no grovelling.

**Jargon.** `403 Forbidden`, `ECONNREFUSED`, `unique constraint "contact_emails_team_id_address_key"`, `ContactNotFound`. None of these mean anything to Priya. The users reading our errors know their own business, not ours.

**Blame.** Don't blame the reader: "You entered an invalid email" becomes "Enter an email address like name@example.com". And don't blame third parties either. When we add email sending in v2, our default provider, Resend, *will* have bad days. Users chose Parley, not Resend; they don't want to hear about our suppliers. "We can't send email right now" is ours to own. "Resend is down" is passing the buck. So a `userMessage` never names Resend, blames it, or quotes its error text. That detail goes in the log `message`, where an operator can act on it.

**Generic when we know.** "Something went wrong" is acceptable for exactly one case: a real bug, where we genuinely don't know what happened. Everything else has a type, and every type has a specific sentence.

## Generic vs. unclear

Wix found a second kind of bad message that's just as bad, and harder to spot: the **unclear** message. It tries to explain, but the explanation doesn't land.

| Generic | Unclear | Clear |
| --- | --- | --- |
| Something went wrong. | Insufficient permissions for this resource. | Your role in Acme can't manage custom fields. A team admin can change your role in Settings → Members. |
| Request failed. | API key scope does not include records:write. | This API key can only read records, so it can't edit Sam Lee. Whoever created it can create one that can write. |

The unclear column is the trap. It *feels* specific because it has nouns in it. But "resource", "permissions" and "scope" are our words, not the reader's. Test every message by asking: could someone who has never seen our code act on this?

## Two audiences, one message

Parley is agent-first. The same error reaches Priya in the web UI *and* an LLM agent calling `contacts_update` over MCP. Do we need two messages?

No. And this is the nice part: **a good message for a user is also exactly what an agent needs.**

Think about what an agent does with an error. It has to decide: retry? Try something else? Stop and tell its user? To do that, it needs the same four answers Priya does. Most of all it needs *who can fix it*, because an agent that knows "a team admin can grant write access" can tell its user precisely what to ask for. An agent that gets `403` can only guess, and agents that guess tend to retry, hammering the same wall.

So the split is:

| Field | Who reads it | What for |
| --- | --- | --- |
| `userMessage` | Users, **and** agents reasoning in natural language | Understanding, explaining to a user, choosing a fix |
| `_tag` | Code (our UI, agent frameworks, scripts) | Branching: "if `ContactEmailTaken`, offer to merge" |
| `isRetryable` | Code | "Would the exact same request, sent again, possibly work?" |
| `retryAfterMillis` | Code | How long the other side asked us to wait |

Decisions live in the typed fields; explanation lives in the sentence. An agent should never have to parse our prose to decide whether to retry, and a user should never have to read a `_tag`.

One consequence: write messages so they still make sense **without the screen around them**. "Click the button above" means nothing over MCP. "A team admin can change your role in Settings → Members" works everywhere: in the UI, in an agent's summary, read aloud.

## The Parley examples

| Error (`_tag`) | Bad | Good |
| --- | --- | --- |
| `RoleLacksPermission` | Forbidden. | Your role in Acme can't manage custom fields. A team admin can change your role in Settings → Members. |
| `ApiKeyScopeExcludes` | Insufficient scope. | This API key can only read records, so it can't update Sam Lee. Whoever created the API key can create one that can edit records. |
| `NotATeamMember` | Unauthorized. | You are no longer a member of Acme, so this change wasn't saved. Switch to another team, or ask an Acme admin to invite you again. |
| `ContactNotFound` | 404 Not Found. | We can't find this contact in Acme. It may have been deleted. Search contacts to find who you're looking for. |
| `ContactEmailTaken` | Duplicate key violates unique constraint. | That email address is already used by Sam Lee in Acme. Open Sam Lee's contact to update it there. |
| `SessionExpired` | Session invalid. Please log in. | You were signed out, so this wasn't saved. Your changes are still here. Sign in again to save them. |
| `DatabaseUnavailable` | Something went wrong. | We couldn't save this contact because of a problem on our end. Your changes are still here. Try again in a minute. |
| `ApiKeyRevoked` | Invalid API key. | This API key was revoked, so Parley can't accept requests from it. Whoever created it can create a new one in Settings → API keys. |
| `RequestsTooFrequent` | 429 Too Many Requests. | Too many requests from this API key in a short time. Try again in 30 seconds. |
| `SendingDomainNotVerified` *(v2)* | Send failed: domain not verified. | This campaign wasn't sent because Acme hasn't verified a sending domain yet. Your draft is saved. A team admin can verify one in Settings → Email. |

Notice that `RoleLacksPermission` and `ApiKeyScopeExcludes` are **two classes**, not one `PermissionMissing` with a `reason` field. They need different fixes from different users: one needs an admin to change a role, the other needs the API key's creator to create a new API key. Different fix, different class. That rule comes from [01](./01-errors-are-data.md), and this table is why it matters.

Notice too that `ContactNotFound` fires whether the contact was deleted *or* lives in a different team. We deliberately don't say "this contact belongs to another team", because that would confirm it exists to someone with no right to know. The message stays honest ("we can't find this contact *in Acme*") without leaking anything.

## What can go inside a message

A `userMessage` is built with the `userText` template ([01](./01-errors-are-data.md) covers the mechanics). The rule for what can go in the `${}` holes is short:

| Allowed | Not allowed |
| --- | --- |
| Fixed words we wrote, including small choices like `n === 1 ? "minute" : "minutes"` | Ids (`ct_8f2…`), even "just for debugging" |
| Numbers | HTTP status codes, socket codes, SQL states |
| A `DisplayName`: a name the reader already sees in the app (a team, a contact, a company, an API key's name) | Any raw `string`, including `error.message` |
| Another `UserText` | Text from a library, the database, Better-Auth or an email provider |

The idea behind `DisplayName` is that we only echo back names the reader can already see on screen. "Sam Lee" is fine in a message to someone who's looking at Sam Lee. A contact id is noise, and a third party's error text is something we haven't vetted and can't promise is accurate, safe or kind.

Ids, codes and raw library text still matter, but to *operators*, so they go in `message` (logs), never in `userMessage`.

**User-entered values: only from this request (D38).** Some of the most useful messages repeat a value the user just typed: "**sam@acme.com** is already used by Sam Lee." That's allowed, but only through the `EchoedInput` brand ([01](./01-errors-are-data.md)): the value must come from the request being answered, it's length-capped, and the brand makes every use deliberate and greppable. A `ContactEmailTaken` message confirms that *some contact in this team* has that address, which is fine for any member of the team, since they can already see every contact. We never echo a stored value someone else entered, and `InputRejected` never echoes the rejected value.

## Field-level validation

Form errors are the messages users see most, so they get their own conventions:

- **Say what to do, not what's wrong.** "Enter an email address like name@example.com", not "Invalid email".
- **Put the message next to the field**, and keep it to one line. A summary at the top is only for forms with several errors at once.
- **Name the limit.** "Use 200 characters or fewer (this is 214)", not "Too long".
- **Don't punish half-finished typing.** Validate on blur or submit, not on every keystroke.
- **Keep the input.** A rejected submit never clears what the user typed.
- **The same rules apply over the API.** A validation error returns *every* field problem at once, each with a field path and a sentence. An agent fixing three bad fields shouldn't need three round trips.

## Parley's voice, briefly

- **Plain.** Short words, short sentences. "Can't", not "is unable to".
- **Calm.** No exclamation marks in errors. No "Oops".
- **Ours.** "We couldn't…" for our problems. "Your role…" or "This API key…" for theirs, stated as a fact, never as an accusation.
- **Specific.** Real names (Acme, Sam Lee, Settings → Members, Settings → API keys), real numbers, real next steps.
- **Rarely "please", and never "sorry" as filler.** Save "please" for situations that are really bad for the user.

## How errors get designed

Wix's biggest lesson was about process: they fixed thousands of messages *after* the fact, reactively. We'd rather not do that.

**Errors are part of every screen's design asset (D57).** When we discuss a screen before building it, the design includes its error states: which `_tag`s can reach that screen, what each one says, and where it appears (inline, toast, or full-screen). If a screen's design has no error states (or empty and loading states), it isn't finished. This fits naturally with the "stress test every view type and state" habit from [05](./05-ux-principles.md).

**A 30-day error review after each launch, on our hosted instance (D49).** We'll find out which errors actually happen and how often. One month after a feature ships, we look at the error frequency by `_tag`, rewrite the messages for the common ones, and split any class that turns out to need two different fixes. Because every error is typed and severity-tagged, this is a query, not an archaeology project. Self-hosted installs are never part of it: telemetry there is opt-in OpenTelemetry, off by default, with no phone-home.

**And always: question the generic.** If anyone (a contributor or an agent) proposes "let's just use a generic message here", the answer is "why are users seeing this, and what's actually happening?" A generic message is a sign of a missing type.

## Open questions

None; all resolved (D37, D38, D46, D48, D49, D57). See the [decisions log](./decisions.md).

The defect message is now fixed (D46): *"Something on our side failed, and nothing was changed. Try again. If it keeps happening, share reference ABC123 with your Parley administrator."* The reference id finds the full log entry, and on a self-hosted install the administrator is the instance operator.
