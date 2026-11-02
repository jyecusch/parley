# Contributing to Parley

Read [docs/README.md](docs/README.md) and the relevant architecture, error, or runtime guide before changing behavior. Keep public docs concise and limited to what contributors need. Do not add personal notes, research, design assets, journals, or blog drafts to the repository.

## Architecture and rules

- Put business behavior in shared core operations. The web app calls HTTP; HTTP and MCP use the same core implementation.
- Register every operation and declare both HTTP and MCP exposure explicitly. Preserve first-class agent access through direct or analogous operations.
- Require named values and proofs at protected service calls. Services still own SQL scoping; proof types do not inspect queries.
- Keep errors typed internally and use the approved public converters. Never expose diagnostic text or discard useful internal context to make a response safe.
- Keep connection and provider setup in their owning infrastructure layers; consuming services receive capabilities.
- Use established maintained libraries. UI components come from shadcn, icons from Lucide, and styling uses Tailwind's scale and theme variables; do not add arbitrary values or handwritten alternatives.
- Follow [terminology](docs/terminology.md) and American spelling. Add a necessary new concept to the glossary instead of inventing a synonym. Preserve third-party API names when discussing their APIs.
- Discuss product and architecture changes with the maintainer. Update current contributor rules when behavior changes; keep design history and learning notes outside the public repository.

## Validation

Run `bun run lint`, `bun run typecheck`, and `bun run test` before pushing. Tests use a local throwaway Postgres; never run test or migration experiments against a live database. Fake email and external providers.

Test meaningful behavior, especially refusals, cross-team isolation, concurrency, and recovery. Keep compile-time misuse fixtures under type checking. Lint matches specific syntax; do not treat it as a universal safety guarantee.

## Commits and releases

Use Conventional Commits with a useful scope. Keep commit messages and PR descriptions short. Versions follow Semantic Versioning, and every workspace carries the same release version. Main history is linear; use squash or rebase, never a merge commit.
