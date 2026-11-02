# Parley docs

Parley is an open-source CRM that's fast, simple, and built for users *and* agents.

These posts explain the architecture and its approved designs. Read the [implementation status](./10-implementation-status.md) alongside them: implemented mechanisms, partial requirements, and planned checks are different. Examples marked as sketches are not evidence of shipped enforcement. Keep implementation claims in sync with code; a decision records approval, not completion.

1. [One core, many entrypoints](./00-architecture.md): packages, vocabulary, and one request traced through every layer
2. [Errors are data](./01-errors-are-data.md): typed backend errors, retained diagnostics, safe public responses, and helpful user messages
3. [The friend who picks up the phone](./02-writing-error-messages.md): how we write the words users (and agents) read when something goes wrong
4. [Built once, built per team](./03-tiers.md): dependency tiers and their enforcement limits
5. [Proof, not promises](./04-authorization-proofs.md): authorization as proofs the compiler demands
6. [The product you feel](./05-ux-principles.md): what Linear's redesign teaches us about Parley's UI
7. [Forms](./06-forms.md): public submissions, consent, and bot protection
8. [Background delivery](./07-background-delivery.md): durable batches, provider idempotency, fenced leases, and honest unknown outcomes

9. [Database capabilities](./08-database.md): native Drizzle Effects, connection ownership, and migration compatibility

10. [Operation exposure](./09-operation-exposure.md): explicit publication and first-class agent access
11. [Architecture implementation status](./10-implementation-status.md): shipped checks, partial requirements, and planned work

[Terminology](./terminology.md): one name for every concept; synonyms are banned.

[Decisions log](./decisions.md): decided, proposed, and open.
