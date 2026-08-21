/**
 * Test suite for the `assessWorkRelatedness` tool (29 CFR § 1904.5).
 * Validates work-relatedness presumptions, the nine closed exceptions, parking lot/commuting rules,
 * mental illness, and pre-existing condition aggravation tests.
 */
import { assessWorkRelatedness } from "../src/tools/assessWorkRelatedness.js";

const base = {
  occurred_in_work_environment: true,
  origin_is_clear: true,
  claimed_exception: "none",
  exception_solely_established: false,
  pre_existing_condition: false,
  aggravation_tests_met: [] as string[],
  mental_illness_plhcp_opinion_volunteered: false,
  special_situation: "none" as const,
};

describe("assess_work_relatedness — the 1904.5(a) presumption", () => {
  test("in the work environment with no exception claimed is work-related", () => {
    const r = assessWorkRelatedness(base);
    expect(r.value.verdict).toBe("work_related");
    expect(r.value.work_related).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.5(a)");
  });

  test("outside the work environment the presumption never attaches", () => {
    const r = assessWorkRelatedness({ ...base, occurred_in_work_environment: false });
    expect(r.value.verdict).toBe("not_work_related");
    expect(r.value.work_related).toBe(false);
  });
});

describe("assess_work_relatedness — the closed (b)(2) exceptions", () => {
  test.each([
    ["member_of_general_public", "1904.5(b)(2)(i)"],
    ["symptoms_surface_at_work_only", "1904.5(b)(2)(ii)"],
    ["voluntary_wellness_or_recreation", "1904.5(b)(2)(iii)"],
    ["personal_food_or_drink", "1904.5(b)(2)(iv)"],
    ["personal_tasks_outside_working_hours", "1904.5(b)(2)(v)"],
    ["personal_grooming_self_medication_or_self_inflicted", "1904.5(b)(2)(vi)"],
    ["commuting_motor_vehicle_on_company_lot", "1904.5(b)(2)(vii)"],
    ["common_cold_or_flu", "1904.5(b)(2)(viii)"],
  ])("%s defeats the presumption once 'solely' is established, cited to %s", (code, cite) => {
    const r = assessWorkRelatedness({
      ...base,
      claimed_exception: code,
      exception_solely_established: true,
    });
    expect(r.value.verdict).toBe("not_work_related");
    expect(r.value.applied_exception).toBe(code);
    expect(r.value.cfr_cites).toContain(cite);
  });

  test("an exception claimed but not established as 'solely' is not applied", () => {
    // The presumption stands until the factual finding is made. Applying the
    // exception on an unverified claim is the under-recording direction.
    const r = assessWorkRelatedness({
      ...base,
      claimed_exception: "personal_food_or_drink",
      exception_solely_established: false,
    });
    expect(r.value.verdict).toBe("requires_judgment");
    expect(r.value.work_related).toBeNull();
    expect(r.value.judgment_required?.question).toMatch(/SOLELY/);
  });
});

// The distinction the regulation draws and memory does not: (b)(2)(vii) covers a
// MOTOR VEHICLE accident while COMMUTING. A fall in the same lot is work-related.
describe("assess_work_relatedness — the parking-lot split", () => {
  test("a commuting motor-vehicle accident on the company lot is excepted", () => {
    const r = assessWorkRelatedness({
      ...base,
      claimed_exception: "commuting_motor_vehicle_on_company_lot",
      exception_solely_established: true,
    });
    expect(r.value.verdict).toBe("not_work_related");
    expect(r.value.cfr_cites).toContain("1904.5(b)(2)(vii)");
  });

  test("a slip and fall in the same parking lot stays work-related", () => {
    // No exception covers it, so the 1904.5(a) presumption governs.
    const r = assessWorkRelatedness({ ...base, claimed_exception: "none" });
    expect(r.value.verdict).toBe("work_related");
  });
});

describe("assess_work_relatedness — mental illness runs the other way", () => {
  test("not work-related without a volunteered PLHCP opinion", () => {
    const r = assessWorkRelatedness({
      ...base,
      claimed_exception: "mental_illness_without_plhcp_opinion",
    });
    expect(r.value.verdict).toBe("not_work_related");
    expect(r.value.cfr_cites).toContain("1904.5(b)(2)(ix)");
  });

  test("work-related once the employee volunteers a PLHCP opinion", () => {
    const r = assessWorkRelatedness({
      ...base,
      claimed_exception: "mental_illness_without_plhcp_opinion",
      mental_illness_plhcp_opinion_volunteered: true,
    });
    expect(r.value.verdict).toBe("work_related");
  });

  test("mental illness does not need the 'solely' finding — the rule is inverted", () => {
    const r = assessWorkRelatedness({
      ...base,
      claimed_exception: "mental_illness_without_plhcp_opinion",
      exception_solely_established: false,
    });
    expect(r.value.verdict).not.toBe("requires_judgment");
  });
});

describe("assess_work_relatedness — pre-existing conditions (1904.5(b)(4))", () => {
  test("a pre-existing condition with no aggravation test met is not work-related", () => {
    const r = assessWorkRelatedness({ ...base, pre_existing_condition: true });
    expect(r.value.verdict).toBe("not_work_related");
    expect(r.value.cfr_cites).toContain("1904.5(b)(4)");
  });

  test.each([
    ["death_but_for_work_event", "1904.5(b)(4)(i)"],
    ["loss_of_consciousness_but_for_work_event", "1904.5(b)(4)(ii)"],
    ["days_away_restriction_or_transfer_but_for_work_event", "1904.5(b)(4)(iii)"],
    ["medical_treatment_needed_or_changed", "1904.5(b)(4)(iv)"],
  ])("%s significantly aggravates, cited to %s", (test_, cite) => {
    const r = assessWorkRelatedness({
      ...base,
      pre_existing_condition: true,
      aggravation_tests_met: [test_],
    });
    expect(r.value.verdict).toBe("work_related");
    expect(r.value.cfr_cites).toContain(cite);
  });
});

describe("assess_work_relatedness — where the rule defers to judgment", () => {
  test("unclear origin returns requires_judgment, citing 1904.5(b)(3)", () => {
    const r = assessWorkRelatedness({ ...base, origin_is_clear: false });
    expect(r.value.verdict).toBe("requires_judgment");
    expect(r.value.work_related).toBeNull();
    expect(r.value.judgment_required?.cfr_cite).toBe("1904.5(b)(3)");
  });

  test("travel status returns the governing test rather than a verdict", () => {
    const r = assessWorkRelatedness({ ...base, special_situation: "travel_status" });
    expect(r.value.verdict).toBe("requires_judgment");
    expect(r.value.judgment_required?.cfr_cite).toBe("1904.5(b)(6)");
    expect(r.value.basis).toMatch(/home away from home/i);
  });

  test("working at home returns the governing test rather than a verdict", () => {
    const r = assessWorkRelatedness({ ...base, special_situation: "working_at_home" });
    expect(r.value.verdict).toBe("requires_judgment");
    expect(r.value.judgment_required?.cfr_cite).toBe("1904.5(b)(7)");
  });

  test("requires_judgment never yields a usable boolean", () => {
    for (const input of [
      { ...base, origin_is_clear: false },
      { ...base, special_situation: "travel_status" as const },
      { ...base, claimed_exception: "common_cold_or_flu", exception_solely_established: false },
    ]) {
      const r = assessWorkRelatedness(input);
      expect(r.value.verdict).toBe("requires_judgment");
      expect(r.value.work_related).toBeNull();
    }
  });

  test("every determination carries provenance", () => {
    const r = assessWorkRelatedness(base);
    expect(r.source_url).toMatch(/ecfr\.gov/);
    expect(r.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
