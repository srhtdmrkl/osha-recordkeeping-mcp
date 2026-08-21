# OSHA Recordkeeping MCP — 29 CFR Part 1904

A deterministic Model Context Protocol server that helps a safety manager answer the question they face every time someone gets hurt: **is this OSHA recordable?**

Eleven tools follow one incident from *someone got hurt* to a correct log entry, each returning a cited determination rather than a model's recollection of the rule. MIT licensed and free to use.

**Reference and triage only — not legal advice, and not a medical determination.**
Every determination carries its CFR citation and the date the underlying data was last verified against eCFR, so the reasoning is auditable rather than asserted.

## Using it

```bash
git clone https://github.com/srhtdmrkl/osha-recordkeeping-mcp.git
cd osha-recordkeeping-mcp && npm install && npm run build
```

Then add it to Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "osha": { "command": "node", "args": ["/absolute/path/to/dist/index.js"] }
  }
}
```

Use an absolute path to your `node` binary if you use nvm — Claude Desktop does not source your shell profile, so a bare `node` will not resolve.

The companion [Skill](skills/osha-incident-triage/SKILL.md) carries the procedure: when the chain applies, what to establish before calling, and what the tools cannot decide.

## Why this tool exists

Evaluating workplace injury recordability under **29 CFR Part 1904** occurs on every incident. Incorrect determinations carry direct compliance risks: over-recording artificially inflates Total Recordable Incident Rate (TRIR), while under-recording incurs OSHA citations under 29 CFR 1904.4.

Recordability under Part 1904 evaluates multiple independent triggers: general criteria (fatality, days away, job restriction, loss of consciousness, PLHCP diagnoses under 1904.7), specific case rules (needlesticks, medical removal, hearing loss, TB under 1904.8–1904.12), and treatment classification. For treatment, `1904.7(b)(5)(ii)` defines a **closed, 14-item enumerated list** of first-aid treatments. Implementing these closed regulatory rules inside typed tools replaces LLM interpolation over regulatory text with reproducible lookup logic.

## Division of labor: LLM narrates, tool decides

The calling model does what it is good at — reading a messy incident narrative and mapping it to canonical codes (treatment types, outcomes). The tool does what a model must not do for a legal determination — apply the closed list deterministically and return a cited answer. The tool never accepts free-text treatment descriptions; it accepts a controlled vocabulary so the determination is reproducible.

## The anchor tool: `osha_assess_recordability`

**Input.** The model maps the narrative to these; it never passes free text.

| Field | Meaning |
|---|---|
| `work_related` | 1904.5 — supply from `osha_assess_work_relatedness`, do not judge it here |
| `new_case` | 1904.6 — supply from `osha_assess_new_case` |
| `outcomes` | `death`, `days_away_from_work`, `restricted_work_or_transfer`, `loss_of_consciousness` |
| `significant_diagnoses` | `cancer`, `chronic_irreversible_disease`, `fractured_or_cracked_bone`, `punctured_eardrum` (1904.7(b)(7)) |
| `specific_case_criteria` | 1904.8-1904.12 triggers — needlestick, medical removal, hearing loss, TB, bloodborne exposure with diagnosis |
| `plhcp_recommendations_not_followed` | The three places a recommendation binds even when the employee ignored it (1904.7(b)(3)(ii), (b)(4)(viii), (b)(5)(v)) |
| `medical_removal_was_voluntary_and_early` | Guard for 1904.9(b)(3) — pulling someone out early is not recordable |
| `tuberculosis_test_was_pre_employment` | Guard for 1904.11(b)(1) — a hiring-physical positive is not occupational |
| `treatments` | Controlled codes. First-aid codes come from the closed list; two codes are *neither* first aid nor medical treatment (1904.7(b)(5)(i)) |

The first three arrays are **required**, deliberately. A default of `[]` cannot be told apart from *"I checked and there were none"*, so defaulting them lets an under-specified narrative return a confident, cited false negative — the under-recording direction that draws a citation.

**Output.** A `RuleRecord` whose value carries `recordable`, `basis`, `triggering_factors` (each with its own sub-clause cite), `severe_injury_reporting_note` when 1904.39 may be in play, `log_entry_notes` for consequences a criterion imposes on the log itself, and `under_specified` when nothing at all was asserted. The registration layer adds `determination_final` and `clarification_required` — see *Elicitation* below.

**Determination logic (deterministic)** — the 1904.4(b)(2) decision tree in order:
1. If `work_related` is false → **not recordable** (1904.5).
2. If `new_case` is false → **no new entry**, but *update the existing one* if the day counts or outcome have changed (1904.6). The tree routes here; it does not simply stop.
3. Else if any `specific_case_criteria` is present → **recordable** under 1904.8-1904.12, without consulting the first-aid list at all.
4. Else if any `outcome` is present → **recordable** (general recording criteria, 1904.7(b)(1)).
5. Else if any `significant_diagnosis` is present → **recordable** even if only first aid was given (1904.7(b)(7)).
6. Else if any `treatment` is **not** in the closed first-aid list → **recordable** (medical treatment beyond first aid, 1904.7(b)(5)(i)).
7. Else → **not recordable** (first-aid only, and no specific-case criterion).

Step 3 exists because `1904.4(a)(3)` is a **disjunction**: 1904.7 *or* the specific cases of 1904.8-1904.12. Without it a contaminated needlestick treated with cleaning and a bandage came back "not recordable" — with a citation attached — while the same server's privacy tool correctly called it a privacy case. Recording criteria that never consult the first-aid list have to be checked before it, not after.

## Protocol surface (all three MCP primitives)

This server uses the full protocol, not just Tools:

- **Tools** — the eleven determinations listed under *The incident-triage chain* below. Each declares an `outputSchema` and returns typed `structuredContent`, not a JSON string, and each is annotated `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` — safe, retryable, pure lookups.
- **Resources** — all fifteen datasets are exposed directly, so a client can load the reference data as context rather than only reaching it through a tool call. The data model is the product; Resources are what make it visible. URIs are `osha://data/<id>`, where `<id>` is the key in [`src/datasets.ts`](src/datasets.ts) — e.g. `osha://data/first-aid-treatments`, `osha://data/partially-exempt-industries`, `osha://data/privacy-cases`.
- **Prompt** — `triage_incident` walks one incident through the whole chain as a single user-invoked workflow: scope → recording employer → work-relatedness → new case → restricted work → hearing loss → recordability → reporting deadline → 300-Log column → privacy case → establishment.
- **Elicitation** — `osha_assess_recordability` resolves the one edge case it must not guess: OTC vs. prescription-strength medication. Nonprescription-strength is first aid; prescription-strength is medical treatment and recordable. When the narrative is silent the model passes `medication_unspecified_strength` and the strength gets resolved by asking a human — never by the tool picking.

  **Two-tier resolution.** Elicitation is an *optional* MCP capability, so the server checks `getClientCapabilities()` and picks its channel:

  | Client advertises `elicitation` | Channel | Result |
  |---|---|---|
  | Yes | Server prompts the user directly | Resolved in one tool call |
  | No | Returns `determination_final: false` + `clarification_required` | Model asks in chat, then re-calls with the resolved code |

  Either way the question reaches a human and the tool never guesses. The provisional result stays conservative — `recordable: true`, basis marked *pending confirmation* — and `clarification_required` carries the question, the CFR reason, and the exact treatment code to send back for each answer.

  **Which tier a given client lands in is worth checking rather than assuming.** Verified here: Claude Desktop's chat client advertises no `elicitation` capability, and neither does MCP Inspector 0.15.0 or 1.0.0. Agentic clients may differ, and a client that asks the user via its own mechanism looks identical from the outside. The server logs `elicitation=supported|NOT supported` to stderr on connect — start it under any client and read that line.

## Provenance & enforced decay

`RuleRecord<T>` (see [`src/types.ts`](src/types.ts)) carries regulatory rules: `cfr_cite`, `source_url`, `last_verified`, and where the eCFR supplies them, `amendment_history` and `editorial_note`. There is no `effective_date` field; datasets carry current eCFR text, and `last_verified` indicates the date of regulatory verification.

Decay is enforced via [`scripts/check-decay.ts`](scripts/check-decay.ts), which fails the build if any record's `last_verified` exceeds its decay threshold. It runs on push and on a weekly CI schedule, validates subpart `source_url` targets, and checks for eCFR `editorial_note` entries.

## The incident-triage chain (shipped)

Eleven deterministic tools that follow one incident from "someone got hurt" to a correct log entry:

1. **`osha_check_recordkeeping_obligation`** (1904.1, 1904.2) — the question every other determination assumes: must this employer keep records at all? The size exemption is measured across the **entire company** on **peak** employment last calendar year — not an average, not one site. The industry exemption attaches to the **establishment**, and the tool resolves it against the closed 82-code Appendix A list when given a NAICS code. Both are *partial*: **1904.39 severe-injury reporting survives either**, which is the inference an exempt employer gets dangerously wrong.
2. **`osha_determine_recording_employer`** (1904.31) — a threshold question, not a step: when the injured person is not on the payroll, is this the employer's case at all? **Day-to-day supervision decides, not the paycheck.** A temp on an agency's payroll whose work you direct daily is yours to record; the same temp under the agency's supervision is not. Self-employed people are outside the OSH Act entirely, and owners or partners of a sole proprietorship are not employees for recordkeeping. `(b)(4)` requires the case be recorded exactly once — never on both logs.
3. **`osha_assess_work_relatedness`** (1904.5) — the gate everything else rests on, and until now the one legal judgment this project handed to the model. 1904.5(a) *presumes* work-relatedness for anything arising in the work environment; 1904.5(b)(2) is a closed list of nine exceptions that can defeat it. The verdict is deliberately **three-valued** — `work_related`, `not_work_related`, or `requires_judgment` — because 1904.5 contains paths the regulation itself assigns to the employer: unclear origin (1904.5(b)(3)), travel status (b)(6), working at home (b)(7), and the "solely" finding every exception depends on. Forcing those into a boolean would be the tool guessing at the most-disputed call in Part 1904. It also settles cases memory gets backwards. A **motor-vehicle accident while commuting** on the company lot is excepted under (b)(2)(vii); a **slip and fall in the same lot** is not covered by any exception and stays work-related. And **mental illness** inverts the usual direction — not work-related *unless* the employee volunteers a PLHCP opinion (b)(2)(ix).
4. **`osha_assess_new_case`** (1904.6) — a new 300-Log entry, or an update to one already there? The second condition of the 1904.4(a) conjunction. It splits the two recurrence cases the regulation deliberately separates: an episode **caused by** a workplace exposure is a new case (b)(2) — occupational asthma triggered on the line — while a chronic illness whose symptoms recur **without** exposure is recorded once only (b)(1). Note (b)(1) is *not* a closed list: the regulation says "examples **may** include" cancer, asbestosis, byssinosis and silicosis, so the tool asks about the character of the condition rather than matching illness names. It is also the only tool in the server that defers to an outside authority. Under (b)(3) an employer need not consult a PLHCP, but having consulted one **must follow the recommendation** — so a PLHCP opinion overrides the rule logic entirely, and conflicting opinions return `requires_judgment` because weighing them is expressly the employer's job.
5. **`osha_evaluate_restricted_work`** (1904.7(b)(4)) — does the restriction actually count? Not every one does, and both errors move cases on or off the log. A restriction confined to the day of injury does not count (b)(4)(iii); reduced output while still performing all routine functions does not (b)(4)(vi); "routine functions" means activities performed at least once per week (b)(4)(ii). A partial shift does count (b)(4)(v)), and transfers share the restriction column (b)(4)(x)). The interesting one is (b)(4)(vii): when a vague recommendation like *"light duty"* cannot be clarified with the PLHCP, the case **must** be recorded as restricted work. That is the regulation resolving its own doubt toward recording — and the only default-to-record rule in Part 1904.
6. **`osha_evaluate_hearing_loss`** (1904.10) — the one recording criterion in Part 1904 that is pure arithmetic, and the only tool here that computes rather than looks up. Two tests must both be met **in the same ear**: a 10 dB standard threshold shift against the baseline, and a total hearing level of 25 dB or more above audiometric zero, each averaged at 2000, 3000 and 4000 Hz. An STS in one ear and a 25 dB level in the other does not record. Age adjustment applies to the shift test only, never to the 25 dB test.
7. **`osha_assess_recordability`** (1904.4) — is it recordable? (the anchor, above)
8. **`osha_check_severe_injury_reporting`** (1904.39) — must it be reported to OSHA, and by when? Returns the actual deadline timestamp (8 hours for a fatality, 24 for hospitalization / amputation / loss of an eye) computed from when the employer *learned* of it, checks the eligibility window from the incident, and flags whether the clock is already overdue.
9. **`osha_classify_300_log_entry`** (1904.29) — which 300-Log outcome column (G/H/I/J) under the most-serious-outcome rule, the injury/illness type column, and day counts capped at 180.
10. **`osha_check_privacy_case`** (1904.29(b)(6)-(9)) — may the employee's name go on the log at all? A second closed list, and closed in *both* directions: `(b)(7)` enumerates the six privacy concern cases, and `(b)(8)` forbids treating anything else as one — so an employer cannot extend it out of sympathy any more than they can ignore it. Returns the literal log entry (`"privacy case"`) plus the obligations that follow: the separate confidential list (`(b)(6)`), discretion in describing the case when the narrative alone could identify the employee (`(b)(9)`), and redaction when records go to anyone but a government representative (`(b)(10)`).
11. **`osha_route_to_establishment_log`** (1904.30) — which establishment's 300 Log, the last question about an individual incident. The rule runs against intuition: a case follows the **place**, not the person. Someone hurt while covering a shift at another of the employer's plants is recorded on **that** plant's log, which moves the number that drives its site TRIR. An injury away from every establishment — customer site, in transit, remote — goes on the log of the site where the employee normally works.

## Scope: Part 1904, and nothing else

Everything here answers one question — *someone got hurt; what does OSHA require me to record and report?* That is 29 CFR Part 1904 end to end, and the eleven tools above are the determinations it forces.

## Distribution: a server and a Skill

Two artifacts, because they answer different questions. **The server decides; the Skill knows when to ask it.**

### The server — three entry points, one engine

| Entry point | Transport | For |
|---|---|---|
| `dist/index.js` | stdio | Claude Desktop, local development |
| `dist/http.js` | Streamable HTTP | a container or node host |
| `src/worker.ts` | Streamable HTTP | Cloudflare Workers |

All three call the same `createServer()` over the same eleven tools and fifteen datasets — nothing in `src/tools/` knows which one is running. That portability came from two earlier decisions rather than from porting effort: the determinations are pure functions, and `datasets.ts` is the single point of contact with the JSON.

Every variant is **stateless** — a fresh server per request, no session ids, nothing kept between calls, because every tool is a pure lookup over bundled data. `/health` reports each dataset's age against its decay threshold and returns 503 when one goes stale, so a hosted deployment is watched on the same rule the build is.

```bash
npm run start:http      # node host — PORT=3000 MCP_PATH=/mcp by default
npm run smoke:http      # boots it, drives it with a real client, checks /health

npm run dev:worker      # wrangler dev — runs under workerd, not Node
npm run smoke:worker    # boots workerd and drives it with a real client
npm run deploy:worker   # wrangler deploy
```

`smoke:worker` is the only check that runs the tools under **workerd**. The other two smokes run on Node and structurally cannot see a node built-in creeping into a code path — which is exactly what a deploy would surface first. `nodejs_compat` is deliberately OFF in `wrangler.toml` so that failure is loud in dev rather than silent.

The worker accepts **POST only**. A stateless server initiates no messages, so the GET SSE stream carries nothing and would stay open forever; workerd cancels a request whose response never completes. `405` with `Allow: POST` is the protocol's way of saying there is no server-to-client stream.

No authentication, on purpose. The server exposes published regulatory text, stores nothing, and has no side effects, so access control belongs in front of it — Cloudflare Access or an OAuth layer — rather than half-implemented inside it.

### Rate limiting

Rate limiting is the exception, and it lives in the worker rather than in front of it. The deployment is on `workers.dev`, which is not a zone in the account, so a WAF rate limiting rule has nothing to attach to. Declared as a `[[ratelimits]]` binding in [`wrangler.toml`](wrangler.toml), which also means it is reviewed, versioned and travels with the deploy instead of living in a dashboard nobody diffs.

**300 requests per minute per client IP.** Deliberately generous: the limiter keys on IP, and a safety team behind one corporate NAT shares a single key. One triage chain is roughly 15 requests, so several people working at once legitimately clears 150/minute. This is sized to cut off a model looping on an error — the failure that actually threatens a hosted deployment — not to meter normal use. Over the limit returns `429` with `Retry-After`.

`/health` sits above the check, so an uptime monitor polling on a schedule can never be what exhausts the budget. Enforcement is per data centre rather than globally coordinated, so it is a cutoff rather than an exact quota.

### What the tools receive

The server retrieves nothing and stores nothing. But arguments still flow *in*, and they describe a real incident, so "no user data" is a claim about storage that says nothing about transit. The distinction is worth stating plainly, because it is the one an EHS team has to evaluate.

**No input is an identifier.** There is no field anywhere in the schemas for a name, employee number, date of birth, address, or free-text narrative — every input is an attribute of the case (`work_related`, `days_away_from_work`, `treatments`) and the determination needs nothing else. That is a property of the schemas, not a policy: there is no field to put a name in. The Skill instructs the model not to carry identity across into a call either, so the constraint holds at both ends — see [Pass facts, never identities](skills/osha-incident-triage/SKILL.md).

**Some attributes are sensitive anyway.** `osha_check_privacy_case` takes exactly the categories 1904.29(b)(7) enumerates — `sexual_assault`, `mental_illness`, `hiv_hepatitis_or_tuberculosis`, `contaminated_needlestick_or_sharps`. The regulation singles those out precisely because they are the ones that must not appear on a log a coworker can read. Attribute-only is also not the same as anonymous: a nature code plus an incident date at a nine-person establishment can identify someone to anyone who works there.

**Where that lands depends on the transport, and only on the transport:**

| Entry point | Where arguments go |
|---|---|
| stdio | stays on the machine running the server; the AI host still sees it |
| node HTTP / worker | crosses the network to whoever operates that deployment |

Nothing is logged either way — no request logging, no tool-call logging, successful or otherwise. That is deliberate. A log of these arguments would be a regulated repository in its own right, on a server that otherwise has nothing to regulate, and determinations are already reproducible from the inputs plus the `last_verified` dataset version carried in every response. Provenance in the response does the job an audit log would, without the retention.

**So: if you are handling real cases under GDPR or HIPAA, run stdio, or self-host the worker on infrastructure you control.** Pointing regulated incident data at someone else's hosted copy of this server means sending injury attributes to a third party you have no agreement with. The determinations are pure functions over bundled JSON — self-hosting costs one `wrangler deploy` and changes nothing about the answers.

### Host and Origin validation

Authentication is about *who may ask*. Host validation is about a browser being made to ask on someone else's behalf, which no upstream gateway can retrofit — so that part is handled in [`src/httpGuard.ts`](src/httpGuard.ts) and applies to both HTTP entry points.

The attack it closes is DNS rebinding: an attacker domain re-resolves to `127.0.0.1`, the browser treats the request as same-origin and sends it with no preflight, and a locally-run MCP server answers. The `Host` header is what still gives it away — it carries the attacker's domain — so an exact-match host allowlist is the check that works.

| Variable | Node (`dist/http.js`) | Worker |
|---|---|---|
| `HOST` | bind address, default `0.0.0.0` | — |
| `MCP_ALLOWED_HOSTS` | default `localhost:$PORT`, `127.0.0.1:$PORT`, `[::1]:$PORT` | unset = unrestricted |
| `MCP_ALLOWED_ORIGINS` | unset = unrestricted | unset = unrestricted |

Both accept a comma-separated list; `*` turns the check off when a gateway in front owns the decision. `Origin` is only checked when the header is present, because non-browser MCP clients do not send one. `/health` sits outside the allowlist — an uptime monitor is not the threat model.

**The node entry point defaults to loopback-only.** A container or reverse-proxy deployment is reached by another name and must set `MCP_ALLOWED_HOSTS`; it fails with a `403` naming the header it saw, which is a five-second fix. The opposite default is a hole nobody notices. Note that the bind address is not the protection — binding `0.0.0.0` stays the default so containers work, and the allowlist is what makes that safe.

Rejected requests get `403` with a JSON-RPC `-32000` error. Oversized bodies (>1 MB) get `413`, malformed JSON gets `400` — client mistakes are not logged as incidents.

### The Skill

[`skills/osha-incident-triage/`](skills/osha-incident-triage/SKILL.md) carries the *procedure*: when the chain applies, what to establish **before** calling, how to present a determination, and what the tools cannot decide. It contains process guidance for incident triage and carries no regulatory logic directly.

## Layout

Determination logic is pure and testable; the server is wiring around it.

```
src/
  index.ts              stdio entry point — Claude Desktop, local development
  http.ts               Streamable HTTP entry point — container / node host
  worker.ts             Cloudflare Workers entry point — same server, fetch handler
  server.ts             createServer() factory + registerRuleTool/toolResult helpers
  httpGuard.ts          Host/Origin allowlisting shared by both HTTP entry points —
                        one implementation, since Node and workerd share no middleware
  datasets.ts           the one place JSON assets are loaded and named — static imports,
                        so the same module resolves with or without a filesystem
  types.ts              RuleRecord, Provenance, and the ruleRecord() constructor
  md.d.ts               ambient declaration letting SKILL.md be imported as a string,
                        so the worker can serve it without a filesystem
  tools/                one pure function per determination — no MCP imports except
                        medicationStrength.ts, which owns the elicitation exchange
  registrations/
    tools/              one registerX.ts per tool + a barrel; metadata and summaries
    resources.ts        generated from the DATASETS table
    prompts.ts          triage_incident
```

Adding a tool means one file in `src/tools/` (the rule), one in `src/registrations/tools/` (how it is described and summarised), and one line in the barrel. The `register` prefix keeps those filenames distinct from their `src/tools/` counterparts in an editor tab bar.

Two invariants worth keeping: provenance is assembled only by `ruleRecord()`, and Resources are generated from the same `DATASETS` table the tools load from, so a dataset cannot be published under a path no tool reads.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs typecheck, build, unit tests, and smoke suites on Node 20 and 22.

The decay check and `npm audit` both run on the same triggers as the rest of CI — push, pull request, and a weekly schedule — kept as separate jobs so either failure is legible on its own rather than one red X among several. `npm audit` blocks the build on low-level production vulnerability advisories; dev-dependency advisories are reported, not blocking. The weekly schedule is what catches an advisory published against a dependency version already on `main`, where nothing would otherwise push to trigger a re-check.

`tsconfig.json` excludes `test/`, so `tsc --noEmit` checks `src/` only and ts-jest typechecks test files during `npm test`.

## Change control & versioning

[**CHANGELOG.md**](CHANGELOG.md) tracks all changes across two independent release dimensions:

- **Code:** Determination logic, tool schemas, and server transports follow Semantic Versioning.
- **Regulatory data:** Bundled eCFR JSON datasets under `src/data/`. Re-verifying a dataset against current eCFR text moves its `last_verified` date and is released as a patch update, even when regulatory text has not changed, maintaining auditable provenance for compliance teams.
- **Enforced Decay:** CI runs [`scripts/check-decay.ts`](scripts/check-decay.ts) weekly to fail the build if any dataset exceeds its 365-day decay threshold without manual re-verification.
- **Releases:** Version tags (`vX.Y.Z`) on GitHub trigger [`.github/workflows/release.yml`](.github/workflows/release.yml) to run full validation suites (typecheck, tests, smokes, decay, audit) and create a verified GitHub Release.

## Develop

```bash
npm install
npm run build       # tsc + copy src/data → dist/data
npm test            # jest — deterministic logic
npm run check-decay # build-breaking staleness trap
npm run smoke       # end-to-end: spawn the server, list tools/resources/prompts, call a tool
```

Connect locally via `npx @modelcontextprotocol/inspector`, or add to `claude_desktop_config.json` pointing at `dist/index.js`.

**`npm run smoke:worker` and `npm run dev:worker` need Node 22 or newer**, because wrangler does. Everything else runs on Node 20, and `engines` stays at `>=20` deliberately: that field is a claim about who can install and run the *server*, which needs only the SDK and zod. Wrangler is dev tooling and never reaches a consumer, so its requirement is not the package's. CI keeps Node 20 in the matrix for exactly that reason and skips only the worker smoke there.

## Evaluations

[`evals/recordkeeping-evals.xml`](evals/recordkeeping-evals.xml) — forty-seven questions testing whether an LLM reaches the right answer *through* the tools, which unit tests cannot cover. Every answer was produced by driving the built server with a real MCP client; the trace is in [`evals/README.md`](evals/README.md). Most of the forty-seven have an intuitive wrong answer a model reasoning from memory will reach for.

## Disclaimer

Reference and triage only. Not legal advice, not a medical determination. Recordability edge cases frequently require a PLHCP or counsel. Work-relatedness (1904.5) is determined only along its deterministic paths; unclear origin, travel status, working at home, and any unestablished "solely" finding return `requires_judgment` rather than a verdict.
