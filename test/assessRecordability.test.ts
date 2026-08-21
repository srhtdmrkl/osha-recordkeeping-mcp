/**
 * Test suite for the `assessRecordability` tool (29 CFR § 1904.4 / § 1904.7).
 * Validates the core OSHA recordability decision logic (work-relatedness, new case status,
 * outcomes, significant diagnoses, medical treatments, and specific-case criteria),
 * including the closed first-aid treatment checklist.
 */
import { assessRecordability } from "../src/tools/assessRecordability.js";
import { loadDataset } from "../src/datasets.js";

const base = {
  specific_case_criteria: [] as any[],
  plhcp_recommendations_not_followed: [] as any[],
  medical_removal_was_voluntary_and_early: false,
  tuberculosis_test_was_pre_employment: false,
  work_related: true,
  new_case: true,
  outcomes: [] as any[],
  significant_diagnoses: [] as any[],
  treatments: [] as any[],
};

describe("assess_recordability — deterministic 1904.7 logic", () => {
  test("not work-related → not recordable", () => {
    const r = assessRecordability({ ...base, work_related: false });
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/1904.5/);
  });

  test("not a new case → not recordable", () => {
    const r = assessRecordability({ ...base, new_case: false });
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/1904.6/);
  });

  test("first-aid only (bandage + ice) → not recordable", () => {
    const r = assessRecordability({
      ...base,
      treatments: ["wound_covering", "hot_or_cold_therapy"],
    });
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/first-aid list/);
  });

  test("sutures → recordable (medical treatment beyond first aid)", () => {
    const r = assessRecordability({ ...base, treatments: ["sutures_or_staples"] });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.7(b)(5)(i)");
  });

  test("prescription medication → recordable even alongside first aid", () => {
    const r = assessRecordability({
      ...base,
      treatments: ["wound_covering", "prescription_medication"],
    });
    expect(r.value.recordable).toBe(true);
  });

  test("days away from work → recordable", () => {
    const r = assessRecordability({ ...base, outcomes: ["days_away_from_work"] });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.7(b)(3)");
  });

  test("fractured bone with only first aid → recordable (1904.7(b)(7))", () => {
    const r = assessRecordability({
      ...base,
      significant_diagnoses: ["fractured_or_cracked_bone"],
      treatments: ["wound_covering"],
    });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.7(b)(7)");
  });

  test("fatality → recordable + 1904.39 reporting note", () => {
    const r = assessRecordability({ ...base, outcomes: ["death"] });
    expect(r.value.recordable).toBe(true);
    expect(r.value.severe_injury_reporting_note).toMatch(/1904.39/);
  });

  test("simple first aid carries no severe-reporting note", () => {
    const r = assessRecordability({ ...base, treatments: ["wound_covering"] });
    expect(r.value.severe_injury_reporting_note).toBeNull();
  });

  test("unresolved medication strength → recordable pending confirmation", () => {
    // The handler normally resolves this via elicitation; if it reaches the pure
    // function unresolved, it must be conservatively recordable, not a silent guess.
    const r = assessRecordability({ ...base, treatments: ["medication_unspecified_strength"] });
    expect(r.value.recordable).toBe(true);
    expect(r.value.basis).toMatch(/pending confirmation/);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.7(b)(5)(ii)(A)");
  });

  test("every determination carries provenance", () => {
    const r = assessRecordability(base);
    // 1904.4 is the master recording rule; 1904.7 is one branch of 1904.4(a)(3).
    expect(r.cfr_cite).toBe("1904.4");
    expect(r.source_url).toMatch(/ecfr\.gov/);
    expect(r.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// Regression: a real Claude Code session defaulted the unknown fields to empty on a
// two-finger amputation and got back a confident, cited "not recordable". Empty input
// and an affirmative "none" produce the same answer, so the tool must say which
// assumption it is resting on rather than presenting a clean negative.
describe("assess_recordability — asserted nothing vs asserted none", () => {
  const empty = {
    work_related: true,
    new_case: true,
    outcomes: [],
    significant_diagnoses: [],
    specific_case_criteria: [],
    plhcp_recommendations_not_followed: [],
    medical_removal_was_voluntary_and_early: false,
  tuberculosis_test_was_pre_employment: false,
    treatments: [],
  };

  test("nothing asserted is flagged under_specified", () => {
    const r = assessRecordability(empty);
    expect(r.value.under_specified).toBe(true);
    expect(r.value.recordable).toBe(false);
  });

  test("the basis warns it may be a false negative instead of reading as settled", () => {
    const r = assessRecordability(empty);
    expect(r.value.basis).toMatch(/nothing was asserted/i);
    expect(r.value.basis).toMatch(/false negative/i);
    // Must NOT claim the closed-list test was actually applied to any treatment.
    expect(r.value.basis).not.toMatch(/all treatment given is on the closed first-aid list/);
  });

  test("first-aid-only is a settled negative, not under_specified", () => {
    const r = assessRecordability({ ...empty, treatments: ["wound_covering"] });
    expect(r.value.under_specified).toBe(false);
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/closed first-aid list/);
  });

  test("any asserted signal clears the flag", () => {
    for (const input of [
      { ...empty, outcomes: ["days_away_from_work"] },
      { ...empty, significant_diagnoses: ["fractured_or_cracked_bone"] },
      { ...empty, treatments: ["sutures_or_staples"] },
    ]) {
      expect(assessRecordability(input as never).value.under_specified).toBe(false);
    }
  });

  test("a non-work-related case is settled regardless of empty signals", () => {
    // The 1904.5 gate decided it; the empty arrays never came into play.
    const r = assessRecordability({ ...empty, work_related: false });
    expect(r.value.under_specified).toBe(false);
  });
});

// 1904.4(a)(3) is a disjunction — the general criteria of 1904.7 OR the specific
// cases of 1904.8-1904.12. Before these existed, a contaminated needlestick treated
// with cleaning and a bandage came back "not recordable" with a citation attached.
describe("assess_recordability — specific cases (1904.8-1904.12)", () => {
  test.each([
    ["contaminated_needlestick_or_sharps", "1904.8"],
    ["medical_removal", "1904.9"],
    ["occupational_hearing_loss_sts", "1904.10"],
    ["tuberculosis_infection", "1904.11"],
  ])("%s is recordable on its own, cited to %s", (criterion, cite) => {
    const r = assessRecordability({ ...base, specific_case_criteria: [criterion] });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe(cite);
  });

  test("a needlestick treated with first aid only is still recordable", () => {
    // The regression that motivated this whole branch.
    const r = assessRecordability({
      ...base,
      specific_case_criteria: ["contaminated_needlestick_or_sharps"],
      treatments: ["wound_cleaning", "wound_covering"],
    });
    expect(r.value.recordable).toBe(true);
    expect(r.value.basis).toMatch(/1904\.8/);
    expect(r.value.basis).not.toMatch(/closed first-aid list/);
  });

  test("specific cases outrank the first-aid list even with no treatment at all", () => {
    const r = assessRecordability({ ...base, specific_case_criteria: ["tuberculosis_infection"] });
    expect(r.value.recordable).toBe(true);
    expect(r.value.under_specified).toBe(false);
  });

  test("multiple criteria are all reported, first one drives the basis", () => {
    const r = assessRecordability({
      ...base,
      specific_case_criteria: ["contaminated_needlestick_or_sharps", "tuberculosis_infection"],
    });
    expect(r.value.triggering_factors).toHaveLength(2);
    expect(r.value.basis).toMatch(/1904\.8/);
    expect(r.value.basis).toMatch(/1904\.11/);
  });

  test("a specific case is never gated by work-relatedness or new-case", () => {
    const r = assessRecordability({
      ...base,
      work_related: false,
      specific_case_criteria: ["contaminated_needlestick_or_sharps"],
    });
    // 1904.4(a) is a conjunction: work-relatedness still gates everything.
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/1904\.5/);
  });

  test("first-aid-only negative now says the specific cases were checked too", () => {
    const r = assessRecordability({ ...base, treatments: ["wound_covering"] });
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/1904\.8-1904\.12/);
  });

  test("the determination cites 1904.4, the master rule", () => {
    expect(assessRecordability(base).cfr_cite).toBe("1904.4");
  });
});

// The 1904.4(b)(2) decision tree does not stop at "not a new case" — it routes to
// updating the entry that already exists.
describe("assess_recordability — continuation of a prior case", () => {
  test("directs the user to update the existing entry, not to do nothing", () => {
    const r = assessRecordability({ ...base, new_case: false, treatments: ["sutures_or_staples"] });
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/UPDATE the existing entry/);
    expect(r.value.basis).toMatch(/1904\.6/);
  });
});

// 1904.7(b)(5)(i): observation, counselling and diagnostics are expressly NOT
// medical treatment. Without codes for them a model has nowhere to put "went to
// the clinic, they took an x-ray" but other_medical_treatment — over-recording.
describe("assess_recordability — medical-treatment exclusions (1904.7(b)(5)(i))", () => {
  test("a clinic visit purely for observation does not make a case recordable", () => {
    const r = assessRecordability({ ...base, treatments: ["observation_or_counseling_only"] });
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/1904\.7\(b\)\(5\)\(i\)/);
  });

  test("an x-ray does not make a case recordable", () => {
    const r = assessRecordability({ ...base, treatments: ["diagnostic_procedure_only"] });
    expect(r.value.recordable).toBe(false);
  });

  test("an excluded procedure alongside first aid is still not recordable", () => {
    const r = assessRecordability({
      ...base,
      treatments: ["diagnostic_procedure_only", "wound_covering", "hot_or_cold_therapy"],
    });
    expect(r.value.recordable).toBe(false);
  });

  test("an x-ray does not shield actual medical treatment given with it", () => {
    const r = assessRecordability({
      ...base,
      treatments: ["diagnostic_procedure_only", "sutures_or_staples"],
    });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.7(b)(5)(i)");
  });

  test("an excluded-only case is not flagged under_specified — something was asserted", () => {
    const r = assessRecordability({ ...base, treatments: ["diagnostic_procedure_only"] });
    expect(r.value.under_specified).toBe(false);
  });
});

// Three paragraphs say the same thing: record what was RECOMMENDED, not what the
// employee did. Each is a place managers under-record because "he came in anyway".
describe("assess_recordability — PLHCP recommendation not followed", () => {
  test.each([
    ["days_away_recommended_but_employee_worked", "1904.7(b)(3)(ii)"],
    ["restriction_recommended_but_employee_worked_normally", "1904.7(b)(4)(viii)"],
    ["medical_treatment_recommended_but_declined", "1904.7(b)(5)(v)"],
  ])("%s makes the case recordable, cited to %s", (code, cite) => {
    const r = assessRecordability({ ...base, plhcp_recommendations_not_followed: [code] });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe(cite);
  });

  test("recordable even though the only treatment given was first aid", () => {
    const r = assessRecordability({
      ...base,
      plhcp_recommendations_not_followed: ["medical_treatment_recommended_but_declined"],
      treatments: ["wound_covering"],
    });
    expect(r.value.recordable).toBe(true);
    expect(r.value.basis).not.toMatch(/closed first-aid list/);
  });
});

// 1904.8 has its own implementation rules. The one that bites: a splash with no
// cut is NOT recordable on this basis unless it produced a diagnosis (b)(4).
describe("assess_recordability — 1904.8 bloodborne rules", () => {
  test("a splash that produced a diagnosis is recordable as an illness", () => {
    const r = assessRecordability({
      ...base,
      specific_case_criteria: ["bloodborne_exposure_with_diagnosis"],
    });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.8(b)(4)(i)");
    expect(r.value.basis).toMatch(/illness, not an injury/i);
  });

  test("an exposure with no diagnosis and only first aid is not recordable", () => {
    // (b)(4)(ii): with no diagnosis it must independently meet a 1904.7 criterion.
    const r = assessRecordability({ ...base, treatments: ["wound_cleaning"] });
    expect(r.value.recordable).toBe(false);
  });

  test("a needlestick carries its 1904.8(a) log-entry consequences", () => {
    const r = assessRecordability({
      ...base,
      specific_case_criteria: ["contaminated_needlestick_or_sharps"],
    });
    expect(r.value.log_entry_notes).toHaveLength(1);
    expect(r.value.log_entry_notes[0]).toMatch(/name may NOT be entered/i);
    expect(r.value.log_entry_notes[0]).toMatch(/1904\.29\(b\)\(6\)-\(9\)/);
  });

  test("ordinary cases carry no log-entry notes", () => {
    const r = assessRecordability({ ...base, treatments: ["sutures_or_staples"] });
    expect(r.value.log_entry_notes).toHaveLength(0);
  });
});

// 1904.9(b)(3): an employer who pulls someone early, before the standard's removal
// levels are reached, is not penalised for it. Without this guard the tool records
// the case — a false positive that punishes caution.
describe("assess_recordability — voluntary early medical removal (1904.9(b)(3))", () => {
  test("removal under the standard's criteria is recordable", () => {
    const r = assessRecordability({ ...base, specific_case_criteria: ["medical_removal"] });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.9");
  });

  test("voluntary removal before those levels is NOT recordable", () => {
    const r = assessRecordability({
      ...base,
      specific_case_criteria: ["medical_removal"],
      medical_removal_was_voluntary_and_early: true,
    });
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/1904\.9\(b\)\(3\)/);
  });

  test("the voluntary answer is a determination, not an under-specified one", () => {
    const r = assessRecordability({
      ...base,
      specific_case_criteria: ["medical_removal"],
      medical_removal_was_voluntary_and_early: true,
    });
    expect(r.value.under_specified).toBe(false);
    expect(r.value.log_entry_notes).toHaveLength(0);
  });

  test("the guard touches only medical removal, not other criteria", () => {
    const r = assessRecordability({
      ...base,
      specific_case_criteria: ["medical_removal", "tuberculosis_infection"],
      medical_removal_was_voluntary_and_early: true,
    });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.11");
  });

  test("a recordable removal carries its 1904.9(b)(1) classification note", () => {
    const r = assessRecordability({ ...base, specific_case_criteria: ["medical_removal"] });
    expect(r.value.log_entry_notes[0]).toMatch(/days-away case or a restricted-work case/i);
    expect(r.value.log_entry_notes[0]).toMatch(/POISONING/);
  });
});

// 1904.11(b)(1): a positive skin test at a pre-employment physical is not an
// occupational exposure at all, so the criterion never attaches.
describe("assess_recordability — pre-employment TB test (1904.11(b)(1))", () => {
  test("occupational TB exposure with infection is recordable", () => {
    const r = assessRecordability({ ...base, specific_case_criteria: ["tuberculosis_infection"] });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.11");
  });

  test("a pre-employment positive test is NOT recordable", () => {
    const r = assessRecordability({
      ...base,
      specific_case_criteria: ["tuberculosis_infection"],
      tuberculosis_test_was_pre_employment: true,
    });
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/1904\.11\(b\)\(1\)/);
    expect(r.value.under_specified).toBe(false);
  });

  test("the guard touches only tuberculosis, not other criteria", () => {
    const r = assessRecordability({
      ...base,
      specific_case_criteria: ["tuberculosis_infection", "contaminated_needlestick_or_sharps"],
      tuberculosis_test_was_pre_employment: true,
    });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.8");
  });

  test("both guards can fire independently in one call", () => {
    const r = assessRecordability({
      ...base,
      specific_case_criteria: ["tuberculosis_infection", "medical_removal"],
      tuberculosis_test_was_pre_employment: true,
      medical_removal_was_voluntary_and_early: true,
    });
    expect(r.value.recordable).toBe(false);
  });

  test("a recordable TB case names the respiratory condition column", () => {
    const r = assessRecordability({ ...base, specific_case_criteria: ["tuberculosis_infection"] });
    expect(r.value.log_entry_notes[0]).toMatch(/RESPIRATORY CONDITION/i);
  });
});

// 1904.12 is [Reserved] — it contains no text. There is therefore no independent
// recording trigger for musculoskeletal disorders, and an earlier revision of the
// dataset wrongly described the empty section as "confirming" that. This test pins
// the absence so nobody later "fixes" it by inventing an MSD criterion.
describe("assess_recordability — 1904.12 is reserved", () => {
  test("no specific-case criterion is cited to 1904.12", () => {
    const cited = new Set<string>();
    for (const c of [
      "contaminated_needlestick_or_sharps",
      "medical_removal",
      "occupational_hearing_loss_sts",
      "tuberculosis_infection",
      "bloodborne_exposure_with_diagnosis",
    ]) {
      const r = assessRecordability({ ...base, specific_case_criteria: [c] });
      r.value.triggering_factors.forEach((f) => cited.add(f.cfr_cite));
    }
    expect([...cited].some((c) => c.startsWith("1904.12"))).toBe(false);
  });

  test("a musculoskeletal disorder records only through the general criteria", () => {
    // A back strain with days away: recordable under 1904.7(b)(1), never 1904.12.
    const r = assessRecordability({ ...base, outcomes: ["days_away_from_work"] });
    expect(r.value.recordable).toBe(true);
    expect(r.value.triggering_factors[0].cfr_cite).toBe("1904.7(b)(3)");
  });

  test("an MSD with only first aid is not recordable — no MSD-specific trigger exists", () => {
    const r = assessRecordability({ ...base, treatments: ["hot_or_cold_therapy", "non_rigid_support"] });
    expect(r.value.recordable).toBe(false);
  });
});

// The 1910.1030(b) definition of "other potentially infectious material" is an
// ENUMERATED list, not "body fluids" generally. An earlier revision of the dataset
// paraphrased it broadly, which would over-record sharps injuries contaminated with
// fluids outside the enumeration. These assertions pin the enumeration itself.
describe("1904.8 — the OPIM definition (1910.1030(b))", () => {
  const dataset = loadDataset<any>("specific-case-criteria");
  const bbp = dataset.bloodborne_pathogens;

  test("enumerates exactly the nine named body fluids", () => {
    expect(bbp.other_potentially_infectious_material.parts["1_enumerated_body_fluids"].fluids).toEqual([
      "semen",
      "vaginal secretions",
      "cerebrospinal fluid",
      "synovial fluid",
      "pleural fluid",
      "pericardial fluid",
      "peritoneal fluid",
      "amniotic fluid",
      "saliva in dental procedures",
    ]);
  });

  test("saliva qualifies only in dental procedures, never generally", () => {
    const fluids = bbp.other_potentially_infectious_material.parts["1_enumerated_body_fluids"].fluids;
    expect(fluids).toContain("saliva in dental procedures");
    expect(fluids).not.toContain("saliva");
  });

  test("carries both catch-alls, which are what make the list workable", () => {
    const c = bbp.other_potentially_infectious_material.parts["1_enumerated_body_fluids"].catch_alls;
    expect(c.join(" ")).toMatch(/visibly contaminated with blood/i);
    expect(c.join(" ")).toMatch(/difficult or impossible to differentiate/i);
  });

  test("the tissue limb excludes intact skin", () => {
    expect(bbp.other_potentially_infectious_material.parts["2_tissue_or_organ"]).toMatch(
      /OTHER THAN INTACT SKIN/i
    );
  });

  test("blood is defined separately from OPIM — 1904.8 covers either", () => {
    expect(bbp.blood.definition).toMatch(/SEPARATELY/i);
  });

  test("'contaminated' includes reasonably anticipated presence, not just proven", () => {
    expect(bbp.contaminated.definition).toMatch(/REASONABLY ANTICIPATED/i);
  });

  test("a sharp is any contaminated object that can penetrate skin — an open list", () => {
    expect(bbp.contaminated_sharps.definition).toMatch(/broken glass/i);
    expect(bbp.contaminated_sharps.definition).toMatch(/OPEN list/i);
  });

  test("the criterion description carries the enumeration, not a generality", () => {
    const crit = dataset.criteria.contaminated_needlestick_or_sharps.description;
    expect(crit).toMatch(/cerebrospinal/i);
    expect(crit).toMatch(/saliva IN DENTAL PROCEDURES/i);
    expect(crit).not.toMatch(/human bodily fluids, tissues and organs/i);
  });
});
