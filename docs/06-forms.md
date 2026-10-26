# Forms

Status: **agreed** (D144–D161), version one built.

A **form** is one a team designs in Parley and embeds on its own websites: a newsletter, an event registration, a waitlist for a launch. Each **submission** creates or updates a contact, records consent, and can subscribe them to topics and add them to a segment.

## What others do, and where we can do better

Research (Oct 2026) across HubSpot, Mailchimp, Kit, Loops, Brevo, Customer.io, Tally, Typeform, Formspree and Basin found the same gaps again and again:

| Gap in other tools | What Parley does instead |
| --- | --- |
| **Submissions overwrite contacts** (HubSpot's longest-running complaint). A public form is an anonymous write API keyed by email: anyone can rename `ceo@acme.com` or re-subscribe someone. | **Safe upsert.** A submission only fills empty fields; it never overwrites. Re-subscribing someone who left always needs them to confirm by email. The response is the same whether the email exists or not. |
| Styling: "the iframe can't be styled" (HubSpot), CSS collisions (Mailchimp), custom CSS only on paid plans (Tally, HubSpot). | **A typed appearance object**, like Stripe's: fixed or light-and-dark colors, font, sizes and spacing, and a short list of allowed rules. It can be set in the designer and overridden where the form is embedded, so it can follow the host site's look. Easy for agents to write, impossible to break the form with. |
| Spam protection is an afterthought or a paid add-on, and owners can't see why something was blocked. | **Invisible protection on by default**, in layers, with a reason kept for every blocked submission and a spam list to review. The captcha provider is pluggable per team. |
| Consent records left to the user. German courts want proof of *what* was agreed, not just an IP and time. | **Consent records built in**: the exact text shown, the form version, the page, time, IP and user agent, for both the submission and the confirmation click. |
| Double opt-in only on some paths (Loops: forms only; Mailchimp's API skips it). Confirmation emails become a bombing vector. | **Double opt-in on by default**, covering re-subscriptions too, and throttled per address. |
| Accessibility gaps (Typeform), autofill broken in shadow DOM. | **Plain, accessible markup**: real labels, `autocomplete`, visible focus, a titled iframe. |
| Analytics need hidden-field setup. | **Views, submissions, confirmations and conversion** per form and per page, with UTMs captured automatically from the host page. |

## The designer

One screen, the form itself in the middle, edited in place. No separate "builder" and "preview": what you see is what visitors see.

- **Start from a template**: Newsletter, Waitlist, Event, or blank. Each picks sensible fields, copy and topics.
- **Fields**: click to edit a label or placeholder in place; drag to reorder; "Add field" offers the contact's fields (first and last name, company, phone, address…) and the team's custom fields, so every answer lands on the contact. Email is always there and required.
- **Hidden fields**: the page and its tracking parameters (every `utm_*` parameter) are captured automatically (D153). Fixed values can be added, such as `Source = Launch page`.
- **Tracking options for the embedding site** (D154), off by default and turned on with attributes on the embed script, since the site answers for its visitors' consent:
  - `data-remember-utm` remembers UTM parameters for the visit (sessionStorage), or `="30"` for that many days (localStorage), so a submission on another page still counts the campaign. The latest UTMs replace remembered ones. Adding the script to every page, without a form, catches the landing page.
  - `data-click-ids` passes ad click IDs: `gclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `li_fat_id`, `ttclid`, `twclid`. The hosted page never records them: there's no site to have opted in.
  - The Embed tab builds the snippet with them, under Options (D155). Where a form is seen, by page and UTM parameter, is a tab on its Submissions screen.
- **Where submissions came from**: each submission and the contact's "submitted the form" activity show source / medium / campaign, the other UTM parameters and any ad click.
- **Consent**: a checkbox per topic the form subscribes to, never pre-ticked, with editable wording. A link to the team's privacy policy.
- **After submitting**: a message (default "Check your inbox to confirm"), or a redirect to a URL.
- **Side panel tabs**: Fields · Submit (what happens after submitting, and confirming by email) · Topics · Style · Embed. Bot protection is per team, in Settings → Forms.
- **Draft and published**: edits are a draft until published, so a live form never changes mid-edit. Each published version is kept, and consent records point at the version that was shown.

## Embedding

The form is served from Parley's own origin, `https://app.parley.page/f/<form id>`, and embedded as an iframe.

- **The embed snippet** is one script tag:
  ```html
  <script src="https://app.parley.page/embed.js" data-parley-form="<form id>" async></script>
  ```
  It creates the iframe, resizes it to fit its content (our own `postMessage`, ~30 lines; the common library is GPL), forwards the host page's URL and UTM parameters, and passes appearance overrides.
- **Appearance overrides at the embed site**, so a form can match the page it's on:
  ```html
  <script src=".../embed.js" data-parley-form="<form id>"
    data-appearance='{"colors":{"accent":"#0a7a5c"},"fontFamily":"Inter"}'></script>
  ```
  or in JavaScript: `Parley.form("#signup", { form: "<form id>", appearance: {…}, onSubmit })`.
- **Appearance** (one shape in the designer, the embed and the API):
  - `colorMode`: `fixed` (the same colors whatever the visitor's light or dark mode) or `light-dark` (switches with it).
  - `colors`: the colors, always when fixed and in light mode otherwise. `darkColors`: dark mode's, used only with `light-dark`. Each set has `heading`, `text`, `muted`, `accent`, `buttonText`, `background` (a color, or `transparent` to show the page behind the form) and `border`.
  - Shared by both sets: `fontFamily`, `fontSizeBase`, `radius`, `spacing`, `labels` (above or hidden).
  - Overrides at the embed site change only what they name, down to a single color in one set.
  - `rules`: CSS for a fixed set of public classes (`.Input`, `.Label`, `.Button`, `.Checkbox`, `.Message`) and states (`:focus`, `--invalid`), with an allowlist of properties per class.
  - `fonts`: a font stylesheet from Google Fonts, Bunny Fonts or Adobe Fonts. Nothing else: any other stylesheet on Parley's page could read what visitors type, or hide the consent wording, so the form's page also refuses stylesheets from anywhere else (CSP `style-src`). Fonts can't be overridden at the embed site, since anyone can write an override into a form's address. `fontFamily` is a name only, like `Inter`.
- **Plain iframe** fallback for sites that can't run scripts (fixed height, no overrides).
- **Hosted page**: the same URL works on its own, for linking from social posts or emails.
- **Where it may be embedded**: an optional list of domains per form, enforced with CSP `frame-ancestors`, so browsers refuse to frame it elsewhere. It isn't anti-spam on its own (headers are forgeable outside browsers); the other layers handle that.

## What a submission does

1. **Bot checks** (below). Failures go to the spam list with a reason; the visitor sees the normal success message, so bots learn nothing.
2. **The submission is stored** with every answer, the page and UTMs, and its consent record. Clicking a submission on the Submissions screen opens it beside the list: its answers, where it came from, and the consent record (D160). `forms.submissions` returns the same record, for the API and MCP.
3. **With double opt-in (the default)**, nothing touches contacts yet. Parley emails a confirmation link (no marketing content, from the sender the form picks, else the team's default sender (D162)). Unconfirmed submissions never become contacts, so bots and typos leave no junk.
4. **When confirmed** (or straight away without double opt-in):
   - **New email**: a contact is created with the answers, subscribed to the form's topics. Domain matching affiliates them with a company as usual.
   - **Existing email**: empty fields are filled; nothing is overwritten. A submitted value that differs from what the contact has is kept in the contact's activity ("Submitted *Waitlist*: first name Ada, kept Adeline"), with an Apply button, so a person can use it. Topics are added. Someone who had unsubscribed (from everything or from a topic) is re-subscribed only through a confirmed submission, never without one, even with double opt-in turned off.
   - Optionally, added to a fixed segment (for example "Launch waitlist").
   - An activity entry: "Submitted *Waitlist* on example.com/launch".
5. **The response** is identical whether the email existed, was new or was blocked.

## Bot protection

Layers, all invisible, all on by default:

1. **Signed render token**: when the iframe loads, Parley issues a token (form, time, nonce, HMAC-signed). A submission must carry one that's unused, not expired, and at least ~2 seconds old. This stops replayed and scripted POSTs that never load the form.
2. **Honeypot**: a hidden field people never fill.
3. **Proof of work** (built in, ALTCHA): ALTCHA's widget, invisible, solves a PBKDF2 challenge in the browser's background (about a second), and altcha-lib verifies it once. No third party, no cookies. This is the default captcha. An address loading forms more than 30 times in 10 minutes gets a challenge ten times harder: it isn't refused, so a busy office still gets its form, but bots looping load-and-submit pay far more.
4. **Rate limits**: per IP, per form, and per email address (subscription bombing comes from many IPs at once), plus a cap on confirmation emails per address. They count only submissions that passed the layers above, so a script can't use up a visitor's allowance, and one over a limit goes to the spam list rather than away, so a real one (a conference booth behind one router) can be released. The visitor's IP comes from `IP_ADDRESS_HEADER` alone when it's set, never from a header the visitor could write.
5. **Email checks**: syntax, MX record, and an optional block on disposable-email domains.
6. **Double opt-in**: the strongest layer. A bot can't click the link.

**Pluggable captcha, per team** (Settings → Forms): Built-in proof of work (default), **Cloudflare Turnstile** (invisible or managed), hCaptcha, reCAPTCHA v3 (with a score threshold), Friendly Captcha. They share one interface: the browser gets a token, and the server verifies it with the provider. Because the form is served from Parley's origin, one Turnstile site key works on every site the form is embedded on. Secret keys are stored encrypted (Parley gains encrypted secret storage), with a key that can be rotated (D152) in two deploys, so no server ever meets a secret it can't read:
  1. Add the new key to `PARLEY_ENCRYPTION_KEYS_PREVIOUS` and deploy. Every server can now read it.
  2. Swap: the new key becomes `PARLEY_ENCRYPTION_KEY`, the old one moves to `PARLEY_ENCRYPTION_KEYS_PREVIOUS`, and deploy. The start re-encrypts every stored secret; after it, the old key can go.

  A secret no key opens (a lost key) counts as Turnstile off: the team's forms fall back to the built-in proof of work, and the server logs a warning.

**Spam list**: blocked submissions are kept for 30 days with their reason ("honeypot filled", "token too fresh", "Turnstile failed"…) and can be released if a real person was caught. A released one is handled as if just sent, with its own 7 days to be confirmed.

**Unconfirmed and deleted**: a submission unconfirmed 7 days after it was sent (or released) expires, and its answers go. A deleted form takes nothing more, confirmations included. When a contact is purged (30 days after it's deleted), its submissions go with it: answers, address and consent records.

## Topics: opt-in as well as opt-out

Today every topic is opt-out: a contact gets it unless they've left. That's wrong for forms: someone who joins a launch waitlist hasn't agreed to the newsletter. **Topics gain a mode**:

- **Opt-out** (today's behavior, the default for existing topics): sent to everyone subscribed who hasn't left the topic.
- **Opt-in**: sent only to contacts who joined it, through a form or by hand (joining through an import isn't built yet).

A form subscribes people to opt-in topics they ticked. Broadcasts to an opt-in topic reach only its subscribers. Leaving is recorded whatever the mode: someone who left an opt-in topic is back only through a confirmed submission, and stays out if the topic's mode changes. The unsubscribe page can leave an opt-in topic but not join one; joining takes a form.

## Analytics

Per form: views (iframe loads), submissions, confirmations, spam, and conversion (confirmed ÷ views), over the form's life, broken down by page and by UTM source, medium and campaign. Trends over time aren't built yet. Shown on the form's page and in the forms list.

## API and MCP

Parity as always: `forms.list`, `forms.get`, `forms.create`, `forms.update`, `forms.publish`, `forms.delete`, `forms.submissions` (with spam and consent records), `forms.releaseSubmission`, `forms.analytics`, and the team's form settings (`formSettings.get`, `formSettings.update`). The public pieces sit outside `/api/v1`: the form page (`/f/:id`), `embed.js`, the submit endpoint, and the confirmation link.

## Version one (the prototype) and later

**In version one**: forms list and designer (templates, contact and custom fields, hidden fields and UTMs, consent per topic, message or redirect, appearance with live preview), draft and publish, embed script with auto-resize and appearance overrides, hosted page, double opt-in with confirmation email, safe upsert, opt-in topics, consent records, all built-in protection layers, Turnstile as the first pluggable provider, spam list, basic counts, API and MCP.

**Later**: more captcha providers, multi-step forms, file uploads, conditional fields, notifications and webhooks on submission, A/B variants, popups and slide-ins, a headless endpoint for fully custom HTML.

## Decided

- Unconfirmed submissions don't touch contacts (D146).
- The built-in proof of work is the default captcha (D147).
- Typed appearance only, no free custom CSS (D148).
- Topics gain an opt-in mode (D149).
