/**
 * Checks applied to an inbound HTTP request before it reaches the MCP transport,
 * shared by the node and workerd entry points.
 *
 * The MCP spec requires a local HTTP server to validate `Origin`, because a
 * server bound to a port is reachable from any page the user happens to have
 * open. The attack that makes this non-theoretical is DNS rebinding: an attacker
 * domain re-resolves to 127.0.0.1, so the browser considers the request
 * same-origin and sends it without a preflight. The `Host` header is what still
 * gives it away — it carries the attacker's domain, not ours — so an exact-match
 * host allowlist is the check that actually closes the hole.
 *
 * Implemented here rather than via the SDK transport's `allowedHosts` /
 * `enableDnsRebindingProtection` options, which are marked `@deprecated` in
 * favour of external middleware. Keeping it local also means one implementation
 * serves both Node and workerd, which share no middleware stack.
 */

/**
 * Largest request body either entry point will accept. Lives here so the two
 * cannot drift: the node server and the worker are the same service, and a limit
 * that holds on one deployment and not the other is not a limit.
 *
 * A megabyte is far above anything this API needs — the largest legitimate call
 * is a handful of enums and dates — and far below what would strain a process.
 */
export const MAX_BODY_BYTES = 1_000_000;

/** `null` means "not configured" — the corresponding check is skipped. */
export type Allowlist = string[] | null;

/**
 * Parses a comma-separated environment variable string into an allowlist array.
 *
 * `*` disables the check rather than matching a host literally named `*`. An operator
 * fronting this with their own gateway needs a way to say "the proxy owns this decision",
 * and silently ignoring the wildcard would leave them debugging 403s from a layer they
 * thought they had turned off.
 *
 * @param raw The raw comma-separated environment variable value.
 * @returns An array of trimmed, lowercase allowed host/origin strings, or `null` if unconfigured or disabled via wildcard.
 */
export function parseAllowlist(raw: string | undefined): Allowlist {
  if (raw === undefined) return null;
  const entries = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (entries.length === 0) return null;
  if (entries.includes("*")) return null;
  return entries;
}

/**
 * Returns the loopback hostnames a local server is legitimately reached by, with port.
 *
 * @param port The HTTP port number.
 * @returns An array of loopback host strings (localhost, 127.0.0.1, and [::1]).
 */
export function loopbackHosts(port: number): string[] {
  return [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
}

/**
 * The allowlists `checkRequest` evaluates against. Either may be `null`, which skips the
 * corresponding check.
 */
export interface GuardConfig {
  allowedHosts: Allowlist;
  allowedOrigins: Allowlist;
}

/**
 * The two request headers the guard reads, normalized to a shape both entry points can
 * supply — node exposes them on `IncomingMessage.headers`, workerd on `Request.headers`.
 */
export interface RequestHeaders {
  host: string | null | undefined;
  origin: string | null | undefined;
}

/**
 * Evaluates an inbound request's Host and Origin headers against the allowlist configuration.
 *
 * **Host:** when an allowlist is configured the header must be present and match exactly,
 * port included — a missing Host on an allowlisted server is not a request we can vouch for.
 *
 * **Origin:** only checked when the header is present. Non-browser MCP clients do not send
 * one, and requiring it would lock out every stdio-style client that moves to HTTP. The Host
 * check is what stops rebinding; Origin is the additional guard for when an operator widens
 * `allowedHosts` to a public name.
 *
 * @param config The guard configuration containing allowed hosts and origins.
 * @param headers The HTTP request headers (host and origin).
 * @returns A human-readable rejection reason string if forbidden, or `null` if the request is permitted.
 */
export function checkRequest(config: GuardConfig, headers: RequestHeaders): string | null {
  const { allowedHosts, allowedOrigins } = config;

  if (allowedHosts) {
    const host = headers.host?.toLowerCase();
    if (!host || !allowedHosts.includes(host)) {
      return `Host header ${host ? `"${headers.host}"` : "(absent)"} is not allowed. ` +
        `Set MCP_ALLOWED_HOSTS to the host this server is reached by.`;
    }
  }

  if (allowedOrigins) {
    const origin = headers.origin?.toLowerCase();
    if (origin && !allowedOrigins.includes(origin)) {
      return `Origin "${headers.origin}" is not allowed.`;
    }
  }

  return null;
}

/**
 * Formats a rejected request into a standard JSON-RPC error response payload.
 *
 * `-32000` is server-defined: the JSON-RPC spec reserves the -32000 to -32099 range for
 * implementation-defined errors, so a rejection here cannot be confused with a protocol
 * error the SDK itself raises.
 *
 * @param reason The human-readable rejection reason.
 * @returns The formatted JSON-RPC response object.
 */
export function forbiddenBody(reason: string) {
  return {
    jsonrpc: "2.0" as const,
    error: { code: -32000, message: `Forbidden: ${reason}` },
    id: null,
  };
}
