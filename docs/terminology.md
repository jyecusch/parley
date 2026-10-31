# Terminology

**One name for everything. Synonyms are banned.**

Every concept in Parley has exactly one name. It is used in code, docs, UI copy, user messages, commit messages and conversation. If a word isn't here and you need it, add it here first, in the same change. If two words seem to mean the same thing, one of them is wrong.

How to pick a name: choose the most common name for the concept. Reject anything vague, or anything that overlaps with another term here, with a concept our users already have (a CRM user thinks "organization" means a customer), or with a term from our stack (Effect, TanStack, Better-Auth, MCP).

**American spelling** (D151): color, behavior, canceled, gray, recognize.

**Third-party names stay third-party.** Better-Auth's `organization`, Effect's `Scope`, a library's `collection` and MCP's `tool` are used *only* when talking about that library's API, never as Parley concepts.

---

## Product

| Term | Meaning | Banned synonyms |
| --- | --- | --- |
| **Team** | The tenant. Everything in Parley belongs to exactly one team. A user can be a member of many teams and switches between them. Stored as a Better-Auth *organization*; Better-Auth's own "teams" sub-feature is not used. Code: `TeamId`. | org, organization, workspace, tenant, account |
| **Contact** | A person tracked in the CRM. | lead, person, customer, prospect |
| **Company** | An organization tracked in the CRM. | account, organization, org, business |
| **Domain** | An email domain a company owns ("acme.com"), lower-cased, without "www.". A company has many; each is unique within a team. Not its website. | email domain (in UI, just "domain"), hostname |
| **Free email domain** | A domain anyone can get an address at (gmail.com, outlook.com). Never a company's domain (D106). | consumer domain, webmail domain, public domain |
| **Domain matching** | Parley affiliating a contact with the company that has its email's domain (D105). | auto-link, auto-affiliation, enrichment, domain linking |
| **Record** | A contact or a company. The umbrella term for CRM data. | entity, object, item, row (outside SQL) |
| **Affiliation** | The link between a contact and a company, optionally carrying a title ("CTO"). A contact can have affiliations with many companies. | association, relationship, employment, position, link |
| **Record type** | Contact or company. | entity type, object type, model |
| **Field** | A property of a record, either built-in (first name, emails) or custom. | attribute, property, column (outside SQL) |
| **Custom field** | A field a team defines on contacts or companies, with a type (text, number, date, checkbox, single select, multi select, URL, email, phone). | custom property, user field, extra field |
| **Primary email** | The one email address of a contact that's marked primary. Broadcasts are sent to it. | main email, default email |
| **Display name** | The name shown for a record: a contact's first and last name (falling back to the primary email), or a company's name. Becomes a `DisplayName` value in user messages. | label, title (title is an affiliation's job title) |
| **Delete** | Hide a record immediately. It can be restored for 30 days, then it's purged. | archive, trash, remove, soft-delete (as a separate word) |
| **Restore** | Bring back a deleted record within 30 days. | undelete, recover, unarchive |
| **Purge** | Permanently remove a deleted record after 30 days. Can't be undone. | hard delete, destroy, wipe |
| **Note** | Free-form text a principal adds to a record's activity, with an author and a time. | comment, memo, annotation |
| **Avatar** | A contact's image: uploaded, else Gravatar (if the team enables it), else initials. | photo, profile picture, picture |
| **Logo** | A company's image: uploaded, else the favicon from its primary domain, else initials. | icon, favicon (except the fetched source), brand image |
| **Social profile** | A link to a contact's or company's page on a social network, such as LinkedIn or X (D133). | social link, social URL, handle (for the link), socials |
| **Import** | Bringing contacts or companies in from a CSV file; also one such run, which Parley carries out in the background with its progress and results (D135). | upload, ingest, import job (in UI copy), sync |
| **Activity** | The history of changes to a record, as shown in the UI, including who made each change (for example "Jane via Claude"). | audit log, history, timeline, events |

## Identity and access

| Term | Meaning | Banned synonyms |
| --- | --- | --- |
| **User** | A human who can sign in to Parley. | person, human, account |
| **Service account** | A non-human identity that is a member of one team, with its own role, for example "Support Bot". Stored as a Better-Auth user with `kind: "service-account"`, and it can never sign in with a password. | bot, agent principal, machine user, integration |
| **Agent** | External AI software (Claude, ChatGPT, opencode, …) that calls Parley through the MCP server or the HTTP API. An agent is never a principal: it authenticates with an API key that belongs to a user or a service account. | assistant, AI, bot |
| **Session** | A user's sign-in to the web app (a Better-Auth session cookie). | login, auth cookie |
| **API key** | A secret credential used by an agent or script. It belongs to either a user (it acts as that user, is limited by its scopes, and is bound to one team) or a service account. | token, PAT, secret, credential (as a noun for this) |
| **CRT mode** | The optional old-monitor look (D81, D102), drawn by a WebGL shader where the browser can, otherwise by the CSS layer. Amber by default. | retro mode, terminal theme, CRT filter |
| **CRT settings** | How CRT mode looks, kept per browser (D114): the **phosphor** color (hue and saturation), text glow, **curvature**, **chromatic aberration**, scanlines, bloom, vignette and flicker. | CRT config, CRT options, CRT preferences |
| **Phosphor** | The color CRT mode draws in, named after a monitor's phosphor coating, set by hue and saturation (saturation 0 is white). | tint, accent color (for this) |
| **Invitation** | An emailed link to join a team with a role, good for 7 days. | invite (as a noun), join link, team invite |
| **Access token** | The short-lived OAuth token an agent gets for a connection and sends to `/mcp`. It names the connection and nothing else. In UI copy, say "the agent's sign-in". | token (alone), bearer, JWT (outside code about its format) |
| **Connection** | An agent someone authorized over OAuth (MCP sign-in), bound to one team, acting as that person or as a service account, limited to its scopes. Listed and revoked in Settings. | grant, authorization, integration, connected app, OAuth app |
| **Principal** | The authenticated identity making a request, and the output of authentication. Exactly one of `UserSession`, `UserApiKey`, `ServiceAccountApiKey`. | actor, caller, requester, subject, identity |
| **Member** | A user or service account that belongs to a team, with exactly one role. Stored in Better-Auth's `member` table. "Jane is a member of Acme." | membership, seat, team member, teammate |
| **Role** | `owner`, `admin` or `member`, held by each member. The role named `member` is the default role, so "a member" (anyone in the team) and "the `member` role" rarely conflict. When it matters, say "the `member` role". | level, user type |
| **Record owner** | The member responsible for a contact or company (D123), shown as **Contact owner** or **Company owner**. Always written with the record type, never bare "owner", which is a role. | assignee, account manager, rep, responsible |
| **Permission** | A capability the core checks, such as `records:write`. | right, privilege, capability, grant, access |
| **Scope** | A permission an API key is limited to. An API key's scopes are a ceiling on its owner's permissions. **Effective permissions** = role permissions ∩ scopes. | — (and "scope" means nothing else) |

## Architecture

| Term | Meaning | Banned synonyms |
| --- | --- | --- |
| **Entrypoint** | A way into the core: the web UI, the HTTP API, the MCP server, and one day the CLI. Entrypoints authenticate, decode input, call an operation, and encode the result. | door, adapter, interface, frontend, boundary, layer (for this meaning) |
| **Operation** | One action a principal can take, such as `contacts.update`. It is defined once in the **operation registry**, and every entrypoint is derived from it. | action, command, use case, handler, mutation |
| **Endpoint** | An HTTP API route derived from an operation. Used only when talking about HTTP. | route (for the API) |
| **Tool** | An MCP tool derived from an operation. Used only when talking about MCP. | function, command |
| **Service** | An Effect `Context.Service` in `@parley/core` that performs IO. Services demand proofs. | repository, repo, DAO, store, manager, provider |
| **Proof** | An opaque, frozen value recording a fact checked about specific named values, such as `CanWriteRecords<P, T>`. Minted only in `core/src/proofs/`. Its kind and fields can be read only while those named values remain usable; the fact itself can become stale during execution. | evidence, witness, token, guard, assertion |
| **Prover** | A function in `core/src/proofs/` that checks a fact and returns a proof, or fails with a typed error. | checker, guard, policy, authorizer |
| **Named value** | An opaque, frozen value given a type-level name by `named(...)`, so proofs can refer to that exact value. Its original value can be read only during the Effect execution that created it. | branded value (brands are a different thing) |
| **Tier** | How long something lives: **process** (built once), **team** (built per team) or **request**. | scope, lifetime, level |
| **Package** | A workspace package such as `@parley/core`. | module (for this meaning), lib |

## Errors

| Term | Meaning | Banned synonyms |
| --- | --- | --- |
| **Error** | An expected way an operation can go wrong, modeled as one `Schema.TaggedError` class that implements `DomainError`. | failure, exception, problem |
| **Error union** | The set of error classes one operation can produce, such as `UpdateContactError`. | failure union, error type (for the union) |
| **Defect** | A bug or an unexpected condition. It is never a `DomainError`, never shown in detail, and is logged in full. Its public tag is `InternalDefect`. | crash, panic, internal error, unknown error |
| **User message** | `userMessage`: the words people and agents read, written in our own words. | error text, display message, copy |
| **Log message** | `message`: words for operators, which may quote third-party text and ids. | debug message, details |
| **Reference id** | The id shown with a defect, which finds the full log entry. | error id, trace id, incident number |
| **Public error** | `PublicError`: the only shape an error takes when it leaves the core. | API error, wire error |

## UI

| Term | Meaning | Banned synonyms |
| --- | --- | --- |
| **Screen** | A routable place in the web UI. | page, route (in UI talk), view (alone) |
| **View type** | A reusable screen pattern: **index view**, **record view**, **panel**, **composer**, **settings**. Every screen is one of these. | layout, template (taken by email) |
| **Index view** | A view type that shows many records of one type. | collection, list view, table view, grid |
| **Record view** | A view type that shows one record. | detail page, profile |
| **Theme variable** | A named, semantic style value (`surface`, `text-muted`, `accent`, …) generated from the theme inputs (base, accent, contrast) and exposed to Tailwind. Components use only theme variables. | design token, token, CSS variable (for this meaning) |
| **Command menu** | The ⌘K menu that reaches every operation. | command palette, quick switcher, omnibar |
| **Shortcut** | A single key or key combination that triggers an operation. | hotkey, keybinding, accelerator |
| **Saved view** | A named combination of filters, sort and columns on an index view. Either personal or shared with the team. | view (alone), filter preset, smart list, list |
| **Filter** | A condition that narrows the records an index view shows. The same component builds v2 dynamic segments. | query, rule, condition (as a UI noun) |
| **Import** / **Export** | Moving records into or out of Parley as CSV. | upload, download, sync, migrate |
| **Selection** | The records an action on an index view applies to: the rows picked, or every record matching its search and filter (D137). | bulk selection, batch, checked rows |
| **Toast** | A brief, non-blocking message (e.g. "Contact deleted · Undo"). | snackbar, notification, flash |
| **Info tip** | A small (i) button beside a label that shows a short explanation on hover or click (D155). | tooltip (that's a one-line label on hover), help icon, hint (that's text shown under a field) |
| **Design asset** | The artifact we agree on before building a screen. | mockup, wireframe, concept, comp |

## Marketing email (v2)

| Term | Meaning | Banned synonyms |
| --- | --- | --- |
| **Segment** | A group of contacts that a broadcast is sent to. It comes in two kinds: a **dynamic segment** is defined by filters and its contacts change as records change; a **fixed segment** is a hand-picked set of contacts. It matches Resend's current term (Resend replaced "Audiences" with "Segments" in Nov 2025). | audience, list, group, cohort, contact set |

| **Form** | A form a team designs in Parley and embeds on its websites, such as a newsletter or a waitlist (D144). | widget, embed (as a noun), sign-up form, sign-up widget, landing form |
| **Submission** | One visitor's answers to a form, with its consent record. It becomes a contact once confirmed (D146). | entry, response, lead (as a noun for the record) |
| **Appearance** | How a form looks: its colors (fixed, or light and dark), font, sizes, corners, spacing, label position and allowed style rules (D148). | theme (alone), skin, custom CSS |
| **Tracking parameters** | What a submission records about where a visitor came from: its UTM parameters and, when the embedding site opts in, click IDs (D153, D154). Shown to people as "Came from". | attribution (that means who made a change), source (alone), referral data |
| **Click ID** | An ad network's identifier for one ad click, passed in the page's address (`gclid`, `fbclid`, `msclkid`…). | click identifier, ad ID |
| **Submission statuses** | **Waiting** (sent, not yet confirmed), **confirmed**, **expired** (not confirmed within the confirmation link's 7 days) and **spam** (D146, D147). | pending, unconfirmed, sign-up (any meaning), lead |
| **Double opt-in** | A form's setting that a submission reaches contacts only once the visitor clicks the confirmation link (D146). | confirmed opt-in, verification, email verification |
| **Confirmation link** | The link in the email double opt-in sends, which confirms a submission. | verify link, activation link, magic link |
| **Consent box** | A checkbox on a form that joins one topic when ticked, never ticked to start (D149). | opt-in checkbox, marketing checkbox, permission box |
| **Consent record** | What a submission keeps as proof of consent: the form version and wording shown, which consent boxes were ticked, when and from where it was sent and confirmed (D150). | audit log, consent log, proof (alone) |
| **Kept value** | An answer a submission didn't write because the contact already had a different one; shown in the contact's activity with Apply (D145). | conflict, rejected value, pending change |
| **Spam list** | The submissions held as spam, each with its reason, kept 30 days and releasable (D147). | quarantine, junk, blocked list |
| **Render token** | The signed value a form's page gets when it loads, which a submission must carry (D147). | form token, nonce (alone), CSRF token |
| **Opt-in topic** / **Opt-out topic** | A topic's **mode** (D149): an opt-in topic reaches only contacts who joined it; an opt-out topic reaches every subscribed contact who hasn't left it. | double-opt-in topic, list type |
| **Subscriber** | A contact who joined an opt-in topic, through a form or by hand (D149). "Ada is a subscriber to Launch news." Code: `topicSubscribers`, `subscriberCount`. | member (that's a team's), joiner, follower |
| **Hosted page** | A form on its own page at Parley (`/f/<form id>`), for linking from posts and emails. | hosted link, landing page, form link |
| **Embed snippet** | The script tag that puts a form on a site. | embed code, widget code, script (alone) |
| **Fine print** | The line under a form's button, followed by the team's privacy policy link. | small print, disclaimer, footer (that's a broadcast's) |
| **Form settings** | A team's settings for every form: its captcha, disposable email blocking and privacy policy link (Settings → Forms). | protection settings, form config |
| **Broadcast** | One marketing email sent to a segment at once: its subject, content, segment and topic, and, once sent, its recipients and results (D140). | campaign (reserved: in marketing it means something broader), blast, newsletter (as a noun for the thing sent), mailing, send |
| **Draft** | A broadcast that hasn't been sent. A status of a broadcast, not a separate thing. | unsent broadcast, pending broadcast |
| **Template** | Reusable content (subject and body) that a new broadcast starts from. The broadcast takes a copy; editing the template later doesn't change it. | layout, design (for email content), theme |
| **Email style** | A reusable look for emails: logo and header, colors, font, footer alignment, plain or card, or custom HTML (D116, D121). A team has a default; templates and broadcasts can use another. Not a template, which is content. | layout, brand, theme, letterhead, email design |
| **Preview text** | The line inbox apps show after a broadcast's subject. | preheader, snippet, teaser |
| **Merge tag** | A placeholder in a subject or body, like `{{first_name}}`, filled in per recipient. | variable, placeholder, token, personalization tag |
| **Test send** | Sending a draft to members of the team (not contacts) to check it. | preview email, proof, test email |
| **Recipient** | A contact a broadcast was sent, or is being sent, to. | subscriber (that's an opt-in topic's), target |
| **Topic** | A kind of marketing email a team sends (for example "Product updates"). A broadcast can have one; a contact can unsubscribe from a single topic. Kept by Parley, not Resend. | category, list, channel, preference |
| **Subscription status** | Whether a contact receives marketing email: subscribed, unsubscribed, bounced or marked as spam. | opt-in status, consent status, email status |
| **Unsubscribe** | A contact choosing to stop getting marketing email, from one topic or all of them, through the unsubscribe link. | opt out (as a verb), remove me |
| **Unsubscribe link** | The link in every broadcast email (and its List-Unsubscribe header) that unsubscribes the recipient. | opt-out link, manage preferences link |
| **Footer** | What Parley adds to the end of every broadcast email: the sender's legal name and postal address, the unsubscribe link and, when the broadcast has a topic, a line naming it. Required by anti-spam law. | signature, compliance block, legal text |
| **Sender** | Who an email from the team is from: a name and an address on a sending domain, a reply-to, and the legal name and postal address its footer shows. A team has one or more; each broadcast and form picks one (D162). | from, sender identity, mailbox, brand |
| **Default sender** | The sender new broadcasts and forms start with, and the one that takes over when a sender is deleted (D162). | primary sender, main sender |
| **Sending domain** | A domain the team has verified with DNS records so Parley can send email from it. Not a company's domain. | email domain (here), verified domain, DKIM domain |

## Changelog

| Date | Change |
| --- | --- |
| 2026-10-19 | Created. Tenant is **team** (was "org"), the credential is **API key** (was "token"), the non-human identity is **service account** (was "agent principal"), the relation is **membership**, the entrypoint is **entrypoint** (was "door"/"adapter"), and lifetimes are **tiers** (was "scope tiers"). |
| 2026-10-19 | **Member** replaces "membership". The `member` role is understood as the default role, so the overlap is low-risk (owner's call). |
| 2026-10-19 | **Segment** (dynamic or fixed) is the term for a group of contacts a broadcast is sent to (owner's call). |
| 2026-10-19 | Added affiliation, field, custom field, primary email, display name, delete, restore and purge (schema decisions D24–D34). **Affiliation** is Claude's pick, open to veto. |
| 2026-10-19 | Added record type, reference id, command menu and shortcut. |
| 2026-10-19 | Added saved view, filter, import/export and toast. |
| 2026-10-19 | Added note, avatar and logo. |
| 2026-10-20 | Added **connection** (D95). |
| 2026-10-20 | Added **CRT mode** (D102). |
| 2026-10-20 | Added **invitation**. |
| 2026-10-20 | Added **CRT settings** and **phosphor** (D114). |
| 2026-10-20 | Added **email style** (D116). |
| 2026-10-21 | Added **record owner** (D123). |
| 2026-10-21 | Added **social profile** (D133). |
| 2026-10-21 | Added **import** (D135). |
| 2026-10-20 | Added **domain**, **free email domain** and **domain matching** (D105, D106). |
| 2026-10-20 | Added the v2 email terms: broadcast, draft, template, merge tag, test send, recipient, topic, subscription status, unsubscribe, unsubscribe link, footer, sender and sending domain. Claude's picks, open to veto (see `docs/review.md`). Later: **preview text**. |
| 2026-10-20 | Added **access token**, and removed it from API key's banned synonyms (P5, D97). |
| 2026-10-21 | Added **selection** (D137). |
| 2026-10-21 | **Broadcast** replaces **campaign** for one marketing email (D140); "campaign" is now banned for it. |
| 2026-10-24 | Added **form**, **submission** and **appearance** (D144, D148). |
| 2026-10-24 | American spelling throughout (D151). |
| 2026-10-24 | Added **tracking parameters** and **click ID** (D153, D154). |
| 2026-10-24 | Added **info tip** (D155). |
| 2026-10-25 | Added the form terms the review found missing: submission statuses, double opt-in, confirmation link, consent box, consent record, kept value, spam list, render token, opt-in and opt-out topics, hosted page, embed snippet, fine print, form settings. "Sign-up" is banned in every meaning (owner's call). Appearance no longer says "design tokens". |
| 2026-10-26 | **Subscriber** replaces topic "member", which clashed with **Member** (owner's call). The API's `memberCount` is now `subscriberCount`. |
