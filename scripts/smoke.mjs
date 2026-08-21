/**
 * End-to-end smoke test: spawns the built server over stdio and exercises the MCP protocol.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client(
  { name: "smoke", version: "0.0.0" },
  { capabilities: { elicitation: {} } }
);

// Auto-answer any elicitation with "prescription" so we can test the round-trip.
let elicited = false;
client.setRequestHandler(ElicitRequestSchema, async () => {
  elicited = true;
  return { action: "accept", content: { strength: "prescription" } };
});

await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

const resources = await client.listResources();
console.log("RESOURCES:", resources.resources.map((r) => r.uri).join(", "));

const prompts = await client.listPrompts();
console.log("PROMPTS:", prompts.prompts.map((p) => p.name).join(", "));

// Call a tool and confirm structuredContent comes back typed.
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
console.log("STRUCTURED recordable:", call.structuredContent?.value?.recordable);
console.log("STRUCTURED cite:", call.structuredContent?.cfr_cite);
// Text content must be a human sentence, not a JSON dump.
const humanText = call.content?.[0]?.text ?? "";
if (humanText.trimStart().startsWith("{")) {
  console.error("SMOKE FAILED: tool text content is raw JSON, not a readable summary");
  process.exit(1);
}
console.log("HUMAN TEXT:", humanText.split("\n")[0]);

// 300-Log classification uses `on_log` as the discriminator, not key presence.
const notOnLog = await client.callTool({
  name: "osha_classify_300_log_entry",
  arguments: { is_recordable: false },
});
console.log("NOT-ON-LOG on_log:", notOnLog.structuredContent?.value?.on_log);

// A malformed datetime must degrade, not throw.
const badDate = await client.callTool({
  name: "osha_check_severe_injury_reporting",
  arguments: {
    outcome: "fatality",
    incident_datetime: "yesterday morning",
    learned_datetime: "today",
  },
});
console.log(
  "BAD DATE isError:",
  badDate.isError ?? false,
  "| input_error:",
  (badDate.structuredContent?.value?.input_error ?? "").slice(0, 48)
);

// Elicitation round-trip: ambiguous medication strength → server asks → we answer
// "prescription" → case becomes recordable via medical treatment.
const elicit = await client.callTool({
  name: "osha_assess_recordability",
  arguments: {
    work_related: true,
    new_case: true,
    outcomes: [],
    significant_diagnoses: [],
    specific_case_criteria: [],
    plhcp_recommendations_not_followed: [],
    treatments: ["medication_unspecified_strength"],
  },
});
console.log("ELICITED:", elicited);
console.log("AFTER ELICIT recordable:", elicit.structuredContent?.value?.recordable);
console.log("AFTER ELICIT basis:", elicit.structuredContent?.value?.basis);

// Privacy case (1904.29(b)(7)): closed list in both directions.
const privacy = await client.callTool({
  name: "osha_check_privacy_case",
  arguments: { nature: "contaminated_needlestick_or_sharps" },
});
console.log(
  "PRIVACY needlestick:",
  privacy.structuredContent?.value?.privacy_case,
  "| name field:",
  privacy.structuredContent?.value?.log_name_entry
);
const notPrivacy = await client.callTool({
  name: "osha_check_privacy_case",
  arguments: { nature: "none_of_these", employee_requested_name_omitted: true },
});
console.log(
  "PRIVACY unlisted+requested:",
  notPrivacy.structuredContent?.value?.privacy_case,
  "| cite:",
  notPrivacy.structuredContent?.cfr_cite
);

// Omitting the signal arrays must now be a schema error, not a silent false negative.
const omitted = await client.callTool({
  name: "osha_assess_recordability",
  arguments: { work_related: true, new_case: true },
});
console.log("OMITTED FIELDS isError:", omitted.isError ?? false);

// Explicitly-empty is allowed, but must come back provisional, not settled.
const asserted = await client.callTool({
  name: "osha_assess_recordability",
  arguments: {
    work_related: true,
    new_case: true,
    outcomes: [],
    significant_diagnoses: [],
    specific_case_criteria: [],
    plhcp_recommendations_not_followed: [],
    treatments: [],
  },
});
const av = asserted.structuredContent?.value;
console.log(
  "NOTHING ASSERTED under_specified:",
  av?.under_specified,
  "| final:",
  av?.determination_final,
  "| clarification:",
  av?.clarification_required ? "PRESENT" : "null"
);

// 1904.5: the parking-lot split. A commuting motor-vehicle accident is excepted;
// a fall in the same lot is not covered by any exception and stays work-related.
const wrBase = { occurred_in_work_environment: true, origin_is_clear: true, claimed_exception: "none" };
const mva = await client.callTool({
  name: "osha_assess_work_relatedness",
  arguments: { ...wrBase, claimed_exception: "commuting_motor_vehicle_on_company_lot", exception_solely_established: true },
});
const fall = await client.callTool({ name: "osha_assess_work_relatedness", arguments: wrBase });
console.log("PARKING LOT mva:", mva.structuredContent?.value?.verdict, "| fall:", fall.structuredContent?.value?.verdict);

// A path the regulation assigns to the employer must never yield a boolean.
const travel = await client.callTool({
  name: "osha_assess_work_relatedness",
  arguments: { ...wrBase, special_situation: "travel_status" },
});
const tv = travel.structuredContent?.value;
console.log("TRAVEL verdict:", tv?.verdict, "| work_related:", tv?.work_related, "| cite:", tv?.judgment_required?.cfr_cite);

// 1904.39(b)(11): a severed ear is not an amputation. Not reportable, still recordable.
const ear = await client.callTool({
  name: "osha_check_severe_injury_reporting",
  arguments: { outcome: "amputation", amputation_kind: "severed_ear",
    incident_datetime: "2026-07-25T09:00:00Z", learned_datetime: "2026-07-25T10:00:00Z",
    outcome_datetime: "2026-07-25T09:30:00Z" },
});
const finger = await client.callTool({
  name: "osha_check_severe_injury_reporting",
  arguments: { outcome: "amputation", amputation_kind: "fingertip_amputation",
    incident_datetime: "2026-07-25T09:00:00Z", learned_datetime: "2026-07-25T10:00:00Z",
    outcome_datetime: "2026-07-25T09:30:00Z" },
});
console.log("AMPUTATION severed ear:", ear.structuredContent?.value?.reportable,
  "(still recordable:", ear.structuredContent?.value?.still_recordable + ")",
  "| fingertip:", finger.structuredContent?.value?.reportable);

// 1904.39(b)(10): admitted only for observation is not reportable.
const obs = await client.callTool({
  name: "osha_check_severe_injury_reporting",
  arguments: { outcome: "in_patient_hospitalization",
    hospitalization_for_observation_or_diagnostics_only: true,
    incident_datetime: "2026-07-25T09:00:00Z", learned_datetime: "2026-07-25T10:00:00Z",
    outcome_datetime: "2026-07-25T09:30:00Z" },
});
console.log("OBSERVATION-ONLY reportable:", obs.structuredContent?.value?.reportable,
  "| required info items:", finger.structuredContent?.value?.required_information?.length);

// 1904.46(3): a home is never an establishment.
const wfh = await client.callTool({
  name: "osha_route_to_establishment_log",
  arguments: { occurred_at_one_of_your_establishments: false, employee_was_telecommuting_from_home: true },
});
console.log("TELECOMMUTE routes to:", wfh.structuredContent?.value?.log_destination);

// 1904.1: partial exemption — and the thing that survives it.
const small = await client.callTool({
  name: "osha_check_recordkeeping_obligation",
  arguments: { company_peak_employees_last_calendar_year: 6 },
});
const exemptVal = small.structuredContent?.value;
console.log("EXEMPT (6 employees) recordkeeping:", exemptVal?.recordkeeping_required,
  "| 1904.39 still required:", exemptVal?.severe_injury_reporting_still_required);
const bigSmallSite = await client.callTool({
  name: "osha_check_recordkeeping_obligation",
  arguments: { company_peak_employees_last_calendar_year: 4 },
});
console.log("  company-wide test cites:", bigSmallSite.structuredContent?.value?.cfr_cites?.includes("1904.1(b)(1)"));
const lawFirm = await client.callTool({
  name: "osha_check_recordkeeping_obligation",
  arguments: { company_peak_employees_last_calendar_year: 400, establishment_naics_code: "541110" },
});
const builder = await client.callTool({
  name: "osha_check_recordkeeping_obligation",
  arguments: { company_peak_employees_last_calendar_year: 400, establishment_naics_code: "236118" },
});
console.log("  NAICS 541110 →", lawFirm.structuredContent?.value?.matched_industry?.title ?? "not listed",
  "| 236118 →", builder.structuredContent?.value?.matched_industry?.title ?? "not listed");

// 1904.31(b)(2): supervision decides, not payroll. Same temp, opposite answers.
const tempSupervised = await client.callTool({
  name: "osha_determine_recording_employer",
  arguments: { worker_relationship: "temporary_leased_or_supplied", you_supervise_day_to_day: true },
});
const tempNot = await client.callTool({
  name: "osha_determine_recording_employer",
  arguments: { worker_relationship: "temporary_leased_or_supplied", you_supervise_day_to_day: false },
});
const selfEmp = await client.callTool({
  name: "osha_determine_recording_employer",
  arguments: { worker_relationship: "self_employed", you_supervise_day_to_day: true },
});
console.log("EMPLOYER temp supervised:", tempSupervised.structuredContent?.value?.recording_employer,
  "| not supervised:", tempNot.structuredContent?.value?.recording_employer,
  "| self-employed:", selfEmp.structuredContent?.value?.recording_employer);

// 1904.30(b)(4): the case follows the PLACE, not the person.
const atHost = await client.callTool({
  name: "osha_route_to_establishment_log",
  arguments: { occurred_at_one_of_your_establishments: true },
});
const awayFromAll = await client.callTool({
  name: "osha_route_to_establishment_log",
  arguments: { occurred_at_one_of_your_establishments: false },
});
console.log("ROUTING at-host:", atHost.structuredContent?.value?.log_destination,
  "| away:", awayFromAll.structuredContent?.value?.log_destination);

// 1904.29(b)(2)-(b)(3): the 301 is mandatory too, and the 7-day clock runs from
// when the employer LEARNED of the case.
const forms = await client.callTool({
  name: "osha_classify_300_log_entry",
  arguments: { is_recordable: true, days_away_from_work: 2, date_information_received: "2026-06-01T00:00:00Z" },
});
const fv = forms.structuredContent?.value;
console.log("RECORD BY:", fv?.record_by_iso, "| forms:", fv?.forms_required?.length);

// 1904.29(b)(10): exactly three recipients may see identifying information.
const disc = await client.callTool({
  name: "osha_check_privacy_case",
  arguments: { nature: "sexual_assault" },
});
console.log("DISCLOSURE exceptions:", disc.structuredContent?.value?.disclosure_exceptions?.length);

// 1904.11(b)(1): a pre-employment positive skin test is not an occupational exposure.
const tbBase = {
  work_related: true, new_case: true, outcomes: [], significant_diagnoses: [],
  plhcp_recommendations_not_followed: [], treatments: [],
  specific_case_criteria: ["tuberculosis_infection"],
};
const tbPre = await client.callTool({
  name: "osha_assess_recordability",
  arguments: { ...tbBase, tuberculosis_test_was_pre_employment: true },
});
const tbOcc = await client.callTool({ name: "osha_assess_recordability", arguments: tbBase });
console.log("TB pre-employment:", tbPre.structuredContent?.value?.recordable,
  "| occupational:", tbOcc.structuredContent?.value?.recordable);

// 1904.11(b)(2): three enumerated circumstances PERMIT lining a TB case out.
const lineOut = await client.callTool({
  name: "osha_classify_300_log_entry",
  arguments: { is_recordable: true, days_away_from_work: 4, illness_type: "respiratory_condition",
    tuberculosis_case: true, tb_non_occupational_evidence: "household_contact" },
});
console.log("TB line-out permitted:",
  /line out or erase/i.test(lineOut.structuredContent?.value?.amend_existing_entry ?? "") ? "yes (permissive)" : "no");

// 1904.10: both tests must be met in the SAME ear. Split across ears, no record.
const flat = (db) => ({ hz2000: db, hz3000: db, hz4000: db });
const sameEar = await client.callTool({
  name: "osha_evaluate_hearing_loss",
  arguments: { baseline_left: flat(15), current_left: flat(25), baseline_right: flat(10), current_right: flat(10) },
});
const splitEars = await client.callTool({
  name: "osha_evaluate_hearing_loss",
  arguments: { baseline_left: flat(0), current_left: flat(20), baseline_right: flat(30), current_right: flat(32) },
});
console.log("HEARING same-ear:", sameEar.structuredContent?.value?.recordable,
  "| split across ears:", splitEars.structuredContent?.value?.recordable);

// 1904.9(b)(3): pulling someone early, before the standard's removal levels, is
// not recordable — the tool must not penalise an employer for acting on caution.
const early = await client.callTool({
  name: "osha_assess_recordability",
  arguments: {
    work_related: true, new_case: true, outcomes: [], significant_diagnoses: [],
    specific_case_criteria: ["medical_removal"], plhcp_recommendations_not_followed: [],
    medical_removal_was_voluntary_and_early: true, treatments: [],
  },
});
const mrDue = await client.callTool({
  name: "osha_assess_recordability",
  arguments: {
    work_related: true, new_case: true, outcomes: [], significant_diagnoses: [],
    specific_case_criteria: ["medical_removal"], plhcp_recommendations_not_followed: [],
    treatments: [],
  },
});
console.log("MEDICAL REMOVAL voluntary-early:", early.structuredContent?.value?.recordable,
  "| under the standard:", mrDue.structuredContent?.value?.recordable);

// 1904.8(b)(4): a splash with no cut is recordable ONLY if it produced a diagnosis.
const splash = await client.callTool({
  name: "osha_assess_recordability",
  arguments: {
    work_related: true, new_case: true, outcomes: [], significant_diagnoses: [],
    specific_case_criteria: ["bloodborne_exposure_with_diagnosis"],
    plhcp_recommendations_not_followed: [], treatments: [],
  },
});
console.log("SPLASH+DIAGNOSIS recordable:", splash.structuredContent?.value?.recordable,
  "| cite:", splash.structuredContent?.value?.triggering_factors?.[0]?.cfr_cite);

// 1904.8(a): the needlestick criterion also decides the log entry itself.
const stickNotes = await client.callTool({
  name: "osha_assess_recordability",
  arguments: {
    work_related: true, new_case: true, outcomes: [], significant_diagnoses: [],
    specific_case_criteria: ["contaminated_needlestick_or_sharps"],
    plhcp_recommendations_not_followed: [], treatments: ["wound_cleaning"],
  },
});
console.log("NEEDLESTICK log notes:", stickNotes.structuredContent?.value?.log_entry_notes?.length);

// 1904.8(b)(3): a later diagnosis amends the existing entry, never adds a case.
const amend = await client.callTool({
  name: "osha_classify_300_log_entry",
  arguments: { is_recordable: true, days_away_from_work: 2, illness_type: "other_illness",
    bloodborne_diagnosis_after_recording: true },
});
console.log("AMEND EXISTING:", amend.structuredContent?.value?.amend_existing_entry ? "yes" : "no");

// 1904.7(b)(5)(i): an x-ray is expressly NOT medical treatment. Before these codes
// existed the model had nowhere to put it but other_medical_treatment — over-recording.
const xray = await client.callTool({
  name: "osha_assess_recordability",
  arguments: {
    work_related: true, new_case: true, outcomes: [], significant_diagnoses: [],
    specific_case_criteria: [], plhcp_recommendations_not_followed: [],
    treatments: ["diagnostic_procedure_only", "wound_covering"],
  },
});
console.log("X-RAY ONLY recordable:", xray.structuredContent?.value?.recordable);

// 1904.7(b)(4)(vii): the regulation resolves its own doubt toward recording.
const vague = await client.callTool({
  name: "osha_evaluate_restricted_work",
  arguments: {
    restriction_applies_beyond_day_of_injury: true,
    keeps_from_routine_function_or_full_shift: false,
    restriction_is_vague: true,
    vague_restriction_clarified: false,
  },
});
const vv = vague.structuredContent?.value;
console.log("VAGUE 'light duty' restricted:", vv?.restricted_work, "| by_default:", vv?.recorded_by_default);

// 1904.7(b)(4)(iii): a restriction confined to the day of injury never counts.
const dayOf = await client.callTool({
  name: "osha_evaluate_restricted_work",
  arguments: { restriction_applies_beyond_day_of_injury: false, keeps_from_routine_function_or_full_shift: true },
});
console.log("DAY-OF-INJURY ONLY restricted:", dayOf.structuredContent?.value?.restricted_work);

// 1904.6: the recurrence split, and the binding PLHCP override.
const ncBase = { prior_recorded_same_type_same_body_part: true };
const asthma = await client.callTool({
  name: "osha_assess_new_case",
  arguments: { ...ncBase, workplace_event_caused_current_symptoms: true },
});
const silicosis = await client.callTool({
  name: "osha_assess_new_case",
  arguments: { ...ncBase, chronic_recurs_without_workplace_exposure: true },
});
console.log("RECURRENCE asthma:", asthma.structuredContent?.value?.verdict,
  "| chronic:", silicosis.structuredContent?.value?.verdict);

const bound = await client.callTool({
  name: "osha_assess_new_case",
  arguments: { ...ncBase, workplace_event_caused_current_symptoms: true, plhcp_opinion: "recurrence" },
});
const bv = bound.structuredContent?.value;
console.log("PLHCP override verdict:", bv?.verdict, "| decided_by_plhcp:", bv?.decided_by_plhcp);

// 1904.8: a contaminated needlestick treated with first aid only is still recordable.
// This returned "not recordable" with a citation before the specific-case gate existed.
const stick = await client.callTool({
  name: "osha_assess_recordability",
  arguments: {
    work_related: true,
    new_case: true,
    outcomes: [],
    significant_diagnoses: [],
    specific_case_criteria: ["contaminated_needlestick_or_sharps"],
    treatments: ["wound_cleaning", "wound_covering"],
  },
});
const sv = stick.structuredContent?.value;
console.log("NEEDLESTICK first-aid-only recordable:", sv?.recordable, "| cite:", sv?.triggering_factors?.[0]?.cfr_cite);

// Read a resource (confirms JSON loads from dist/data at runtime).
const forms301 = await client.readResource({ uri: "osha://data/recording-forms" });
const pf = JSON.parse(forms301.contents[0].text).form_301;
console.log("FORM 301 fields:",
  Object.values(pf.fields).reduce((n, g) => n + Object.keys(g).length, 0),
  "| PII fields:", pf.pii_instruction.applies_to_fields.join(","));

const defs = await client.readResource({ uri: "osha://data/definitions" });
const parsedDefs = JSON.parse(defs.contents[0].text);
console.log("DEFINITIONS terms:", Object.keys(parsedDefs.definitions).length,
  "| PLHCP test:", /scope of practice/i.test(parsedDefs.definitions.physician_or_other_licensed_health_care_professional.definition) ? "scope of practice" : "?");

const res = await client.readResource({ uri: "osha://data/first-aid-treatments" });
const parsed = JSON.parse(res.contents[0].text);
console.log("RESOURCE first-aid entries:", parsed.treatments.length);

// Render the prompt.
const prompt = await client.getPrompt({
  name: "triage_incident",
  arguments: { incident_description: "Worker cut hand, needed 3 stitches." },
});
console.log("PROMPT renders messages:", prompt.messages.length);

await client.close();

// ---------------------------------------------------------------------------
// Second connection, this time as a client that advertises NO elicitation
// capability — what Claude Desktop actually does. The server must fall back to
// returning the question for the model to ask, not guess and not error.
// ---------------------------------------------------------------------------
const plain = new Client({ name: "smoke-no-elicit", version: "0.0.0" }, { capabilities: {} });
await plain.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));

const ambiguous = { work_related: true, new_case: true, outcomes: [], significant_diagnoses: [], specific_case_criteria: [], plhcp_recommendations_not_followed: [] };
const pending = await plain.callTool({
  name: "osha_assess_recordability",
  arguments: { ...ambiguous, treatments: ["medication_unspecified_strength"] },
});
const pv = pending.structuredContent?.value;
assert(pending.isError !== true, "no-elicit call must not error");
assert(pv?.determination_final === false, "unresolved case must be marked non-final");
assert(pv?.clarification_required != null, "unresolved case must carry the question to ask");
assert(pv?.recordable === true, "unresolved case must stay conservative");
console.log("NO-ELICIT final:", pv.determination_final, "| question:", pv.clarification_required.question);

// The model answers and re-calls with the resolved code: loop closes, both ways.
for (const [code, expected] of [
  ["non_prescription_medication", false],
  ["prescription_strength_otc", true],
]) {
  const r = await plain.callTool({
    name: "osha_assess_recordability",
    arguments: { ...ambiguous, treatments: [code] },
  });
  const v = r.structuredContent?.value;
  assert(v?.recordable === expected, `${code} should be recordable=${expected}`);
  assert(v?.determination_final === true, `${code} should be final`);
  assert(v?.clarification_required === null, `${code} should need no clarification`);
  console.log(`RECALL ${code}: recordable=${v.recordable} final=${v.determination_final}`);
}

await plain.close();
console.log("\nSMOKE OK");

/**
 * Asserts that a condition is true, otherwise logs a failure and exits.
 *
 * @param {boolean} cond The condition to verify.
 * @param {string} msg The error message to display on failure.
 */
function assert(cond, msg) {
  if (!cond) {
    console.error("SMOKE FAILED:", msg);
    process.exit(1);
  }
}
