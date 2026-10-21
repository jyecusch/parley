# The product you feel

*What Linear's redesign teaches us about building Parley's UI. Not how it looks, but why it feels right.*

---

Open HubSpot and try to find one contact's phone number.

You'll get there. But first come a loading skeleton, then a sidebar with fourteen sections, a banner about a feature you didn't ask for, and a record screen with three tab strips, two of them collapsed. Then a right rail of "associations" and an activity feed that loads after everything else. Nothing on that screen is *broken*. Each panel was probably designed carefully by a capable team. Together, they feel like walking through an airport.

That's the problem Parley exists to solve. And it's a problem no single screen can fix, because it isn't *in* any single screen.

In March 2024 Linear published a two-part series on redesigning their app: [A design reset (part I)](https://linear.app/now/a-design-reset) by Karri Saarinen, and [How we redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui) by Karri, Yann-Edern Gillet, Andreas Eldh and Romain Cascino. On the surface it's about a sidebar, some tabs and a new colour system. Underneath, it's a manual for how a small team keeps a product feeling *good* as it grows.

We aren't going to copy Linear's sidebar. We're going to steal their reasons.

This post covers nine principles. Each one says what Linear did and why, then what it means for Parley, concretely.

---

## 1. Coherence beats local polish

**What Linear saw.** Karri's central argument in part I is that the product experience is *holistic*. Engineering can refactor one module at a time because nobody sees the seams. Users do see design seams. You can't predict which path a user takes through the app, so if you update one view at a time, the whole thing feels more disjointed with every update, not less.

So Linear didn't start with a screen. They started with what Karri calls the "inverted L": the sidebar down the left and the header across the top. That frame wraps every screen, and it's what makes forty different screens feel like one product. Then Yann worked through every *type* of view (list, board, timeline, split, fullscreen) so every decision held up in all of them.

**What it means for Parley.** We design the system before the screens.

Parley has very few view types, which is a gift. Let's name them and design them as one family:

| View type | v1 examples | v2 examples |
| --- | --- | --- |
| **Index view** (many records of one type) | Contacts, Companies | Broadcasts, templates, and dynamic and fixed segments |
| **Record view** (one record, its fields and activity) | A contact, a company | A broadcast, a template |
| **Panel** (a record peeked from an index view, without leaving it) | Contact peek from the Contacts index view | Recipient peek from a broadcast report |
| **Composer** (making something new that's bigger than a form) | (n/a) | Email editor, filter builder for a dynamic segment |
| **Settings** | Team, members, service accounts, API keys | Sending domains, footer, unsubscribe screen |

Every index view gets the same header (title, filters, display options, primary action) in the same places. Every record has the same anatomy: identity at the top, properties in a consistent order, activity below. Every panel is a record view at a narrower width, not a separate design. If you learn Contacts, you already know Broadcasts.

Two of these are decided. **Index views are tables** (D54): dense, sortable columns, custom fields as columns, inline editing, and filters above. **Opening a record from an index view opens a panel** (D55): you keep your place in the table, `J`/`K` move between records, and expanding the panel opens the full record view at its own URL.

The rule we'll hold ourselves to: **a new screen is an instance of an existing view type, or it's a conversation about adding a view type.** It is never a one-off.

---

## 2. Design debt is real, so leave room for what's coming

**What Linear saw.** Linear ships constantly, and Karri is candid that this is exactly what creates design debt. Every new capability puts stress on surfaces that were designed for an earlier, smaller product. His view is that the debt has to be paid, and paid in *sweeps* rather than drips, every few years if you're moving fast. Part of the reason for the redesign was to "make space" for Linear's move from issue tracker to a broader product development system.

**What it means for Parley.** We already know what v2 is: email marketing. Dynamic segments built from filters, fixed segments, templates, drafts, test sends, unsubscribes, compliance footers. If v1's chrome is designed only for "contacts and companies", v2 will arrive and immediately break it.

So we design v1's frame with v2 sketched in:

- **The sidebar has sections, not a flat list.** v1 ships with *Records* (Contacts, Companies). v2 adds an email section (broadcasts, templates, segments). We draw the v2 section in the design asset, even though it won't ship, to prove the sidebar holds it gracefully.
- **Filters are a first-class, reusable component from day one.** In v1 they filter a contacts table. In v2, *the exact same filter* defines a dynamic segment ("save these filters"). If we design v1 filters as a throwaway search bar, we pay for it later.
- **Activity is designed to grow from day one.** In v1 it shows edits ("Jane changed email"). In v2 it shows "Received *October update* broadcast", "Opened", "Unsubscribed from Marketing". The record view is designed so activity can grow without anyone rearranging the page.
- **Subscription status is a property in v1,** even if nothing sends mail yet. It's a fact about a contact. Putting it in its proper place now means v2 doesn't have to invent a new place for it.

We're not building v2 early. We're making sure v1 doesn't *assume v2 won't happen*.

---

## 3. Design asset first, then crash-test it

**What Linear saw.** Karri describes the auto industry's *concept car*: a bold, impractical prototype that sets direction without pretending to be production-ready. Calling a design a "concept" changes how people react to it. It becomes something to entertain rather than attack, and over a few iterations it becomes familiar enough to say yes to. He designed a complete set of screens every day and generated hundreds before narrowing to a few directions.

Then came the part that matters most. Before writing production code, Yann ran **stress tests**, which he jokingly called crash tests. He asked "How real could this concept car be?" and pushed the concept through every real view and state in the product, across three axes: environment, appearance, and hierarchy.

**What it means for Parley.** Every screen gets a design asset before it gets code. That's already agreed. Here's the addition: the asset isn't finished when the happy path looks good. It's finished when it survives this checklist.

### The Parley stress test

Every screen's design asset must show, or explicitly answer, each of these:

**Data shape**
- [ ] **Empty**: the first-run state, with a single clear next action ("Add a contact", "Import CSV"). Not a sad illustration.
- [ ] **One record** and **50,000 records**: does the layout still make sense? Is there pagination, virtualisation, or a count?
- [ ] **Long values**: a 90-character company name, a 6-word job title, an email like `firstname.middlename.lastname@subdomain.example.co.uk`. Where does it truncate, and how do you see the full thing?
- [ ] **Missing values**: a contact with only an email. No name, no company, no phone. What shows where the name would be?
- [ ] **Many values**: a contact with 4 emails, or a company with 300 contacts.
- [ ] **Unicode**: names in Japanese, Arabic (right-to-left) and with emoji.

**Time and errors** (mandatory in every design asset, along with empty states: D57)
- [ ] **Loading**: what appears in the first 100ms, and is there a skeleton or an instant cached render?
- [ ] **Errors**: which errors from the operation's error union can this screen hit, and what does each one look like? Messages follow [02, The friend who picks up the phone](./02-writing-error-messages.md). A conflict, a lost permission and a network drop are three different designs, not one red toast.
- [ ] **Optimistic writes rolled back**: what does the user see when the edit they already saw "succeed" is rejected?
- [ ] **Stale data**: someone, or some agent, changed this record while I was looking at it.

**Environment**
- [ ] **Narrow**: 1024px laptop width, and a phone at 390px. Parley is designed for desktop browsers; at 390px nothing breaks and you can look up and edit a contact, but layouts aren't specially designed for mobile (D56).
- [ ] **Keyboard only**: every action is reachable, focus is visible, and the shortcut is shown.
- [ ] **Light and dark** (D51).
- [ ] **Roles**: what does a `member` see on a settings screen that only an `admin` can change? Hidden, disabled with a reason, or read-only?

**Hierarchy**
- [ ] **In the frame**: the screen is shown inside the real sidebar and header, not floating on a blank artboard.
- [ ] **As a panel**: if it's a record view, it's also shown at panel width.
- [ ] **Agent-made**: data created or edited by an agent is shown, attributed (see principle 8).

If the asset can't answer a box, that's the conversation we have *before* building. That's the cheapest moment to have it.

---

## 4. Fit the environment you live in

**What Linear saw.** Linear runs as an Electron app on macOS and Windows *and* in a browser. Yann's environment test made sure the navigation felt native everywhere. That meant leaning on Apple's platform conventions, and making desktop-only affordances (back and forward buttons, history, tabs) easy to remove in the browser, where the browser already provides them.

The lesson isn't "follow Apple's guidelines". It's this: **respect the conventions the user already has in their hands.** Don't rebuild what the platform gives you, and don't break what it promises.

**What it means for Parley.** Parley lives in a browser tab, at least for now. So the browser's promises are our promises:

- **The URL is the state.** A filtered, sorted contacts index view has a URL you can paste to a colleague. A peeked record has a URL. Refreshing never loses your place. (TanStack Router's typed search params make this cheap. Use them for every piece of view state that a user would want to share or return to.)
- **Back means back.** Opening a panel pushes a browser history entry and closing it pops one. The back button never jumps you two screens.
- **Links are links.** Anything that navigates is an `<a>`, so cmd-click, middle-click and "copy link" work. No `div onClick={navigate}`.
- **Text is selectable** and copyable. A CRM is full of emails and phone numbers that users need to copy.
- **Keyboard first, mouse friendly.** The users who live in a CRM all day are power users. Every frequent action gets a shortcut. Shortcuts are single keys, Linear and Gmail style (`c` create, `/` search, `j`/`k` move), and are disabled while typing in a field (D53). They're *discoverable* in tooltips and menus, not hidden in documentation.
- **A command menu (⌘K)** in v1 that reaches every operation (D53). It's just another entrypoint onto the same operations from [00](./00-architecture.md), mirroring agent parity. Anything you can click, you can type.

And we deliberately **don't** rebuild: custom scrollbars, custom context menus that replace the browser's, in-app tabs, in-app back buttons.

---

## 5. The best details are felt, not seen

**What Linear saw.** Yann spent real time aligning labels, icons and buttons in the sidebar and tabs, both vertically and horizontally, in a very small space. He's honest that it isn't something you'll notice immediately. It's something you'll *feel* after a few minutes of using the app.

That's the deepest idea in the whole series. Quality accumulates below conscious attention. Nobody says "the icons are on a consistent 16px grid". They say "it feels calm", or "it feels fast", or "I trust it".

**What it means for Parley.**

- **One spacing scale, used without exception.** Tailwind's default 4px scale, with a short list of the steps we actually use. If a design needs `13px`, the design is wrong, not the scale.
- **Icons and text share an optical centre.** Sidebar items, table cells, buttons and menu items all get one row height per density and one icon size per row height.
- **Columns align across views.** The "Name" column in Contacts and the "Name" column in Companies start at the same x position. Switching between them shouldn't make your eye jump.
- **Density suited to users who work in it all day.** CRMs are scanned, not read. A contacts table should show 25 to 30 rows on a laptop without feeling cramped. Generous whitespace is for marketing websites. There is one dense default and no compact/comfortable toggle (D52), so there's one row height and one icon size to get perfectly aligned.
- **Motion is quick and purposeful.** Panels slide in fast enough to feel instant. Nothing bounces. No animation ever stands between someone and their data.

Each of these is a rule we can put in a component and a lint check, so getting it right doesn't depend on someone remembering.

---

## 6. Appearance is a system, not a palette

**What Linear saw.** This is the most technical part of part II, and the most transferable. Andreas explains that Linear rebuilt theme generation in **LCH**, a colour space that is *perceptually uniform*. Two colours with the same lightness value actually *look* equally light, which isn't true in HSL. The payoff is big: instead of hand-tuning 98 variables per theme, they define **three inputs (base colour, accent colour, and contrast)** and generate everything else.

Two details are worth underlining:

- **Contrast is an input.** Turn it up and you get a high-contrast theme for users who need one, for free. Accessibility isn't a separate theme someone has to maintain. It's a setting on the same system.
- **They pulled colour *out* of the chrome.** Limiting how much of the accent goes into surfaces gave a more neutral, timeless look, and made text and icons darker in light mode and lighter in dark mode. The frame recedes, and the content leads.

**What it means for Parley.** Tailwind v4 already defines its palette in **OKLCH**, a modern refinement of the same perceptually uniform idea. So we don't fight our tools. We lean in:

- **Semantic theme variables only.** Components use `bg-surface`, `bg-surface-raised`, `text-primary`, `text-muted`, `border-subtle`, `accent`. They never use `bg-gray-100` or `text-blue-600`. Raw palette classes get a lint rule.
- **Light and dark ship in v1** (D51), following the OS with a manual override. There's no theme picker in v1; custom and high-contrast themes come almost free later because of the next point.
- **Theme variables are generated from a few inputs** (base, accent, contrast) in OKLCH, the way Linear generates theirs. Surfaces are lightness steps away from the base, so elevation (background → panel → menu → dialog) is consistent by construction.
- **Neutral chrome.** The sidebar and header are near-greyscale. Colour is reserved for meaning: the primary action, a selection, a status (unsubscribed, bounced), and an error. If everything is blue, nothing is.
- **Contrast is tested, not hoped for.** Every theme-variable pair used for text meets WCAG AA at default contrast, and a future high-contrast theme must meet AAA.

---

## 7. Typography carries hierarchy

**What Linear saw.** Linear adopted a display cut of their typeface for headings, to add expression while keeping them readable, and kept the regular cut for everything else.

The point isn't the font. It's that **hierarchy comes from a deliberate, small set of type styles**, and headings and dense UI text have different jobs.

**What it means for Parley.** A short type scale (think five or six named styles: `title`, `heading`, `body`, `body-strong`, `label`, `mono`), each with a fixed size, weight, line height and tracking. Components pick a style, never a size. Tabular figures for numbers in tables, so columns of counts and dates line up. A monospace style for things users copy exactly: email addresses in some contexts, API keys, ids.

Which typeface we use is still open: the first design asset will show two or three candidates in context so we can compare them.

---

## 8. Restraint is a feature, and speed is the most important one

**What Linear saw.** Karri explored navigation and then deliberately *set it aside*. It turned out to be an engineering problem as much as a design one, and changing it would have changed how users interacted with the product. That felt like an unnecessary risk that would expand the scope. The redesign got more ambitious by getting *narrower*. Part I says the same thing in another way: a redesign shouldn't take the product apart down to the atoms.

**What it means for Parley.** Restraint is literally our pitch. HubSpot and Salesforce are slow and clunky because every feature anyone ever needed is still there, and it's still there on your screen. So:

- **Every feature has to earn its place in the chrome.** A capability that agents can reach through the API doesn't automatically deserve a sidebar item.
- **"Not yet" is a complete answer.** Deals, pipelines, tasks, custom objects and reporting dashboards are all things we're consciously *not* building, until the core is excellent.
- **Speed is the feature users will notice first.** The web app keeps the records on screen in TanStack Query's cache, loaded a page at a time (D136). Edits apply instantly and reconcile in the background, so **no spinners for local actions.** Renaming a contact doesn't show a loading state. It just happens. Spinners are for things that are really remote and really slow, such as an import or sending a broadcast, and those get real progress, not a spinner.
- **Navigation is instant.** Moving between Contacts and Companies renders from local data first and refreshes quietly.

---

## 9. Agents are users too, so show their work

Linear's redesign predates the agent wave, so this one is ours. It follows directly from their principles, though. If coherence means the product is experienced as one thing, then the things agents do are part of that experience.

In Parley, a `UserApiKey` or `ServiceAccountApiKey` (see [00](./00-architecture.md)) can do anything a user can. The UI has to make that legible and trustworthy:

- **Attribution everywhere.** Activity reads "Jane changed email *via Claude (Inbox triage API key)*" or "*Support Bot* created this contact". Never a vague "System".
- **Service accounts and API keys are visible.** A team's service accounts appear in Settings → Members with their role and when they were last active. Every API key shows its scopes and last use. An admin can revoke one in two clicks.
- **Parity, in both directions.** Anything the UI can do, an agent can do through an operation. Anything an agent did, the UI can show and undo with the same operations.
- **Recognisable at a glance.** A small, consistent marker on agent-made changes, in activity and the "last edited by" cell. It isn't a warning, just a fact.

---

## How we'll actually work: the per-screen loop

Linear's process went through five milestones: stress tests, behaviour definitions, chrome refresh behind a feature flag, private beta, and general availability. They dogfooded everything internally, with a toolbar toggle to flip between old and new. We're a much smaller team, but the shape transfers:

1. **Discuss.** What is this screen for? Which operations does it expose? Which view type is it?
2. **Design asset.** Shown in the real frame, with its error, empty and loading states (D57). Bold is fine here. It's for agreeing direction, not a promise of every pixel.
3. **Stress test.** Run the checklist from principle 3. Fix the design, not the checklist.
4. **Behaviour definitions.** For core components (sidebar, index view header, table, record view, panel, command menu), write down how they *behave* before building them: keyboard, focus, URL state, what happens on narrow widths, what happens on error. Linear treated this as its own milestone, and so will we. These components are built once and used everywhere.
5. **Build behind a flag.** The new screen ships off by default.
6. **Dogfood.** We run our own customer list in Parley. Anything that annoys us gets fixed before anyone else sees it.
7. **Ship.**

---

## Open questions

Resolved: D51 (light and dark, no picker), D52 (one dense default), D53 (command menu and single-key shortcuts), D54 (table index views), D55 (panel, expandable to the record view), D56 (desktop web, usable at 390px, no desktop app) and D57 (error, empty and loading states in every design asset). See the [decisions log](./decisions.md).

Still open:

1. **Typeface (Q-U3).** The first design asset shows two or three candidates (for example Inter with Inter Display, and Geist with Geist Mono) in context, and we choose there.
