/**
 * Test suite for the `checkSevereInjuryReporting` tool (29 CFR § 1904.39).
 * Validates severe injury reporting clocks (8h and 24h), outcome types (fatality, hospitalization,
 * amputation, eye loss), eligibility windows, public road exclusions, and remaining time.
 */
import { checkSevereInjuryReporting } from "../src/tools/checkSevereInjuryReporting.js";

type Input = Parameters<typeof checkSevereInjuryReporting>[0];

/**
 * zod `.default()` fields are optional at the call site but REQUIRED in the
 * inferred type, so every new defaulted input would otherwise churn every fixture
 * here. Build inputs through this instead.
 */
const input = (over: Partial<Input> = {}): Input => ({
  outcome: "none",
  incident_datetime: "2026-07-25T09:00:00Z",
  learned_datetime: "2026-07-25T10:00:00Z",
  amputation_kind: "not_applicable",
  hospitalization_for_observation_or_diagnostics_only: false,
  reporting_exclusion: "none",
  ...over,
});

describe("check_severe_injury_reporting — 1904.39 clock", () => {
  test("no severe outcome → not reportable", () => {
    const r = checkSevereInjuryReporting(
      input({
      outcome: "none",
      incident_datetime: "2026-07-25T09:40:00Z",
      learned_datetime: "2026-07-25T09:40:00Z",
      })
    );
    expect(r.value.reportable).toBe(false);
    expect(r.value.deadline_iso).toBeNull();
  });

  test("fatality → 8-hour deadline from learning", () => {
    const r = checkSevereInjuryReporting(
      input({
      outcome: "fatality",
      incident_datetime: "2026-07-25T09:00:00Z",
      learned_datetime: "2026-07-25T10:00:00Z",
      outcome_datetime: "2026-07-25T09:30:00Z",
      })
    );
    expect(r.value.reportable).toBe(true);
    expect(r.value.deadline_iso).toBe("2026-07-25T18:00:00.000Z");
    expect(r.cfr_cite).toBe("1904.39(a)(1)");
  });

  test("hospitalization → 24-hour deadline", () => {
    const r = checkSevereInjuryReporting(
      input({
      outcome: "in_patient_hospitalization",
      incident_datetime: "2026-07-25T09:00:00Z",
      learned_datetime: "2026-07-25T09:00:00Z",
      outcome_datetime: "2026-07-25T15:00:00Z",
      })
    );
    expect(r.value.reportable).toBe(true);
    expect(r.value.deadline_iso).toBe("2026-07-26T09:00:00.000Z");
  });

  test("fatality outside 30-day window → not reportable", () => {
    const r = checkSevereInjuryReporting(
      input({
      outcome: "fatality",
      incident_datetime: "2026-01-01T09:00:00Z",
      learned_datetime: "2026-03-01T09:00:00Z",
      outcome_datetime: "2026-02-15T09:00:00Z",
      })
    );
    expect(r.value.reportable).toBe(false);
    expect(r.value.eligibility_note).toMatch(/outside/);
  });

  test("amputation outside 24-hour window → not reportable", () => {
    const r = checkSevereInjuryReporting(
      input({
      outcome: "amputation",
      incident_datetime: "2026-07-25T09:00:00Z",
      learned_datetime: "2026-07-27T09:00:00Z",
      outcome_datetime: "2026-07-27T09:00:00Z",
      })
    );
    expect(r.value.reportable).toBe(false);
  });

  test("missing outcome_datetime → cannot verify window, note says so", () => {
    const r = checkSevereInjuryReporting(
      input({
      outcome: "loss_of_an_eye",
      incident_datetime: "2026-07-25T09:00:00Z",
      learned_datetime: "2026-07-25T09:00:00Z",
      })
    );
    expect(r.value.eligibility_note).toMatch(/not verified/);
    expect(r.value.reporting_methods.length).toBeGreaterThan(0);
  });
});

// The clock is injected, so the most consequential number this server produces —
// "is the 8-hour fatality deadline already blown?" — is finally testable.
describe("check_severe_injury_reporting — the deadline clock", () => {
  const fatality = input({
    outcome: "fatality",
    outcome_datetime: "2026-07-25T09:30:00Z",
  });

  test("counts down the hours remaining before the deadline", () => {
    // Deadline is 18:00Z; ask at 14:00Z → 4 hours left.
    const r = checkSevereInjuryReporting(fatality, Date.parse("2026-07-25T14:00:00Z"));
    expect(r.value.hours_remaining).toBe(4);
    expect(r.value.overdue).toBe(false);
  });

  test("flags overdue once the deadline has passed", () => {
    const r = checkSevereInjuryReporting(fatality, Date.parse("2026-07-25T20:30:00Z"));
    expect(r.value.overdue).toBe(true);
    expect(r.value.hours_remaining).toBeLessThan(0);
  });

  test("is not overdue in the final minutes before the deadline", () => {
    const r = checkSevereInjuryReporting(fatality, Date.parse("2026-07-25T17:59:00Z"));
    expect(r.value.overdue).toBe(false);
  });

  test("24-hour outcomes get 24 hours, not 8", () => {
    const r = checkSevereInjuryReporting(
      input({
        outcome: "amputation",
        learned_datetime: "2026-07-25T09:00:00Z",
        outcome_datetime: "2026-07-25T10:00:00Z",
      }),
      Date.parse("2026-07-25T09:00:00Z")
    );
    expect(r.value.hours_remaining).toBe(24);
  });
});

// A malformed datetime used to throw RangeError out of the tool. It must instead
// return the obligation that still stands, and say what to fix.
describe("check_severe_injury_reporting — malformed datetimes", () => {
  test("does not throw on unparseable input", () => {
    expect(() =>
      checkSevereInjuryReporting(
        input({
          outcome: "fatality",
          incident_datetime: "yesterday",
          learned_datetime: "this morning",
        })
      )
    ).not.toThrow();
  });

  test("names the offending fields and still states the obligation", () => {
    const r = checkSevereInjuryReporting(
      input({
      outcome: "fatality",
      incident_datetime: "yesterday",
      learned_datetime: "this morning",
      })
    );
    expect(r.value.input_error).toMatch(/incident_datetime/);
    expect(r.value.input_error).toMatch(/learned_datetime/);
    expect(r.value.input_error).toMatch(/ISO 8601/);
    expect(r.value.deadline_iso).toBeNull();
    // The user still owes OSHA a call — the tool must not imply otherwise.
    expect(r.value.eligibility_note).toMatch(/8 hours/);
    expect(r.cfr_cite).toBe("1904.39(a)(1)");
  });

  test("a single bad field is identified on its own", () => {
    const r = checkSevereInjuryReporting(
      input({
      outcome: "amputation",
      incident_datetime: "2026-07-25T09:00:00Z",
      learned_datetime: "2026-07-25T10:00:00Z",
      outcome_datetime: "sometime Tuesday",
      })
    );
    expect(r.value.input_error).toMatch(/outcome_datetime/);
    expect(r.value.input_error).not.toMatch(/incident_datetime/);
  });

  test("valid input reports no error", () => {
    const r = checkSevereInjuryReporting(
      input({ outcome: "fatality" }),
      Date.parse("2026-07-25T11:00:00Z")
    );
    expect(r.value.input_error).toBeNull();
  });
});

// 1904.39(b)(9)-(b)(11) and (b)(3)-(b)(4): four ways an obviously severe event is
// NOT reportable. Every one of them still leaves the case recordable.
describe("check_severe_injury_reporting — definitions and exclusions", () => {
  const at = (o: Partial<Input>) =>
    input({ outcome_datetime: "2026-07-25T09:30:00Z", ...o });

  test.each([
    ["avulsion", "1904.39(b)(11)"],
    ["enucleation", "1904.39(b)(11)"],
    ["degloving", "1904.39(b)(11)"],
    ["scalping", "1904.39(b)(11)"],
    ["severed_ear", "1904.39(b)(11)"],
    ["broken_or_chipped_tooth", "1904.39(b)(11)"],
  ])("%s is not an amputation under the definition", (kind, cite) => {
    const r = checkSevereInjuryReporting(
      at({ outcome: "amputation", amputation_kind: kind })
    );
    expect(r.value.reportable).toBe(false);
    expect(r.cfr_cite).toBe(cite);
    expect(r.value.still_recordable).toBe(true);
  });

  test.each([
    ["severed_or_cut_off"],
    ["fingertip_amputation"],
    ["medical_amputation"],
    ["reattached_part"],
  ])("%s IS an amputation and stays reportable", (kind) => {
    const r = checkSevereInjuryReporting(
      at({ outcome: "amputation", amputation_kind: kind })
    );
    expect(r.value.reportable).toBe(true);
  });

  test("a hospitalization for observation or diagnostics only is not reportable", () => {
    const r = checkSevereInjuryReporting(
      at({
        outcome: "in_patient_hospitalization",
        hospitalization_for_observation_or_diagnostics_only: true,
      })
    );
    expect(r.value.reportable).toBe(false);
    expect(r.cfr_cite).toBe("1904.39(b)(10)");
    expect(r.value.still_recordable).toBe(true);
  });

  test("an admission for care or treatment is reportable", () => {
    const r = checkSevereInjuryReporting(at({ outcome: "in_patient_hospitalization" }));
    expect(r.value.reportable).toBe(true);
  });

  test.each([
    ["public_road_motor_vehicle_not_in_work_zone", "1904.39(b)(3)"],
    ["commercial_or_public_transportation", "1904.39(b)(4)"],
  ])("%s defeats reporting but not recording (%s)", (exclusion, cite) => {
    const r = checkSevereInjuryReporting(
      at({ outcome: "fatality", reporting_exclusion: exclusion })
    );
    expect(r.value.reportable).toBe(false);
    expect(r.cfr_cite).toBe(cite);
    expect(r.value.still_recordable).toBe(true);
    expect(r.value.eligibility_note).toMatch(/still be recorded/i);
  });

  test("a public-road fatality IN a construction work zone stays reportable", () => {
    // (b)(3) excludes only accidents outside a work zone — the caller passes 'none'.
    const r = checkSevereInjuryReporting(
      at({ outcome: "fatality", reporting_exclusion: "none" })
    );
    expect(r.value.reportable).toBe(true);
  });

  test("a reportable event lists the eight things OSHA asks for", () => {
    const r = checkSevereInjuryReporting(at({ outcome: "fatality" }));
    expect(r.value.required_information).toHaveLength(8);
    expect(r.value.required_information.join(" ")).toMatch(/establishment name/i);
    expect(r.value.required_information.join(" ")).toMatch(/brief description/i);
  });
});
