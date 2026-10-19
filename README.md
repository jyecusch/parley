# Parley

An open-source CRM that's fast, simple, and built for people and agents.

Read `docs/` first: `docs/00-architecture.md` explains how it fits together, and `docs/decisions.md` records what's decided.

## Run it locally

Needs Bun 1.4+ and Docker.

```sh
cp .env.example .env            # then set BETTER_AUTH_SECRET to 32 random bytes (openssl rand -hex 32)
bun install
bun run db:up                   # Postgres on localhost:5433
bun run db:migrate
bun run dev                     # https://parley.localhost, via portless
```

- Web app: https://parley.localhost. Create an account, then a team.
- `bun run dev` runs through [portless](https://github.com/vercel-labs/portless), which gives the app a random port behind a stable `.localhost` URL and tells the app its address in `PORTLESS_URL`. The first run asks for sudo once, to trust a local certificate and listen on port 443. In a linked git worktree the URL gets the branch name in front, so several copies can run at once.
- Without portless, `bun run dev:app` serves http://localhost:3000, using `BETTER_AUTH_URL` from `.env` as the app's address.
- HTTP API: `/api/v1`, with OpenAPI at `/api/v1/openapi.json`.
- MCP: `/mcp` (Streamable HTTP). Authenticate with an API key in `x-api-key` or `Authorization: Bearer`.

## Check it

```sh
bun run typecheck
bun run lint
bun run test                    # needs the database running, with .env loaded
```
