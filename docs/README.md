# Parley docs

Parley is an open-source CRM that's fast, simple, and built for users *and* agents.

These posts explain how Parley is built and why. They're written to be read in order, and they're the contract the implementation is held to. If the code and a post disagree, one of them is a bug.

1. [One core, many entrypoints](./00-architecture.md): packages, vocabulary, and one request traced through every layer
2. [Errors are data](./01-errors-are-data.md): one class per error, and every entrypoint maps every one
3. [The friend who picks up the phone](./02-writing-error-messages.md): how we write the words users (and agents) read when something goes wrong
4. [Built once, built per team](./03-tiers.md): dependency tiers and their enforcement limits
5. [Proof, not promises](./04-authorization-proofs.md): authorization as proofs the compiler demands
6. [The product you feel](./05-ux-principles.md): what Linear's redesign teaches us about Parley's UI
7. [Forms](./06-forms.md): public submissions, consent, and bot protection
8. [Background delivery](./07-background-delivery.md): durable batches, provider idempotency, fenced leases, and honest unknown outcomes

[Terminology](./terminology.md): one name for every concept; synonyms are banned.

[Decisions log](./decisions.md): decided, proposed, and open.
