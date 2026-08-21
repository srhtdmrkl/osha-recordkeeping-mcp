/**
 * Test suite for the `evaluateRestrictedWork` tool (29 CFR § 1904.7(b)(4)).
 * Validates restricted work criteria (routine functions, partial shifts, job transfers),
 * day-of-injury exclusions, and unclarified vague restriction defaults.
 */
import { evaluateRestrictedWork } from "../src/tools/evaluateRestrictedWork.js";

const base = {
  restriction_applies_beyond_day_of_injury: true,
  keeps_from_routine_function_or_full_shift: true,
  worked_partial_shift: false,
  transferred_to_another_job: false,
  reduced_output_only: false,
  restriction_is_vague: false,
  vague_restriction_clarified: false,
};

describe("evaluate_restricted_work — what counts", () => {
  test("kept from a routine function or the full shift is restricted work", () => {
    const r = evaluateRestrictedWork(base);
    expect(r.value.restricted_work).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.7(b)(4)(i)");
  });

  test("a partial shift counts as a day of restriction", () => {
    const r = evaluateRestrictedWork({
      ...base,
      keeps_from_routine_function_or_full_shift: false,
      worked_partial_shift: true,
    });
    expect(r.value.restricted_work).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.7(b)(4)(v)");
  });

  test("a job transfer counts and shares the restriction column", () => {
    const r = evaluateRestrictedWork({
      ...base,
      keeps_from_routine_function_or_full_shift: false,
      transferred_to_another_job: true,
    });
    expect(r.value.restricted_work).toBe(true);
    expect(r.value.log_note).toMatch(/same column|share/i);
  });
});

describe("evaluate_restricted_work — what does not count", () => {
  test("a restriction confined to the day of injury is not recordable", () => {
    const r = evaluateRestrictedWork({
      ...base,
      restriction_applies_beyond_day_of_injury: false,
    });
    expect(r.value.restricted_work).toBe(false);
    expect(r.value.cfr_cites).toContain("1904.7(b)(4)(iii)");
  });

  test("the day-of-injury rule outranks everything else", () => {
    // Even a vague unclarifiable restriction cannot revive a day-of-injury-only case.
    const r = evaluateRestrictedWork({
      ...base,
      restriction_applies_beyond_day_of_injury: false,
      restriction_is_vague: true,
      vague_restriction_clarified: false,
      worked_partial_shift: true,
    });
    expect(r.value.restricted_work).toBe(false);
    expect(r.value.applied_test).toBe("day_of_injury_only");
  });

  test("reduced output while doing all routine functions is not restricted work", () => {
    const r = evaluateRestrictedWork({
      ...base,
      keeps_from_routine_function_or_full_shift: false,
      reduced_output_only: true,
    });
    expect(r.value.restricted_work).toBe(false);
    expect(r.value.cfr_cites).toContain("1904.7(b)(4)(vi)");
  });

  test("a restriction that misses every routine function is not recordable", () => {
    const r = evaluateRestrictedWork({
      ...base,
      keeps_from_routine_function_or_full_shift: false,
    });
    expect(r.value.restricted_work).toBe(false);
    expect(r.value.cfr_cites).toContain("1904.7(b)(4)(iv)");
    expect(r.value.basis).toMatch(/at least once per week/i);
  });
});

// 1904.7(b)(4)(vii) is the regulation resolving its own doubt toward recording.
describe("evaluate_restricted_work — the vague-restriction default", () => {
  test("'light duty' that cannot be clarified MUST be recorded", () => {
    const r = evaluateRestrictedWork({
      ...base,
      keeps_from_routine_function_or_full_shift: false,
      restriction_is_vague: true,
      vague_restriction_clarified: false,
    });
    expect(r.value.restricted_work).toBe(true);
    expect(r.value.recorded_by_default).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.7(b)(4)(vii)");
  });

  test("once clarified, the ordinary tests decide", () => {
    const r = evaluateRestrictedWork({
      ...base,
      keeps_from_routine_function_or_full_shift: false,
      restriction_is_vague: true,
      vague_restriction_clarified: true,
    });
    expect(r.value.restricted_work).toBe(false);
    expect(r.value.recorded_by_default).toBe(false);
  });

  test("a clear restriction never triggers the default", () => {
    const r = evaluateRestrictedWork(base);
    expect(r.value.recorded_by_default).toBe(false);
  });

  test("carries provenance", () => {
    const r = evaluateRestrictedWork(base);
    expect(r.source_url).toMatch(/ecfr\.gov/);
    expect(r.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
