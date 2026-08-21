/**
 * Cloudflare Workers entry point.
 *
 * The SDK's WebStandardStreamableHTTPServerTransport takes a Request and returns
 * a Response, which is exactly the Workers fetch contract — so this file is thin.
 * Everything it serves is the same createServer() the stdio and node-HTTP entry
 * points use, with the same tools and the same datasets.
 *
 * Stateless per request, as in src/http.ts: every tool is a pure lookup over
 * bundled JSON, so there is nothing worth keeping between calls and no Durable
 * Object is needed. That is also what makes an isolate the right shape for this —
 * determinations return in single-digit milliseconds.
 *
 * No authentication here, deliberately. The worker serves published regulatory
 * text, holds no user data and has no side effects, so access control belongs in
 * front of it (Cloudflare Access, a rate limit rule, or an OAuth layer) rather
 * than half-implemented inside it.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./server.js";
import { DATASETS, type DatasetId } from "./datasets.js";
import { checkRequest, forbiddenBody, parseAllowlist, MAX_BODY_BYTES } from "./httpGuard.js";
import skillMd from "../skills/osha-incident-triage/SKILL.md";

/**
 * Cloudflare Worker environment bindings and configuration variables. Every entry is
 * optional: the worker is deployable with no configuration at all, and each field below
 * documents what its absence means.
 */
export interface Env {
  /** Overrides the MCP endpoint path. Defaults to /mcp. */
  MCP_PATH?: string;
  /**
   * Comma-separated Host allowlist. Unset means unrestricted, which is the right
   * default here: a worker answers on workers.dev and on any custom domain
   * bound to it, and a wrong guess would 403 the deployment that just shipped.
   * DNS rebinding is a localhost attack and does not apply to a public origin.
   */
  MCP_ALLOWED_HOSTS?: string;
  /**
   * Comma-separated Origin allowlist. Unset means unrestricted. Set this if the
   * worker should only answer browser clients from known sites — it is the one
   * check that constrains a page driving this endpoint with a user's network
   * position. Non-browser clients send no Origin and are unaffected.
   */
  MCP_ALLOWED_ORIGINS?: string;
  /**
   * Cloudflare rate limiting binding, declared in wrangler.toml. Optional so the
   * worker still runs where the binding is absent — the checks around it are the
   * security boundary; this one is a cost and availability control.
   */
  MCP_RATE_LIMITER?: RateLimiter;
}

/**
 * The shape of Cloudflare's rate limiting binding. Declared here rather than
 * pulled from @cloudflare/workers-types: this is the whole surface we use, and
 * the worker deliberately builds without a types package for the runtime.
 */
interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

const DAY_MS = 86_400_000;

/**
 * Generates the health check payload for Cloudflare Workers.
 * Surfaces dataset verification freshness, enabling external monitors to alert
 * before data exceeds its decay threshold.
 *
 * @returns An object stating whether the datasets are healthy, along with detailed status of each.
 */
function healthPayload() {
  const now = Date.now();
  const datasets = (Object.keys(DATASETS) as DatasetId[]).map((id) => {
    const { provenance } = DATASETS[id].data as { provenance: Record<string, unknown> };
    const lastVerified = String(provenance.last_verified);
    const threshold = Number(provenance.decay_threshold_days ?? Number.POSITIVE_INFINITY);
    const ageDays = Math.floor((now - Date.parse(`${lastVerified}T00:00:00Z`)) / DAY_MS);
    return {
      id,
      cfr_cite: String(provenance.cfr_cite),
      last_verified: lastVerified,
      age_days: ageDays,
      decay_threshold_days: Number.isFinite(threshold) ? threshold : null,
      stale: ageDays > threshold,
    };
  });
  const stale = datasets.filter((d) => d.stale);
  return {
    ok: stale.length === 0,
    status: stale.length === 0 ? "healthy" : "stale_data",
    datasets,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A client-caused failure, carrying the status and JSON-RPC code it maps to. */
class BodyError extends Error {
  constructor(
    readonly status: number,
    readonly rpcCode: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Reads and parses the JSON request body under size constraints.
 * Streaming the read allows an oversized body to be abandoned partway
 * rather than buffered in full, protecting against memory exhaustion attacks.
 *
 * @param request The incoming fetch Request.
 * @returns A promise resolving to the parsed JSON body.
 * @throws BodyError 413 if the body exceeds the size limit, or 400 if it is empty/invalid JSON.
 */
async function readLimitedJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    throw new BodyError(413, -32600, "Request body too large");
  }
  if (!request.body) {
    throw new BodyError(400, -32700, "Empty request body");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    // Content-length is a claim, not a fact; this is the check that binds.
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyError(413, -32600, "Request body too large");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const raw = new TextDecoder().decode(merged);
  // An MCP POST always carries a JSON-RPC message. Treating empty as a 400 also
  // avoids handing the transport an undefined body over a stream we consumed.
  if (!raw) throw new BodyError(400, -32700, "Empty request body");

  try {
    return JSON.parse(raw);
  } catch {
    throw new BodyError(400, -32700, "Invalid JSON body");
  }
}

/**
 * Cloudflare Workers default export containing the request fetch handler.
 */
export default {
  /**
   * Main request handler for the Cloudflare Worker.
   * Routes /health, /skill.md, and MCP JSON-RPC endpoints statelessly.
   *
   * @param request The incoming standard Request.
   * @param env The environment variables and bindings.
   * @returns The standard Response.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const mcpPath = env.MCP_PATH ?? "/mcp";

    if (url.pathname === "/health") {
      const payload = healthPayload();
      return json(payload, payload.ok ? 200 : 503);
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (url.pathname === "/" || url.pathname.toLowerCase() === "/skill.md")
    ) {
      return new Response(request.method === "HEAD" ? null : skillMd, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      });
    }

    if (url.pathname !== mcpPath) {
      return json({ error: `Not found. MCP endpoint is ${mcpPath}` }, 404);
    }

    const rejection = checkRequest(
      {
        allowedHosts: parseAllowlist(env.MCP_ALLOWED_HOSTS),
        allowedOrigins: parseAllowlist(env.MCP_ALLOWED_ORIGINS),
      },
      { host: request.headers.get("host"), origin: request.headers.get("origin") }
    );
    if (rejection) {
      console.error(`Rejected MCP request: ${rejection}`);
      return json(forbiddenBody(rejection), 403);
    }

    // POST only. A stateless server never initiates messages, so the GET SSE
    // stream has nothing to carry — it would stay open forever and workerd kills
    // a request whose response never completes. 405 is the protocol's way of
    // saying the server offers no server-to-client stream; clients handle it.
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "This server is stateless and accepts POST only. It initiates no messages, so there is no SSE stream to open.",
          },
          id: null,
        }),
        { status: 405, headers: { "content-type": "application/json", allow: "POST" } }
      );
    }

    // Rate limit before reading the body or building a server — those are the
    // costs worth refusing, and a request that gets this far is already shaped
    // like a real one. Health is above this line on purpose: an uptime monitor
    // polling on a schedule must never be what exhausts the budget.
    if (env.MCP_RATE_LIMITER) {
      // Keyed on the client IP. Behind a corporate NAT an entire safety team
      // shares one key, which is why the configured limit is generous — see
      // wrangler.toml.
      const key = request.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.MCP_RATE_LIMITER.limit({ key });
      if (!success) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message:
                "Rate limit exceeded. This server is a lookup over published regulatory text; " +
                "if you are seeing this from normal use, the caller is probably looping.",
            },
            id: null,
          }),
          {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "60" },
          }
        );
      }
    }

    // A fresh server and transport per request. Stateless mode rejects reuse, and
    // an isolate may serve many unrelated requests — sharing either would leak
    // one caller's connection into another's.
    const server = createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      const body = await readLimitedJson(request);
      await server.connect(transport);
      return await transport.handleRequest(request, { parsedBody: body });
    } catch (err) {
      // Client mistakes are not incidents; only log what an operator can act on.
      if (err instanceof BodyError) {
        return json(
          { jsonrpc: "2.0", error: { code: err.rpcCode, message: err.message }, id: null },
          err.status
        );
      }
      console.error("MCP request failed:", err);
      return json(
        { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
        500
      );
    }
  },
};
