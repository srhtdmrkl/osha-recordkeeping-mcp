/**
 * End-to-end smoke test for the remote (Connector) transport.
 * Boots the HTTP server, drives it with a real MCP client over Streamable HTTP, and checks /health.
 */
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 39217;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Asserts that a condition is true, otherwise logs a failure, terminates the server process, and exits.
 *
 * @param {boolean} cond The condition to verify.
 * @param {string} msg The error message to display on failure.
 */
function assert(cond, msg) {
  if (!cond) {
    console.error("SMOKE FAILED:", msg);
    child?.kill();
    process.exit(1);
  }
}

const child = spawn("node", ["dist/http.js"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "inherit", "inherit"],
});

// Wait for the listener rather than sleeping a fixed amount.
const deadline = Date.now() + 10_000;
let up = false;
while (Date.now() < deadline && !up) {
  try {
    const r = await fetch(`${BASE}/health`);
    up = r.status === 200 || r.status === 503;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
assert(up, "server did not start listening");

// --- health -----------------------------------------------------------------
const health = await (await fetch(`${BASE}/health`)).json();
console.log("HEALTH ok:", health.ok, "| datasets:", health.datasets.length);
assert(health.datasets.length === 15, "health should report all 15 datasets");
assert(
  health.datasets.every((d) => typeof d.age_days === "number" && d.cfr_cite),
  "each dataset needs age_days and a cfr_cite"
);

// --- unknown path ------------------------------------------------------------
const notFound = await fetch(`${BASE}/nope`);
console.log("UNKNOWN PATH status:", notFound.status);
assert(notFound.status === 404, "unknown paths should 404");

// --- host allowlist ----------------------------------------------------------
/**
 * Executes a raw HTTP request to test host allowlist handling and header-based spoofing.
 *
 * Used because `fetch` treats Host as a forbidden header and will not send an override,
 * so the spoof must go out over a raw request — which is also what an attacker's
 * rebound browser effectively produces.
 *
 * @param {object} options Request options.
 * @param {string} [options.method="GET"] The HTTP method.
 * @param {string} [options.path="/"] The request path.
 * @param {string} [options.host] The Host header value.
 * @param {string} [options.body] The request body payload.
 * @returns {Promise<{status: number, body: string}>} The HTTP status and response body.
 */
function rawRequest({ method = "GET", path = "/", host, body }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: PORT,
        method,
        path,
        // setHost:false stops node from appending its own Host alongside ours.
        setHost: false,
        headers: {
          host,
          accept: "application/json, text/event-stream",
          ...(body ? { "content-type": "application/json" } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// The DNS rebinding shape: the request arrives on loopback, but the Host header
// carries the name the browser was pointed at. Only the header distinguishes it.
const rebind = await rawRequest({
  method: "POST",
  path: "/mcp",
  host: "evil.example",
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
console.log("REBIND HOST status:", rebind.status);
assert(rebind.status === 403, "a foreign Host header must be rejected");
assert(rebind.body.includes("-32000"), "rejection should be a JSON-RPC error");

// The legitimate loopback name still works over the same raw path, proving the
// 403 above came from the allowlist and not from something else in the request.
const allowed = await rawRequest({
  method: "POST",
  path: "/mcp",
  host: `127.0.0.1:${PORT}`,
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
console.log("ALLOWED HOST status:", allowed.status);
assert(allowed.status === 200, "the configured loopback host must be accepted");

// Health stays reachable regardless — an uptime monitor is not the threat model.
const healthForeign = await rawRequest({ path: "/health", host: "evil.example" });
console.log("HEALTH w/ foreign host status:", healthForeign.status);
assert(healthForeign.status === 200, "/health must not be behind the host allowlist");

// --- body limits -------------------------------------------------------------
const tooLarge = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(1_100_000) } }),
});
console.log("OVERSIZED BODY status:", tooLarge.status);
assert(tooLarge.status === 413, "an oversized body should be 413, not 500");

const badJson = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{ not json",
});
console.log("MALFORMED JSON status:", badJson.status);
assert(badJson.status === 400, "malformed JSON should be 400, not 500");

// --- MCP over Streamable HTTP ------------------------------------------------
const client = new Client({ name: "smoke-http", version: "0.0.0" }, { capabilities: {} });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));
assert(tools.tools.length === 11, "expected 11 tools over HTTP");

const resources = await client.listResources();
assert(resources.resources.length === 15, "expected 15 resources over HTTP");

const prompts = await client.listPrompts();
assert(prompts.prompts.length === 1, "expected the triage prompt over HTTP");

const call = await client.callTool({
  name: "osha_assess_recordability",
  arguments: {
    work_related: true,
    new_case: true,
    outcomes: [],
    significant_diagnoses: [],
    specific_case_criteria: [],
    plhcp_recommendations_not_followed: [],
    treatments: ["sutures_or_staples"],
  },
});
console.log("CALL recordable:", call.structuredContent?.value?.recordable);
assert(call.structuredContent?.value?.recordable === true, "sutures must be recordable over HTTP");
assert(call.structuredContent?.cfr_cite === "1904.4", "cite must survive the HTTP transport");

// Statelessness: a second, independent connection must behave identically.
const client2 = new Client({ name: "smoke-http-2", version: "0.0.0" }, { capabilities: {} });
await client2.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
const second = await client2.callTool({
  name: "osha_check_privacy_case",
  arguments: { nature: "mental_illness" },
});
console.log("SECOND CLIENT privacy_case:", second.structuredContent?.value?.privacy_case);
assert(second.structuredContent?.value?.privacy_case === true, "second connection must work independently");

await client.close();
await client2.close();
child.kill();
console.log("\nHTTP SMOKE OK");
