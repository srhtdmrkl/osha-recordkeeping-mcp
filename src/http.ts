#!/usr/bin/env node
/**
 * Remote entry point — Streamable HTTP, for use as a hosted Connector.
 *
 * Stateless by design: a fresh server and transport per request, no session ids,
 * no cross-request memory. Every tool here is a pure lookup over bundled JSON, so
 * there is nothing to keep between calls, and statelessness means the process can
 * be scaled or restarted without coordinating session state.
 *
 * Deliberately no authentication in this file. The server exposes only published
 * regulatory text, holds no user data, and has no side effects — so auth is a
 * deployment concern (put it behind whatever gateway or OAuth layer the hosting
 * platform requires) rather than something to half-implement here.
 *
 * Host validation is a different matter and *is* handled here — see httpGuard.ts.
 * Auth is about who may ask; rebinding protection is about a browser being made
 * to ask on someone else's behalf, which no upstream gateway can retrofit.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { DATASETS, loadDataset, type DatasetId } from "./datasets.js";
import {
  checkRequest,
  forbiddenBody,
  loopbackHosts,
  parseAllowlist,
  MAX_BODY_BYTES,
} from "./httpGuard.js";

const PORT = Number(process.env.PORT ?? 3000);
const MCP_PATH = process.env.MCP_PATH ?? "/mcp";

/**
 * Binds all interfaces by default, because the documented deployment target is a
 * container and loopback-only would break it silently. What keeps that safe is
 * the host allowlist below, not the bind address.
 */
const HOST = process.env.HOST ?? "0.0.0.0";

/**
 * Defaults to loopback-only. A container or reverse-proxy deployment is reached
 * by some other name and must set MCP_ALLOWED_HOSTS — it then fails with a 403
 * naming the header it saw, which is a five-second fix, whereas the opposite
 * default is a hole nobody notices.
 */
const GUARD = {
  allowedHosts: parseAllowlist(process.env.MCP_ALLOWED_HOSTS) ?? loopbackHosts(PORT),
  allowedOrigins: parseAllowlist(process.env.MCP_ALLOWED_ORIGINS),
};

/** A client-caused failure, carrying the status and JSON-RPC code it maps to. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly rpcCode: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Reads and parses the JSON request body.
 * Implements a maximum body size cap to guard against memory exhaustion.
 *
 * @param req The incoming HTTP request.
 * @returns A promise resolving to the parsed JSON body, or undefined if empty.
 * @throws HttpError 413 if the body exceeds the size limit, or 400 if it is invalid JSON.
 */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    req.on("data", (c: Buffer) => {
      if (settled) return;
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        settled = true;
        // Stop consuming, but leave the socket alive: destroying it here would
        // race the 413 and the client would see a connection reset instead of
        // the reason it was rejected.
        req.pause();
        reject(new HttpError(413, -32600, "Request body too large"));
        return;
      }
      chunks.push(c);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, -32700, "Invalid JSON body"));
      }
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * Helper function to send a JSON response.
 *
 * @param res The server response object.
 * @param status The HTTP status code.
 * @param body The payload to stringify.
 * @param extraHeaders Optional additional headers to send.
 */
function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

/**
 * Generates the server health payload reflecting the age and freshness of all datasets.
 * Surfaces dataset verification freshness over HTTP, enabling external monitors
 * to alert before data exceeds its decay threshold.
 *
 * @returns An object stating whether the server is healthy, along with detailed dataset status.
 */
function healthPayload() {
  const now = Date.now();
  const datasets = (Object.keys(DATASETS) as DatasetId[]).map((id) => {
    const { provenance } = loadDataset(id);
    const ageDays = Math.floor(
      (now - Date.parse(`${provenance.last_verified}T00:00:00Z`)) / 86_400_000
    );
    const threshold = provenance.decay_threshold_days ?? Infinity;
    return {
      id,
      cfr_cite: provenance.cfr_cite,
      last_verified: provenance.last_verified,
      age_days: ageDays,
      decay_threshold_days: provenance.decay_threshold_days ?? null,
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

/**
 * Handles incoming MCP JSON-RPC requests statelessly.
 * Spawns a fresh MCP server instance and Streamable HTTP transport for the duration of the request.
 *
 * @param req The incoming HTTP request.
 * @param res The server response object.
 */
async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // A new server and transport per request: stateless mode rejects reuse, and the
  // determinations carry no state worth preserving anyway.
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    // Stateless JSON: no session ids, and plain JSON responses rather than SSE
    // streams. Determinations return in single-digit milliseconds, so streaming
    // buys nothing and costs deployment complexity behind proxies and CDNs.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  const body = req.method === "POST" ? await readBody(req) : undefined;
  await transport.handleRequest(req, res, body);
}

const httpServer = createHttpServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // Health is deliberately outside the guard: it exposes only dataset ages, and
  // an uptime monitor reaching it by whatever name it resolves is the point.
  if (url.pathname === "/health") {
    const payload = healthPayload();
    sendJson(res, payload.ok ? 200 : 503, payload);
    return;
  }

  if (url.pathname !== MCP_PATH) {
    sendJson(res, 404, { error: `Not found. MCP endpoint is ${MCP_PATH}` });
    return;
  }

  const rejection = checkRequest(GUARD, {
    host: req.headers.host,
    origin: req.headers.origin,
  });
  if (rejection) {
    console.error(`Rejected MCP request: ${rejection}`);
    sendJson(res, 403, forbiddenBody(rejection));
    return;
  }

  handleMcp(req, res).catch((err) => {
    const client = err instanceof HttpError;
    // Client mistakes are not incidents; only log what an operator can act on.
    if (!client) console.error("MCP request failed:", err);
    if (res.headersSent || res.writableEnded) return;

    const status = client ? err.status : 500;
    const code = client ? err.rpcCode : -32603;
    const message = client ? err.message : "Internal server error";
    // An unread request body and keep-alive do not mix — the next request on the
    // socket would start mid-JSON. Close it rather than desync the connection.
    const headers: Record<string, string> = status === 413 ? { connection: "close" } : {};
    sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null }, headers);
  });
});

httpServer.listen(PORT, HOST, () => {
  const hosts = GUARD.allowedHosts ? GUARD.allowedHosts.join(", ") : "any (unrestricted)";
  console.error(
    `osha-recordkeeping-mcp listening on ${HOST}:${PORT}${MCP_PATH} (health: /health)\n` +
      `allowed hosts: ${hosts}`
  );
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    httpServer.close(() => process.exit(0));
  });
}
