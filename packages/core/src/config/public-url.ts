import { Config } from "effect"

/**
 * The address people and agents reach this server at: links in email, OAuth issuer, MCP resource.
 * Under portless (local development) it's the URL portless assigned, so no port is fixed; otherwise
 * BETTER_AUTH_URL.
 */
export const PublicUrl = Config.String("PORTLESS_URL").pipe(Config.orElse(() => Config.String("BETTER_AUTH_URL")))
