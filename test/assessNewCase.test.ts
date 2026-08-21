/**
 * Test suite for the `assessNewCase` tool (29 CFR § 1904.6).
 * Validates the deterministic logic used to distinguish a new recordable injury/illness
 * from a continuation of a previously recorded case, including Physician or Other Licensed
 * Health Care Professional (PLHCP) overrides and causation edge cases.
 */
import { assessNewCase } from "../src/tools/assessNewCase.js";

const base = {
  prior_recorded_same_type_same_body_part: true,
  plhcp_opinion: "none" as const,
  workplace_event_caused_current_symptoms: false,
  recovered_completely_from_prior: false,
  chronic_recurs_without_workplace_exposure: false,
  causation_is_clear: true,
};

describe("assess_new_case — 1904.6(a) basic requirement", () => {
  test("no prior recorded case of the same type on the same body part is a new case", () => {
    const r = assessNewCase({ ...base, prior_recorded_same_type_same_body_part: false });
    expect(r.value.verdict).toBe("new_case");
    expect(r.value.new_case).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.6(a)(1)");
  });

  test("full recovery plus a workplace event that revived symptoms is a new case", () => {
    const r = assessNewCase({
      ...base,
      recovered_completely_from_prior: true,
      workplace_event_caused_current_symptoms: true,
    });
    expect(r.value.verdict).toBe("new_case");
    expect(r.value.cfr_cites).toContain("1904.6(a)(2)");
  });

  test("continuing symptoms with no new workplace event is a continuation", () => {
    const r = assessNewCase(base);
    expect(r.value.verdict).toBe("not_new_case");
    expect(r.value.new_case).toBe(false);
    expect(r.value.log_action).toMatch(/Update the existing entry/i);
  });
});

// The pair the regulation deliberately splits: a recurrence CAUSED by workplace
// exposure is a new case; a chronic illness recurring WITHOUT exposure is not.
describe("assess_new_case — recurrence: caused by work, or not", () => {
  test("an occupational asthma episode from a workplace exposure is a new case", () => {
    const r = assessNewCase({ ...base, workplace_event_caused_current_symptoms: true });
    expect(r.value.verdict).toBe("new_case");
    expect(r.value.cfr_cites).toContain("1904.6(b)(2)");
    expect(r.value.log_action).toMatch(/Create a new entry/i);
  });

  test("a chronic illness recurring without exposure is recorded once only", () => {
    const r = assessNewCase({ ...base, chronic_recurs_without_workplace_exposure: true });
    expect(r.value.verdict).toBe("not_new_case");
    expect(r.value.cfr_cites).toContain("1904.6(b)(1)");
  });

  test("a workplace exposure outranks the chronic-illness rule", () => {
    // (b)(2) is checked first: the exposure decides, not the chronicity.
    const r = assessNewCase({
      ...base,
      chronic_recurs_without_workplace_exposure: true,
      workplace_event_caused_current_symptoms: true,
    });
    expect(r.value.verdict).toBe("new_case");
    expect(r.value.cfr_cites).toContain("1904.6(b)(2)");
  });
});

// 1904.6(b)(3): advice is optional, but binding once sought. This is the only place
// in the server where an outside authority outranks the rule engine.
describe("assess_new_case — the PLHCP override (1904.6(b)(3))", () => {
  test("a PLHCP 'new case' recommendation binds even against a continuation pattern", () => {
    const r = assessNewCase({ ...base, plhcp_opinion: "new_case" });
    expect(r.value.verdict).toBe("new_case");
    expect(r.value.decided_by_plhcp).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.6(b)(3)");
  });

  test("a PLHCP 'recurrence' recommendation binds even with no prior recorded case", () => {
    const r = assessNewCase({
      ...base,
      prior_recorded_same_type_same_body_part: false,
      plhcp_opinion: "recurrence",
    });
    expect(r.value.verdict).toBe("not_new_case");
    expect(r.value.decided_by_plhcp).toBe(true);
  });

  test("a PLHCP recommendation overrides a workplace-exposure episode", () => {
    const r = assessNewCase({
      ...base,
      workplace_event_caused_current_symptoms: true,
      plhcp_opinion: "recurrence",
    });
    expect(r.value.verdict).toBe("not_new_case");
    expect(r.value.applied_test).toBeNull();
  });

  test("conflicting recommendations are the employer's call, not the tool's", () => {
    const r = assessNewCase({ ...base, plhcp_opinion: "conflicting" });
    expect(r.value.verdict).toBe("requires_judgment");
    expect(r.value.new_case).toBeNull();
    expect(r.value.judgment_required?.cfr_cite).toBe("1904.6(b)(3)");
    expect(r.value.judgment_required?.question).toMatch(/most authoritative/i);
  });

  test("no opinion sought leaves the rule logic in charge", () => {
    const r = assessNewCase({ ...base, prior_recorded_same_type_same_body_part: false });
    expect(r.value.decided_by_plhcp).toBe(false);
  });
});

describe("assess_new_case — where causation is unestablished", () => {
  test("unclear causation returns requires_judgment, never a boolean", () => {
    const r = assessNewCase({ ...base, causation_is_clear: false });
    expect(r.value.verdict).toBe("requires_judgment");
    expect(r.value.new_case).toBeNull();
    expect(r.value.judgment_required?.cfr_cite).toBe("1904.6(b)(2)");
  });

  test("unclear causation does not block the no-prior-case shortcut", () => {
    // Nothing to continue from, so causation never matters.
    const r = assessNewCase({
      ...base,
      prior_recorded_same_type_same_body_part: false,
      causation_is_clear: false,
    });
    expect(r.value.verdict).toBe("new_case");
  });

  test("every determination carries provenance", () => {
    const r = assessNewCase(base);
    expect(r.source_url).toMatch(/ecfr\.gov/);
    expect(r.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});