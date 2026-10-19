# Decisions log

What we decided, who decided it, and what's still open. Nothing becomes "decided" without the project owner's say-so. Claude proposes and the owner decides.

## Decided

| # | Decision | Choice | Decided by | Date |
| --- | --- | --- | --- | --- |
| D1 | Product scope v1 | Contacts and companies | Owner | 2026-10-19 |
| D2 | Product scope v2 | Marketing email: filter-based dynamic segments, fixed lists, templates, drafts, test sends to CRM users, subscription management, compliant unsubscribe footer (Spam Act etc.) | Owner | 2026-10-19 |
| D3 | Agent parity | Everything a user can do in the web UI, an agent can do via API/MCP | Owner | 2026-10-19 |
| D4 | Tech stack | TanStack Start, Postgres, Effect v4 (backend at least), TanStack DB/Query, Better-Auth + organizations plugin, Drizzle, Tailwind | Owner | 2026-10-19 |
| D5 | Tenancy | Multi-team: a user can be a member of many teams and switch between them | Owner | 2026-10-19 |
| D6 | Record visibility | Team-wide visibility. Roles decide actions | Owner | 2026-10-19 |
| D7 | Roles | Better-Auth defaults: `owner`, `admin`, `member` | Owner | 2026-10-19 |
| D8 | Agent identity | Both: a user's API key (acts as that user, limited by scopes) **and** service accounts that are members in their own right. Agents are external software using either kind of API key | Owner | 2026-10-19 |
| D9 | Repo layout | Monorepo of Bun workspace packages with hard package boundaries | Owner | 2026-10-19 |
| D10 | Authz mechanism | Effect-native "ghosts of departed proofs" module of our own (not the `@gdp-ts/core` library) | Owner | 2026-10-19 |
| D11 | Lint and enforcement | Biome + GritQL rules, plus `@effect/language-service` diagnostics | Owner | 2026-10-19 |
| D12 | Error model | One `Schema.TaggedError` per error (highly granular), `PublicError` as the only way an error leaves the core | Owner (mandated) | 2026-10-19 |
| D13 | Web entrypoint | The web UI is a client of the same Effect `HttpApi` (`/api/v1`) that agents use. The MCP server is a separate thin entrypoint over core operations | Delegated to Claude ("go with your recommendation") | 2026-10-19 |
| D14 | UX process | Before each screen: discuss → design asset → agree → implement | Owner | 2026-10-19 |
| D15 | Email provider | Resend is the default email provider | Owner | 2026-10-19 |
| D16 | Operation registry (was P1) | Each operation is defined once. HTTP endpoints and MCP tools are derived from it, so parity holds by construction | Owner | 2026-10-19 |
| D17 | Better-Auth organization endpoints (was Q-A3) | Its client-facing organization mutation endpoints are disabled. Member and team changes are Parley operations that prove `CanManageMembers` and then call `auth.api.*` server-side | Owner | 2026-10-19 |
| D18 | Service accounts (was Q-A1) | Stored as Better-Auth users with `kind: "service-account"` and a normal member row. Password sign-in is blocked for them | Owner | 2026-10-19 |
| D19 | User API keys (was Q-A4) | A user's API key is bound to one team. Use elsewhere fails with `ApiKeyNotValidForTeam` | Owner | 2026-10-19 |
| D20 | Terminology | One name per concept, synonyms banned. `docs/terminology.md` is canonical; the rule lives in `AGENTS.md` | Owner | 2026-10-19 |
| D21 | Tenant name | The tenant is a **team** (stored as a Better-Auth organization) | Owner | 2026-10-19 |
| D22 | Member term | "Member" (not "membership") means anyone in a team; the `member` role is the default role | Owner | 2026-10-19 |
| D23 | Segment | A group of contacts a campaign is sent to is a **segment**, either dynamic (defined by filters) or fixed (hand-picked). This matches Resend | Owner | 2026-10-19 |
| D24 | Contact emails (was Q-E1) | Many per contact, one marked primary. Each address is unique within a team | Owner | 2026-10-19 |
| D25 | Company domains (was Q-E1) | Many per company, unique within a team | Owner | 2026-10-19 |
| D26 | Invalid input (was Q-E2) | One `InputRejected` error listing every field problem: fixed problem vocabulary, our own wording, never echoes the rejected value. HTTP 422 | Owner | 2026-10-19 |
| D27 | Permission implication (was Q-A5) | None. Every permission is explicit (delete doesn't imply write, write doesn't imply read) | Owner | 2026-10-19 |
| D28 | Row-level security (was Q-A7) | Later. v1 relies on proofs plus composite foreign keys `(team_id, id)`; every tenant table has `team_id` so RLS can be added without pain | Owner | 2026-10-19 |
| D29 | Contacts and companies | Many-to-many, through an affiliation that can carry a title | Owner | 2026-10-19 |
| D30 | Deletion | Soft delete: hidden immediately, restorable for 30 days, then purged. Unique emails and domains are released at deletion | Owner | 2026-10-19 |
| D31 | Custom fields | In v1, on contacts and companies. Types: text, number, date, checkbox, single select, multi select, URL, email, phone. No reference-to-record type | Owner | 2026-10-19 |
| D32 | Custom field administration | New permission `fields:manage`, held by owner and admin | Owner | 2026-10-19 |
| D33 | Contact name | Optional first name and last name. The display name is derived from them, falling back to the primary email | Owner | 2026-10-19 |
| D34 | Phone numbers | Many per contact, each labelled (work, mobile, …), stored in E.164 format, not unique | Owner | 2026-10-19 |
| D35 | Team existence (was Q-A2) | An unknown team and "not a member" give the identical error, `NotATeamMember` (404). No existence oracle | Owner | 2026-10-19 |
| D36 | Authz races (was Q-A6) | Role changes, member removal and team deletion re-read the member row `FOR UPDATE` in the write transaction and enforce "at least one owner" there | Owner | 2026-10-19 |
| D37 | Cross-team lookups (was Q-A8) | A record from another team is always `ContactNotFound`/`CompanyNotFound`, even for someone who is a member of both teams | Owner | 2026-10-19 |
| D38 | Echoing input (was Q-E3) | User messages may repeat a value from the current request, only through an `EchoedInput` brand, length-capped | Owner | 2026-10-19 |
| D39 | Team as argument (was Q-T1) | Services are process-tier and receive the team as a named, proven argument. Team-tier services need explicit approval | Owner | 2026-10-19 |
| D40 | Tier check (was Q-T2) | Type-level tier check from day one, plus lint rules (no module-level mutable state in services, no proofs stored in Refs/Layers) | Owner | 2026-10-19 |
| D41 | Untiered services (was Q-T3) | Third-party services without a tier marker are allowed anywhere, treated as process-tier | Owner | 2026-10-19 |
| D42 | Team-keyed caches (was Q-T4) | A review-checklist item, not a lint rule | Owner | 2026-10-19 |
| D43 | Re-affiliating (was Q-E4) | Idempotent: affiliating an already-affiliated contact and company returns the existing affiliation (updating the title if one is given) | Owner | 2026-10-19 |
| D44 | Error context (was Q-E5) | `PublicError` has a fixed shape plus an optional `details` object whose schema is declared per tag (and published in OpenAPI) | Owner | 2026-10-19 |
| D45 | Saved errors (was Q-E6) | Store the tag plus context fields, and render the user message when it's read | Owner | 2026-10-19 |
| D46 | Defects (was Q-E7) | A fixed message plus a reference id that finds the full log entry. Self-hosted: the instance operator is who you contact | Owner | 2026-10-19 |
| D47 | Rate limiting (was Q-E9) | In v1, a generous per-API-key limit: `RequestsTooFrequent` with `retryAfterMillis` | Owner | 2026-10-19 |
| D48 | Unsaved edits (was Q-E10) | v1 requirement: unsaved edits survive a failed save and a re-sign-in | Owner | 2026-10-19 |
| D49 | Telemetry (was Q-E11) | Opt-in OpenTelemetry, off by default, no phone-home. Our hosted instance reviews error frequency 30 days after each launch | Owner | 2026-10-19 |
| D50 | Mailer (was Q-T6, P4) | A pluggable process-tier `Mailer` service, with Resend as the default implementation | Owner | 2026-10-19 |
| D51 | Themes (was Q-U1/U2) | Light and dark (follow the OS, with a manual override), generated from base/accent/contrast in OKLCH. No theme picker in v1 | Owner | 2026-10-19 |
| D52 | Density (was Q-U4) | One dense default. No toggle | Owner | 2026-10-19 |
| D53 | Keyboard (was Q-U5/U6) | A command menu (⌘K) in v1 that reaches every operation. Single-key shortcuts, disabled while typing | Owner | 2026-10-19 |
| D54 | Index views (was Q-U7) | A table by default, with custom fields as columns and inline editing | Owner | 2026-10-19 |
| D55 | Opening records (was Q-U8) | A side panel from an index view (J/K moves between records), expandable to the full record view at its own URL | Owner | 2026-10-19 |
| D56 | Platforms (was Q-U9/U10) | Desktop web first. Usable at 390px, but not specially designed for mobile. No desktop app | Owner | 2026-10-19 |
| D57 | Design assets (was Q-U11) | Error, empty and loading states are mandatory in every design asset | Owner | 2026-10-19 |
| D58 | Sidebar layout | Team switcher at the top, user menu at the bottom. "Search ⌘K" opens the command menu. Record types (Contacts, Companies) with their saved views, and Settings | Owner | 2026-10-19 |
| D59 | Saved views | In v1, listed under their record type in the sidebar. They share the filter component that v2 dynamic segments reuse | Owner | 2026-10-19 |
| D60 | Saved view visibility | Personal or shared with the team. Any member with `records:write` can create and edit shared views | Owner | 2026-10-19 |
| D61 | Search | The command menu only: it searches records and operations together. No separate search screen. Index views have their own filters | Owner | 2026-10-19 |
| D62 | Import and export | CSV import and export of contacts and companies in v1, both as operations. Import maps columns to fields, including custom fields, and reports `InputRejected` per row. Export follows the current filters | Owner | 2026-10-19 |
| D63 | Activity | Per record only in v1 (in the record view). No team-wide activity screen | Owner | 2026-10-19 |
| D64 | Sidebar collapse | Collapses to an icon rail (⌘\\). The state is remembered per browser | Owner | 2026-10-19 |
| D65 | Index view header | Two rows. Row 1: title or saved view name, record count, primary action. Row 2: filters plus Display (columns, sort). Unsaved changes show Save view / Reset | Owner | 2026-10-19 |
| D66 | Deleted records | A "Deleted" option in an index view's Display menu shows deleted records with a Restore action. An undo toast appears right after a delete | Owner | 2026-10-19 |
| D67 | Restoring a live record | Idempotent: returns the live record | Owner | 2026-10-19 |
| D68 | Custom field names | Unique per record type, case-insensitive, and not allowed to clash with built-in field names (`CustomFieldNameTaken`) | Owner | 2026-10-19 |
| D69 | Contacts table default columns | Avatar, name + primary email, companies (affiliations as chips), created, updated | Owner | 2026-10-19 |
| D70 | Inline editing | Click selects a cell, Enter or double-click edits it, arrow keys move between cells. Saved optimistically on Enter or blur, Esc cancels. Clicking the name opens the panel | Owner | 2026-10-19 |
| D71 | Bulk actions | On selected rows: delete (undo toast), set a field, affiliate with a company, export selected | Owner | 2026-10-19 |
| D72 | Creating a contact | "New contact" (or C) opens the panel in create mode, with focus on first name. It stays open on the new record after saving | Owner | 2026-10-19 |
| D73 | Record panel | Header (avatar, display name, affiliations, quick actions), then built-in fields, then custom fields (all editable inline), then activity | Owner | 2026-10-19 |
| D74 | Notes | Entries in a record's activity, each with an author and a time, and editable/deletable. Adding a note is an operation, so agents can leave notes | Owner | 2026-10-19 |
| D75 | Avatars and logos | An uploaded image, else a third-party source, else coloured initials. Contacts: Gravatar for the primary email. Companies: the favicon from the primary domain, fetched by our server through SSRF-safe egress and stored | Owner | 2026-10-19 |
| D76 | File storage | A process-tier `FileStore` service speaking the S3 API (S3, R2, MinIO, …). Images are resized and re-encoded server-side, never served raw | Owner | 2026-10-19 |
| D77 | Gravatar | A team setting, off by default | Owner | 2026-10-19 |
| D78 | "via" attribution | Activity shows the API key's name, which the user chooses: "Jane via Claude on my laptop" | Owner | 2026-10-19 |
| D79 | Typeface (was Q-U3) | Host Grotesk for the UI, DM Mono for monospace. Visual direction: "Ink" (monochrome, dark and light) | Owner | 2026-10-19 |
| D80 | Design asset: app shell + Contacts | Approved after critique rounds. Source in `docs/design/app-shell-contacts/` (canvas: https://claude.ai/artifact/2EA4QXAWWcPa5j4cipBaFS) | Owner | 2026-10-19 |
| D81 | CRT appearance mode | Experimental, opt-in, never the default. Amber phosphor, DM Mono, scanlines, aperture mask, flicker, vignette and glow, with no rolling band. CSS layer everywhere. Later, a progressive WebGL shader via HTML-in-Canvas where supported | Owner | 2026-10-19 |
| D82 | Drizzle + Effect | Drizzle defines the schema, migrations and type-safe queries. Queries execute through Effect's `@effect/sql-pg` SqlClient (pool, transactions, spans), using a small Drizzle→SQL adapter | Owner | 2026-10-19 |
| D83 | MCP implementation | Effect's `McpServer` (`effect/unstable/ai`), with tools derived from the operation registry | Owner | 2026-10-19 |
| D84 | Milestone 1 | Foundation (monorepo, lint, errors, proofs, DB, auth with teams) plus an end-to-end contacts slice through the operation registry to the HTTP API, MCP and web | Owner | 2026-10-19 |
| D85 | Milestone 2 | API keys and agent onboarding first: operations to create, list and revoke API keys, plus a Settings → API keys screen with ready-to-paste agent configuration | Owner | 2026-10-20 |
| D86 | Note permissions | The author can edit or delete their note; admins and owners can delete any note | Owner | 2026-10-20 |
| D87 | API key defaults | Scopes default to `records:read` (write and delete opt-in), no expiry by default (optionally 30/90/365 days), and the secret is shown once | Owner | 2026-10-20 |
| D88 | Company fields | Name, domains (many, unique per team), website, phone and postal address. Everything else is a custom field | Owner | 2026-10-20 |
| D89 | MCP OAuth | In milestone 2, using `@better-auth/mcp` (an OAuth 2.1 authorization server with client metadata documents and dynamic registration), with Parley's own sign-in and consent pages | Owner | 2026-10-20 |
| D90 | Settings layout | Entering Settings swaps the app sidebar for a settings sidebar with a back arrow (team sections and "You" sections) | Owner | 2026-10-20 |
| D91 | How agents connect | Agents connect over MCP OAuth: you sign in and choose who the agent acts as. API keys are mainly for the HTTP API | Owner | 2026-10-20 |
| D92 | Consent | A connection is bound to one team, acts as you or as a service account, and has scopes that default to read-only (write and delete opt-in) | Owner | 2026-10-20 |
| D93 | MCP authentication | MCP accepts both OAuth connections and API keys (for headless or CI agents) | Owner | 2026-10-20 |
| D94 | Service accounts | Creating one needs `service-accounts:manage` (admin, owner). Any member may connect an agent as an existing service account, limited to the lower of the service account's role and their own, intersected with the connection's scopes | Owner | 2026-10-20 |
| D95 | Term | "Connection": an agent someone authorized over OAuth. Listed and revoked in Settings | Owner | 2026-10-20 |
| D96 | Key and connection activity | Show "last used", and changes are attributed in record activity ("via …"). No separate per-key log yet | Owner | 2026-10-20 |
| D97 | Settings and consent design | Approved as drawn on the canvas, with one change: copy is an icon button inside the field, not a separate "Copy" button | Owner | 2026-10-20 |
| D98 | `records:read` | Always on for API keys and connections; it can't be unticked, so nothing is ever created that can do nothing | Owner (approved with D97) | 2026-10-20 |
| D99 | API key scopes for admins | The dialog offers `records:*` to everyone and `fields:manage` to admins and owners only; manage scopes for members and service accounts stay off API keys for now | Owner (approved with D97) | 2026-10-20 |
| D100 | Consent defaults | Admins default to "New service account…" (created as a member when they allow), members default to "You" | Owner (approved with D97) | 2026-10-20 |
| D101 | Settings sidebar | General and Members are shown, disabled and marked "Later", until they're built. Rename, change role and delete for service accounts come later | Owner (approved with D97) | 2026-10-20 |
| D102 | CRT glass | The shader adds convex glass (barrel curvature with a curved bezel and a soft reflection) and chromatic aberration towards the edges. Both are tunable per browser in localStorage: `parley.crt.curvature` 0–1 (default 0.5) and `parley.crt.aberration` 0–4 px (default 1). With a mouse, the shader also draws the cursor (arrow, hand or text beam) so it bends with the glass, and the system cursor is hidden. Hit-testing follows the bend under the pointer (by shifting the app's CSS transform, which moves hit-testing but not the drawing), so clicks land on what's drawn | Owner | 2026-10-20 |
| D103 | Milestone 3 | Companies and affiliations: company records, linking contacts and companies, a Companies screen, and affiliations on contacts | Owner | 2026-10-20 |
| D104 | Company address | Structured: two street lines, city, region, postcode and country (ISO 3166-1 alpha-2 code) | Owner | 2026-10-20 |
| D105 | Domain matching | Parley affiliates contacts with companies by email domain on its own, both ways: a contact that gets an email (create, edit, import) is affiliated with the company that has that domain, and a company that gets a domain is affiliated with existing contacts that have it | Owner | 2026-10-20 |
| D106 | Free email domains | A built-in list of free email domains (gmail.com, outlook.com, icloud.com…) can never be a company domain, so they never match | Owner | 2026-10-20 |
| D107 | Removed affiliations | Domain matching runs only when an email or domain is added. Removing an affiliation is never undone by Parley | Owner | 2026-10-20 |
| D108 | Companies table default columns | Logo and name with the primary domain under it, number of affiliated contacts, created, updated | Owner | 2026-10-20 |
| D109 | Deleting a company | Its affiliations are hidden while it's deleted and come back if it's restored; they're purged with it after 30 days | Owner | 2026-10-20 |
| D110 | Companies design | Approved as drawn on the canvas (Milestone 3 row): Companies table and panel, new company with domain validation, affiliations in the contact panel, companies column in the contacts table | Owner | 2026-10-20 |
| D111 | Domain matching credit | Credited to whoever made the change that triggered it, naming the domain: "Jane Doe via Claude added Sam to Acme by domain matching on acme.com" | Owner | 2026-10-20 |
| D112 | Removing an affiliation | Immediate, with an undo toast; no confirmation | Owner | 2026-10-20 |
| D113 | Affiliation chips in the contacts table | Company only, title in the chip's tooltip; up to two chips, then "+N" | Owner | 2026-10-20 |

## Implementation choices made during milestones 1 and 2 (Claude; low-stakes, open to veto)

| # | Choice | Why |
| --- | --- | --- |
| I1 | TypeScript 6.0, not 7 | `@effect/language-service` (our Effect diagnostics) supports up to TS 6; TS 7 needs a separate tool (`@effect/tsgo`) |
| I2 | Local Postgres on port 5433 | 5432 was already taken by another container on the dev machine |
| I3 | REST-style paths (`/api/v1/teams/:teamId/contacts/:contactId`) | Conventional for OpenAPI consumers; each operation declares its method and path, and the path parameters come from its input |
| I4 | The web client is derived from the operation contracts (`apps/web/src/lib/client.ts`), not `HttpApiClient` | The HttpApi is built from the registry at runtime, so its static types are loose; the contracts carry exact input, output and error types |
| I5 | New operation `teams.create`, with error `SignInRequired` (403, also used for API key creation) | D17 disabled Better-Auth's own team creation, so new users had no way to create a first team |
| I6 | New sanctioned `userText` brand `FieldLabel` | Input errors need field labels, which come from title annotations we write on our own schemas |
| I7 | MCP authenticates in an HTTP middleware and provides a request-tier `CurrentPrincipal` | Effect's McpServer hides HTTP headers from tool handlers by design |
| I8 | Signed-in screens render on the client (`ssr: false`) | Keeps cookies and auth out of server rendering for now; revisit if first paint matters |
| I9 | API key scopes are stored as Better-Auth permissions; a key with none can do nothing | Deny by default |
| I10 | OAuth scopes are only `openid profile email offline_access`. What an agent may do is the connection's scopes, chosen on Parley's consent page and stored in `connections` | Agents request whatever scopes servers advertise; the real choice (team, acts as, scopes) needs our own page anyway |
| I11 | The consent page calls `connections.create` (records a pending connection tied to the sign-in session), then Better-Auth's `/oauth2/consent`. A hook refuses consent unless a pending connection for that session and agent exists; its id becomes the consent's reference and the only Parley claim in the access token (`connection_id`) | Tokens carry no permissions, so revoking a connection or changing a role takes effect on the next request |
| I12 | Access tokens are verified in-process (JWKS read from Better-Auth, cached, refetched on an unknown key) and must match the connection's agent and person. Only `/mcp` accepts them; the HTTP API answers `AccessTokenUnrecognized` | Tokens are audience-bound to `/mcp` (RFC 8707) |
| I13 | `/mcp` without credentials answers 401 with `WWW-Authenticate: Bearer resource_metadata=…`, and `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server/api/auth` are served at the site root | MCP clients discover sign-in this way |
| I14 | Dynamic client registration is open (no client ID metadata documents yet) | What Claude, ChatGPT and Cursor use today; `@better-auth/cimd` can be added later |
| I15 | Service accounts are users of kind `service-account` (no password, an undeliverable email) plus a member row; a connection acting as one also needs the connecting person to still be a member | D18, D94 |

## What's built, and what's next

Milestone 1: the monorepo; `@parley/errors`, `domain`, `db`, `core`, `api`, `http` and `mcp`; Better-Auth with teams; proofs and lint enforcement; `teams.list/create` and `contacts.list/get/create/update/delete/restore/activity` over HTTP, MCP and the web; the app shell and Contacts screen in Ink with Host Grotesk, light and dark themes, the command menu and shortcuts.

Milestone 2: API keys (`apiKeys.list/create/revoke`), MCP OAuth connections (`connections.list/create/revoke`, discovery, the consent page), service accounts (`serviceAccounts.list/create`), Settings (Connections, API keys, Service accounts), and CRT mode drawn by a WebGL shader with convex glass, chromatic aberration and its own cursor.

Milestone 3: companies (`companies.list/get/create/update/delete/restore/activity`) with many domains, free email domains refused and a structured address; affiliations (`affiliations.list/create/update/delete`); domain matching both ways, recorded in activity with the matched domain; the Companies screen and affiliations on Contacts (D103–D113).

Milestones 4–7: notes (`notes.*`, in the timeline with activity); custom fields (`fields.*`, Settings → Fields, editable in panels and shown as columns); members and invitations (`members.*`, `invitations.*`, the Mailer with Resend or a logged outbox, Settings → Members and General); renaming and removing service accounts; filters and sorting on both lists (`POST …/list`); saved views (`savedViews.*`, in the sidebar); CSV import and export; bulk "set field" and "add to company"; the 30-day purge job.

Milestone 8: avatars and logos (`contacts.setAvatar/removeAvatar`, `companies.setLogo/removeLogo`). Uploads are cropped to 256px WebP by sharp. Logos are fetched from the primary domain in the background. Gravatar is used when the team turns it on. `FileStore` uses S3 when configured, else Postgres. Files are served from `/api/files/…` to members of their team only.

v2, milestones 9–12 (marketing email; choices in `docs/review.md` R36–R60):
- Email setup and subscriptions: `emailSettings.*`, `sendingDomains.*` (Resend Domains API), `topics.*`, a subscription status on contacts (with a filter field and CSV column), `contacts.subscriptions` and `contacts.updateSubscriptions`, and signed unsubscribe links with a public page and RFC 8058 one-click (`/api/unsubscribe/…`). Settings → Email holds all of it.
- Segments: `segments.*`, dynamic (the contacts filter, D59) or fixed. There's an index view, a segment view with a live preview, and "Add to segment" on Contacts.
- Templates and campaigns: `templates.*` and `campaigns.*`. Content is Markdown with merge tags, rendered to HTML and plain text with the footer. The composer has a live server-rendered preview and autosave. There are test sends to members, and a send dialog with a consent reminder.
- Sending: a background `CampaignSender` using Postgres as the queue (batches of 100, teams take turns, paced, with retries). Campaigns can be cancelled, and the report shows counts and recipients. Activity covers "sent this contact", unsubscribes, bounces and spam reports. Resend's webhook (`/api/webhooks/resend`, Svix-signed) records deliveries, bounces and complaints.

Not yet: a full record view (D55), paging in the contacts table beyond loading everything, scheduling, and open or click tracking (R47, R48).

## Proposed (awaiting the owner)

| # | Proposal | Where it's argued |
| --- | --- | --- |
| P2 | Permission set and role mapping (`records:read/write/delete`, `fields:manage`, `members:manage`, `service-accounts:manage`, `team:manage`) | [00](./00-architecture.md), [04](./04-authorization-proofs.md) |
| ~~P4~~ (now D50) | "Default" implies pluggable: a process-tier `Mailer` service interface in core, with `Resend` as the first (default) implementation. Resend errors are classified into our own error classes, and Resend's text never reaches a user | [01](./01-errors-are-data.md), [03](./03-tiers.md) |
| P3 | Effective permissions = role permissions ∩ scopes, computed in one function | [00](./00-architecture.md), [04](./04-authorization-proofs.md) |
| ~~P5~~ (approved with D97) | Term: **access token** = the OAuth token an agent gets for a connection (code: `AccessTokenUnrecognized`, `AccessTokenExpired`). It is currently banned as a synonym for API key, so it needs the owner's call. User-facing text says "the agent's sign-in" instead | [terminology](./terminology.md) |

Each post ends with its own **Open questions**, and those are collected below once reviewed.

## Open questions


### Deferred to v2 design

- **Q-T5** Per-team send rate limiting: an in-memory team-tier limiter, or a shared store keyed by `TeamId`?
- **Q-E8** How Resend errors are split into classes, and whether user messages ever name the email provider.
- How Resend's **Topics** map onto our subscription management.
