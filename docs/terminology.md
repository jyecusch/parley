# Terminology

**One name for everything. Synonyms are banned.**

Every concept in Parley has exactly one name. It is used in code, docs, UI copy, user messages, commit messages and conversation. If a word isn't here and you need it, add it here first, in the same change. If two words seem to mean the same thing, one of them is wrong.

How to pick a name: choose the most common name for the concept. Reject anything vague, or anything that overlaps with another term here, with a concept our users already have (a CRM user thinks "organization" means a customer), or with a term from our stack (Effect, TanStack, Better-Auth, MCP).

**Third-party names stay third-party.** Better-Auth's `organization`, Effect's `Scope`, TanStack DB's `collection` and MCP's `tool` are used *only* when talking about that library's API, never as Parley concepts.

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
| **Primary email** | The one email address of a contact that's marked primary. Campaigns are sent to it. | main email, default email |
| **Display name** | The name shown for a record: a contact's first and last name (falling back to the primary email), or a company's name. Becomes a `DisplayName` value in user messages. | label, title (title is an affiliation's job title) |
| **Delete** | Hide a record immediately. It can be restored for 30 days, then it's purged. | archive, trash, remove, soft-delete (as a separate word) |
| **Restore** | Bring back a deleted record within 30 days. | undelete, recover, unarchive |
| **Purge** | Permanently remove a deleted record after 30 days. Can't be undone. | hard delete, destroy, wipe |
| **Note** | Free-form text a principal adds to a record's activity, with an author and a time. | comment, memo, annotation |
| **Avatar** | A contact's image: uploaded, else Gravatar (if the team enables it), else initials. | photo, profile picture, picture |
| **Logo** | A company's image: uploaded, else the favicon from its primary domain, else initials. | icon, favicon (except the fetched source), brand image |
| **Activity** | The history of changes to a record, as shown in the UI, including who made each change (for example "Jane via Claude"). | audit log, history, timeline, events |

## Identity and access

| Term | Meaning | Banned synonyms |
| --- | --- | --- |
| **User** | A human who can sign in to Parley. | person, human, account |
| **Service account** | A non-human identity that is a member of one team, with its own role, for example "Support Bot". Stored as a Better-Auth user with `kind: "service-account"`, and it can never sign in with a password. | bot, agent principal, machine user, integration |
| **Agent** | External AI software (Claude, ChatGPT, opencode, …) that calls Parley through the MCP server or the HTTP API. An agent is never a principal: it authenticates with an API key that belongs to a user or a service account. | assistant, AI, bot |
| **Session** | A user's sign-in to the web app (a Better-Auth session cookie). | login, auth cookie |
| **API key** | A secret credential used by an agent or script. It belongs to either a user (it acts as that user, is limited by its scopes, and is bound to one team) or a service account. | token, PAT, secret, credential (as a noun for this) |
| **CRT mode** | The optional amber old-monitor look (D81, D102), drawn by a WebGL shader where the browser can, otherwise by the CSS layer. Its tunable parts are **curvature** and **chromatic aberration**. | retro mode, terminal theme, CRT filter |
| **Access token** | The short-lived OAuth token an agent gets for a connection and sends to `/mcp`. It names the connection and nothing else. In UI copy, say "the agent's sign-in". | token (alone), bearer, JWT (outside code about its format) |
| **Connection** | An agent someone authorized over OAuth (MCP sign-in), bound to one team, acting as that person or as a service account, limited to its scopes. Listed and revoked in Settings. | grant, authorization, integration, connected app, OAuth app |
| **Principal** | The authenticated identity making a request, and the output of authentication. Exactly one of `UserSession`, `UserApiKey`, `ServiceAccountApiKey`. | actor, caller, requester, subject, identity |
| **Member** | A user or service account that belongs to a team, with exactly one role. Stored in Better-Auth's `member` table. "Jane is a member of Acme." | membership, seat, team member, teammate |
| **Role** | `owner`, `admin` or `member`, held by each member. The role named `member` is the default role, so "a member" (anyone in the team) and "the `member` role" rarely conflict. When it matters, say "the `member` role". | level, user type |
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
| **Proof** | A compile-time value showing that a fact was checked about specific named values, such as `CanWriteRecords<P, T>`. Minted only in `core/src/proofs/`. | evidence, witness, token, guard, assertion |
| **Prover** | A function in `core/src/proofs/` that checks a fact and returns a proof, or fails with a typed error. | checker, guard, policy, authorizer |
| **Named value** | A value given a compile-time-only name by `named(...)`, so proofs can refer to that exact value. | branded value (brands are a different thing) |
| **Tier** | How long something lives: **process** (built once), **team** (built per team) or **request**. | scope, lifetime, level |
| **Package** | A workspace package such as `@parley/core`. | module (for this meaning), lib |

## Errors

| Term | Meaning | Banned synonyms |
| --- | --- | --- |
| **Error** | An expected way an operation can go wrong, modelled as one `Schema.TaggedError` class that implements `DomainError`. | failure, exception, problem |
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
| **Index view** | A view type that shows many records of one type. | collection (TanStack DB term), list view, table view, grid |
| **Record view** | A view type that shows one record. | detail page, profile |
| **Theme variable** | A named, semantic style value (`surface`, `text-muted`, `accent`, …) generated from the theme inputs (base, accent, contrast) and exposed to Tailwind. Components use only theme variables. | design token, token, CSS variable (for this meaning) |
| **Command menu** | The ⌘K menu that reaches every operation. | command palette, quick switcher, omnibar |
| **Shortcut** | A single key or key combination that triggers an operation. | hotkey, keybinding, accelerator |
| **Saved view** | A named combination of filters, sort and columns on an index view. Either personal or shared with the team. | view (alone), filter preset, smart list, list |
| **Filter** | A condition that narrows the records an index view shows. The same component builds v2 dynamic segments. | query, rule, condition (as a UI noun) |
| **Import** / **Export** | Moving records into or out of Parley as CSV. | upload, download, sync, migrate |
| **Toast** | A brief, non-blocking message (e.g. "Contact deleted · Undo"). | snackbar, notification, flash |
| **Design asset** | The artifact we agree on before building a screen. | mockup, wireframe, concept, comp |

## Marketing email (v2)

| Term | Meaning | Banned synonyms |
| --- | --- | --- |
| **Segment** | A group of contacts that a campaign is sent to. It comes in two kinds: a **dynamic segment** is defined by filters and its contacts change as records change; a **fixed segment** is a hand-picked set of contacts. It matches Resend's current term (Resend replaced "Audiences" with "Segments" in Nov 2025). | audience, list, group, cohort, contact set |

Still to define before v2 design begins (reserved, so nothing in v1 takes them): campaign, template, draft, test send, unsubscribe, subscription status, sending domain, footer. Note that Resend's **Topics** (recipients opt out of specific kinds of email) overlap with our subscription management. Decide how they map when we define those terms.

## Changelog

| Date | Change |
| --- | --- |
| 2026-10-19 | Created. Tenant is **team** (was "org"), the credential is **API key** (was "token"), the non-human identity is **service account** (was "agent principal"), the relation is **membership**, the entrypoint is **entrypoint** (was "door"/"adapter"), and lifetimes are **tiers** (was "scope tiers"). |
| 2026-10-19 | **Member** replaces "membership". The `member` role is understood as the default role, so the overlap is low-risk (owner's call). |
| 2026-10-19 | **Segment** (dynamic or fixed) is the term for a group of contacts a campaign is sent to (owner's call). |
| 2026-10-19 | Added affiliation, field, custom field, primary email, display name, delete, restore and purge (schema decisions D24–D34). **Affiliation** is Claude's pick, open to veto. |
| 2026-10-19 | Added record type, reference id, command menu and shortcut. |
| 2026-10-19 | Added saved view, filter, import/export and toast. |
| 2026-10-19 | Added note, avatar and logo. |
| 2026-10-20 | Added **connection** (D95). |
| 2026-10-20 | Added **CRT mode** (D102). |
| 2026-10-20 | Added **domain**, **free email domain** and **domain matching** (D105, D106). |
| 2026-10-20 | Added **access token**, and removed it from API key's banned synonyms (P5, D97). |
