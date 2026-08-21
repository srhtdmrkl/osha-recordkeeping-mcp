/**
 * End-to-end smoke test against the Cloudflare worker running under workerd.
 *
 * This is the only check that catches a runtime difference between Node and
 * workerd before a deploy. The other two smokes run the same tools under Node,
 * so they cannot see a node built-in creeping into a code path.
 */
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 39311;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Asserts that a condition is true, otherwise logs a failure, terminates wrangler dev, and exits.
 *
 * @param {boolean} cond The condition to verify.
 * @param {string} msg The error message to display on failure.
 */
function assert(cond, msg) {
  if (!cond) {
    console.error("WORKER SMOKE FAILED:", msg);
    child?.kill("SIGTERM");
    process.exit(1);
  }
}

const child = spawn(
  "npx",
  ["wrangler", "dev", "--port", String(PORT), "--local", "--log-level", "error"],
  { stdio: ["ignore", "ignore", "inherit"] }
);

// wrangler dev takes noticeably longer to come up than a bare node process.
const deadline = Date.now() + 90_000;
let up = false;
while (Date.now() < deadline && !up) {
  try {
    const r = await fetch(`${BASE}/health`);
    up = r.status === 200 || r.status === 503;
  } catch {
    await new Promise((r) => setTimeout(r, 300));
  }
}
assert(up, "workerd did not start listening within 90s");

// --- health -----------------------------------------------------------------
const health = await (await fetch(`${BASE}/health`)).json();
console.log("HEALTH ok:", health.ok, "| datasets:", health.datasets.length);
assert(health.datasets.length === 15, "health should report all 15 datasets");
assert(
  health.datasets.every((d) => typeof d.age_days === "number" && d.cfr_cite),
  "each dataset needs age_days and a cfr_cite"
);

const notFound = await fetch(`${BASE}/nope`);
assert(notFound.status === 404, "unknown paths should 404");

// --- SKILL.md serving --------------------------------------------------------
const skillRoot = await fetch(`${BASE}/`);
assert(skillRoot.status === 200, "root path / should return 200");
assert(
  skillRoot.headers.get("content-type")?.includes("text/markdown"),
  "root path should return text/markdown"
);
const skillText = await skillRoot.text();
assert(skillText.includes("osha-incident-triage"), "root path should serve SKILL.md content");

const skillFile = await fetch(`${BASE}/SKILL.md`);
assert(skillFile.status === 200, "/SKILL.md path should return 200");
const skillFileText = await skillFile.text();
assert(skillFileText === skillText, "/SKILL.md content must match root content");

// A GET must be refused rather than left hanging — workerd cancels a request whose
// response never completes, which is what an idle SSE stream is in stateless mode.
const getStream = await fetch(`${BASE}/mcp`, { headers: { accept: "text/event-stream" } });
console.log("GET /mcp status:", getStream.status, "| allow:", getStream.headers.get("allow"));
assert(getStream.status === 405, "GET on a stateless MCP endpoint must be 405, not an open stream");

// --- body limits, enforced inside the isolate --------------------------------
// Worth checking under workerd specifically: the node path caps the body with a
// node stream, this one with a web stream, and only this smoke runs the latter.
const tooLarge = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(1_100_000) } }),
});
console.log("OVERSIZED BODY status:", tooLarge.status);
assert(tooLarge.status === 413, "an oversized body should be 413, not 500");

const badJson = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: "{ not json",
});
console.log("MALFORMED JSON status:", badJson.status);
assert(badJson.status === 400, "malformed JSON should be 400, not 500");

const empty = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: "",
});
console.log("EMPTY BODY status:", empty.status);
assert(empty.status === 400, "an empty body should be 400, not a consumed-stream 500");

// --- MCP over Streamable HTTP, served by workerd -----------------------------
const client = new Client({ name: "smoke-worker", version: "0.0.0" }, { capabilities: {} });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.length);
assert(tools.tools.length === 11, "expected 11 tools from the worker");

const resources = await client.listResources();
assert(resources.resources.length === 15, "expected 15 resources from the worker");

const prompts = await client.listPrompts();
assert(prompts.prompts.length === 1, "expected the triage prompt from the worker");

// A determination that exercises a bundled dataset end to end: if the JSON did not
// survive bundling, this is where it shows.
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
assert(call.structuredContent?.value?.recordable === true, "sutures must be recordable on workerd");
assert(call.structuredContent?.cfr_cite === "1904.4", "cite must survive the worker transport");

// The largest bundled asset — 82 NAICS groups. Proves a big dataset inlined intact.
const naics = await client.callTool({
  name: "osha_check_recordkeeping_obligation",
  arguments: { company_peak_employees_last_calendar_year: 400, establishment_naics_code: "541110" },
});
console.log("NAICS 541110 →", naics.structuredContent?.value?.matched_industry?.title);
assert(
  naics.structuredContent?.value?.matched_industry?.title === "Legal Services",
  "Appendix A must survive bundling"
);

// Statelessness: a second connection to the same worker behaves identically.
const second = new Client({ name: "smoke-worker-2", version: "0.0.0" }, { capabilities: {} });
await second.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
const privacy = await second.callTool({
  name: "osha_check_privacy_case",
  arguments: { nature: "mental_illness" },
});
assert(
  privacy.structuredContent?.value?.privacy_case === true,
  "second connection must work independently"
);

await client.close();
await second.close();

// --- rate limiting -----------------------------------------------------------
// Deliberately last: the burst below exhausts the per-minute budget for this
// client IP, so anything after it would be answered with 429 and fail for the
// wrong reason. Everything above has already run against a clean budget.
//
// Proves the binding is actually wired. A misconfigured `[[ratelimits]]` block
// leaves env.MCP_RATE_LIMITER undefined, the guard silently skips, and the
// worker serves every request — a failure that is invisible without this check.
const BURST = 320; // configured limit is 300/minute
const statuses = [];
for (let sent = 0; sent < BURST; sent += 40) {
  const batch = await Promise.all(
    Array.from({ length: 40 }, () =>
      fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }).then((r) => r.status)
    )
  );
  statuses.push(...batch);
}
const limited = statuses.filter((s) => s === 429).length;
console.log(`RATE LIMIT: ${limited}/${BURST} refused with 429`);
assert(limited > 0, "a burst past the configured limit must produce 429s — is the binding wired?");

child.kill("SIGTERM");
console.log("\nWORKER SMOKE OK");
