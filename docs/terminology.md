# Terminology

Use these names consistently in code, UI, messages, and docs. Do not invent synonyms for an existing concept. Use American spelling. Library API names retain their library meaning: Better-Auth's `organization` does not rename Parley's team, and Effect's `Scope` does not mean credential scopes.

## Identity and architecture

| Term | Meaning and naming rule |
| --- | --- |
| Team | The tenant; use team, not org, organization, workspace, or account. |
| User / service account | A human who signs in / a non-human identity that can be a member. An agent acts through an authenticated principal. |
| Principal | The authenticated session, API key, or OAuth connection acting as a user or service account. `Actor` additionally includes system-attributed work. |
| Member / role | A user or service account belonging to a team / its `owner`, `admin`, or `member` role. Say “the `member` role” when ambiguous. |
| Permission / scopes | A capability core checks / the credential's ceiling on the principal's permissions. |
| API key | A user's or service account's secret credential. Do not call it a token or PAT. |
| Connection / access token | An OAuth authorization bound to a team / its short-lived credential. Neither is an API key. |
| Two-factor authentication / authenticator app / backup code | A sign-in code after the password / the app generating it / a single-use recovery code. Do not rename two-factor authentication MFA or two-step verification. |
| Passkey / password strength | A device-backed sign-in credential / the strength rating used for new passwords. |
| Invitation | An emailed link to join a team with a role; use invitation as the noun. |
| Operation | One business action defined in the registry; do not rename it command, handler, or use case. |
| Entrypoint | A way into core, such as HTTP or MCP. Do not use adapter, interface, door, or frontend for this concept. |
| Exposure manifest | Each registered operation's explicit HTTP and MCP publication policy. |
| Service / prover / proof | An Effect service performing work / a function checking a fact / evidence tied to named values. |
| Named value / tier | A value bound to an execution-specific name / process, team, or request lifetime. Do not use scope for tier. |
| Error / defect | A modeled expected condition / a bug or unclassified condition. Defects are not domain errors. |
| User message / log message | Authored `userMessage` for people and agents / internal `message` for operators. |
| Public error / reference id | The allowed response shape / the id linking a defect response to diagnostics. |

## Records and UI

| Term | Meaning and naming rule |
| --- | --- |
| Contact / company / record | A tracked person / organization / either record type. A company is not a team or account. |
| Record owner | The member responsible for a record. In UI say Contact owner or Company owner, never bare owner. |
| Field / custom field | A property of a record / a team-defined property. |
| Affiliation | A contact's relationship to a company, optionally with a title. |
| Domain / free email domain | A company's email domain / a public email provider's domain. |
| Domain matching | Affiliating contacts and companies by matching email domains. |
| Primary email / display name | The contact email used for broadcasts / a visible record name. |
| Delete / restore / purge | Hide a record / bring it back inside the restore window / remove it permanently. Do not call delete archive. |
| Note / activity | Member-written record text / recorded changes and events. |
| Avatar / logo / social profile | A contact image / company image / link to a social network profile. |
| Import / export / selection | Moving CSV data in / out / the picked or matching records an operation applies to. |
| Screen / view type | A routable place / its reusable index view, record view, panel, composer, or settings pattern. |
| Saved view / filter | Saved filters, sort and columns / a condition narrowing an index view. |
| Command menu / shortcut | The navigation menu / a key binding. Do not call them command palette or hotkey. |
| Theme variable / info tip / toast | A styling token / an explanatory label popover / a brief non-blocking message. |
| CRT mode / CRT settings / phosphor | The optional old-monitor appearance / its controls / its display color. |

## Email and forms

| Term | Meaning and naming rule |
| --- | --- |
| Segment | A dynamic filtered or fixed picked set of contacts. Do not call it an audience or list. |
| Broadcast / draft / template | One marketing email and its recipients/results / an unsent broadcast / reusable starting content. Do not call a broadcast a campaign. |
| Email style | Reusable email appearance; distinct from a content template. |
| Sender / default sender | A sending name/address, reply-to and legal details / the team's initial choice. |
| Sending domain / link subdomain | A DNS-verified sending domain / the subdomain its email links use. Neither is a company's domain. |
| DNS record / footer | A DNS host entry / the sender details and unsubscribe information appended to email. |
| Topic / subscriber | A kind of marketing email / a contact who joined an opt-in topic. Do not call a subscriber a member. |
| Subscription status / unsubscribe link | Whether marketing email is allowed / the signed link for leaving a topic or all email. |
| Recipient / merge tag / preview text / test send | A broadcast contact / substituted content marker / inbox preview / a draft sent to team members. |
| Form / submission | A team-designed public form / one visitor's answers. Do not call a submission a lead or response. |
| Appearance / hosted page / embed snippet | Typed form styling / a form at its own URL / the script tag embedding it. |
| Double opt-in / confirmation link | Confirmation before contact updates / the emailed link starting that confirmation. |
| Consent box / consent record / kept value | An unchecked topic choice / evidence of the version and wording accepted / an answer not applied over existing contact data. |
| Waiting / confirmed / expired / spam | Submission statuses. Spam list is the reviewable set of held submissions. |
| Render token / form settings / fine print | Signed evidence of loading a form / team-wide form configuration / text beneath its button. |
| Tracking parameters / click ID | Recorded page/UTM context / an opted-in ad click identifier. Attribution means who made a change, not tracking parameters. |
