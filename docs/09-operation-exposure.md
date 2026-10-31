# Operation exposure

The operation registry defines capabilities. The exposure manifest makes a separate, exhaustive decision about where each capability is published. Adding an operation without deciding its HTTP and MCP exposure fails `bun run typecheck` (D171).

Agents are first-class clients. A capability offered in the UI or HTTP API should also be available directly or through an analogous MCP operation. An agent may act with the same authority and autonomy as a person. Authentication, roles, scopes, and proofs determine that authority; the fact that a caller is software does not justify withholding a capability. Users should be able to choose agents that interact through published entrypoints rather than being steered into a product's own agent.

## Where decisions live

`packages/domain/src/operations/exposure.ts` contains `operationExposures`, keyed by every `OperationName`. Both entrypoint decisions are required; there is no implicit inclusion or exclusion.

```ts
"contacts.list": {
  http: { kind: "included", method: "GET", path: "/teams/:teamId/contacts" },
  mcp: { kind: "included" },
},
```

An intentional exclusion uses `{ kind: "excluded", reason: "..." }` for that entrypoint. It requires an explanation, not an omitted property. A missing reason, a blank reason, or a reason typed as plain `string` fails compilation. Reasons must be literal strings with visible text; review must still reject vague explanations.

MCP can instead use `{ kind: "analogous", operation: "contacts.list", reason: "..." }`. This says the named tool provides the capability through an analogous operation, rather than publishing another tool. The target must be a registered operation directly included in MCP. Unknown targets, excluded targets, self-references, chains, and cycles fail compilation. Explain how callers achieve the capability through the target, including any differences in inputs and permissions. A shared name or description is not evidence of equivalent behavior.

HTTP path parameters must name fields of that operation's input; misspellings fail compilation. The HTTP entrypoint requires at least one explicitly included operation.

The manifest is the source of truth for the operations published by each entrypoint.

## How publication follows the decision

- HTTP endpoint construction, OpenAPI, handler registration, and expected-input error guidance use `httpOperationNames` and the manifest's routes.
- The web client's `call` accepts only `HttpOperationName`. Excluding an operation from HTTP breaks existing typed callers at compile time.
- MCP registers only `mcpOperationNames`. An analogous operation does not register an extra tool; its directly included target remains callable.
- Both entrypoints still run the same core implementations and authorization checks. Inclusion grants no permission by itself.

The generic selector tests cover inclusions, exclusions, and analogous operations. Compile-time fixtures exercise invalid policies. HTTP and MCP integration tests exercise a mixed policy, checking that excluded routes and tools cannot be discovered or called and that an analogous operation leaves its target callable. The existing MCP tool list protects the published entrypoint against accidental removals.

## What the guarantee covers

Exhaustiveness covers the operation registry, not every function or URL in the application. Authentication and OAuth, file delivery, public forms, signed unsubscribe links, and provider webhooks have separate entrypoint routes and access rules. They are not automatically governed by this manifest. A new business capability belongs in the operation registry even if its first caller is only the web UI.

TypeScript proves that each registered operation has decisions and that an analogous MCP target is directly published. It cannot prove that the target provides equivalent functionality, that an exclusion is justified, or that a new capability was registered in the first place. Review those questions explicitly. Types supplement the existing authorization proofs and service checks; the publication manifest does not replace them.
