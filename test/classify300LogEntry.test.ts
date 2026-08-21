/**
 * Test suite for the `classify300LogEntry` tool (29 CFR § 1904.29).
 * Validates outcome column mapping (fatalities, days away, restricted work, other), illness type
 * classification, day-count capping at 180, and required forms and entry deadlines.
 */
import { classify300LogEntry } from "../src/tools/classify300LogEntry.js";

type Input = Parameters<typeof classify300LogEntry>[0];

/**
 * zod `.default()` fields are optional at the call site but REQUIRED in the
 * inferred type, so every new defaulted input would otherwise churn every fixture
 * in this file. Build inputs through this instead.
 */
const input = (over: Partial<Input> = {}): Input => ({
  is_recordable: true,
  death: false,
  days_away_from_work: 0,
  days_restricted_or_transfer: 0,
  illness_type: "injury",
  medical_removal_case: false,
  medical_removal_from_chemical_exposure: false,
  tuberculosis_case: false,
  tb_non_occupational_evidence: "none",
  bloodborne_diagnosis_after_recording: false,
  ...over,
});

// One shape for both answers — no cast helper needed, which is the point of `on_log`.
const c = (v: ReturnType<typeof classify300LogEntry>["value"]) => v;

describe("classify_300_log_entry — 1904.29 columns", () => {
  test("not recordable → not on the log", () => {
    const r = classify300LogEntry({
      is_recordable: false,
      death: false,
      days_away_from_work: 0,
      days_restricted_or_transfer: 0,
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: false,
      illness_type: "injury",
    });
    expect(r.value.on_log).toBe(false);
    expect(r.value.outcome_column).toBeNull();
    expect(r.value.notes[0]).toMatch(/not entered/);
  });

  test("recordable cases are marked on_log", () => {
    const r = classify300LogEntry({
      is_recordable: true,
      death: false,
      days_away_from_work: 2,
      days_restricted_or_transfer: 0,
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: false,
      illness_type: "injury",
    });
    expect(r.value.on_log).toBe(true);
  });

  test("death → column G", () => {
    const r = classify300LogEntry({
      is_recordable: true,
      death: true,
      days_away_from_work: 0,
      days_restricted_or_transfer: 0,
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: false,
      illness_type: "injury",
    });
    expect(c(r.value).outcome_column).toBe("G");
  });

  test("days away → column H", () => {
    const r = classify300LogEntry({
      is_recordable: true,
      death: false,
      days_away_from_work: 5,
      days_restricted_or_transfer: 0,
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: false,
      illness_type: "injury",
    });
    expect(c(r.value).outcome_column).toBe("H");
  });

  test("restriction only → column I", () => {
    const r = classify300LogEntry({
      is_recordable: true,
      death: false,
      days_away_from_work: 0,
      days_restricted_or_transfer: 3,
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: false,
      illness_type: "injury",
    });
    expect(c(r.value).outcome_column).toBe("I");
  });

  test("recordable but no days/death → column J", () => {
    const r = classify300LogEntry({
      is_recordable: true,
      death: false,
      days_away_from_work: 0,
      days_restricted_or_transfer: 0,
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: false,
      illness_type: "injury",
    });
    expect(c(r.value).outcome_column).toBe("J");
  });

  test("both days away and restriction → H, but both counts recorded", () => {
    const r = classify300LogEntry({
      is_recordable: true,
      death: false,
      days_away_from_work: 4,
      days_restricted_or_transfer: 6,
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: false,
      illness_type: "injury",
    });
    expect(c(r.value).outcome_column).toBe("H");
    expect(c(r.value).days_away_recorded).toBe(4);
    expect(c(r.value).days_restricted_or_transfer_recorded).toBe(6);
  });

  test("day counts capped at 180", () => {
    const r = classify300LogEntry({
      is_recordable: true,
      death: false,
      days_away_from_work: 250,
      days_restricted_or_transfer: 0,
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: false,
      illness_type: "injury",
    });
    expect(c(r.value).days_away_recorded).toBe(180);
    expect(c(r.value).capped).toBe(true);
  });

  test("hearing loss maps to (M)(5)", () => {
    const r = classify300LogEntry({
      is_recordable: true,
      death: false,
      days_away_from_work: 0,
      days_restricted_or_transfer: 0,
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: false,
      illness_type: "hearing_loss",
    });
    expect(c(r.value).illness_type_column).toMatch(/\(M\)\(5\)/);
  });
});

// 1904.8(b)(3): a later bloodborne diagnosis amends the existing entry — it does
// not create a second case, and the classification flips from injury to illness.
describe("classify_300_log_entry — later bloodborne diagnosis (1904.8(b)(3))", () => {
  test("directs an amendment rather than a new entry", () => {
    const r = classify300LogEntry({
      is_recordable: true,
      death: false,
      days_away_from_work: 3,
      days_restricted_or_transfer: 0,
      illness_type: "other_illness",
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: true,
    });
    expect(r.value.amend_existing_entry).toMatch(/injury to an illness/i);
    expect(r.value.notes.join(" ")).toMatch(/Do NOT record a second case/i);
  });

  test("ordinary cases carry no amendment instruction", () => {
    const r = classify300LogEntry({
      is_recordable: true,
      death: false,
      days_away_from_work: 3,
      days_restricted_or_transfer: 0,
      tuberculosis_case: false,
      tb_non_occupational_evidence: "none" as const,
      medical_removal_case: false,
      medical_removal_from_chemical_exposure: false,
      bloodborne_diagnosis_after_recording: false,
      illness_type: "injury",
    });
    expect(r.value.amend_existing_entry).toBeNull();
  });
});

// 1904.9(b)(1): a medical removal is always days-away or restricted, and a chemical
// removal goes in the poisoning column.
describe("classify_300_log_entry — medical removal (1904.9(b)(1))", () => {
  const mr = input({
    medical_removal_case: true,
    medical_removal_from_chemical_exposure: false,
  });

  test("flags that column J is unavailable for a medical removal", () => {
    const r = classify300LogEntry(mr);
    expect(r.value.outcome_column).toBe("J");
    expect(r.value.notes.join(" ")).toMatch(/Column J is not available/i);
  });

  test("no flag once the case is properly days-away", () => {
    const r = classify300LogEntry({ ...mr, days_away_from_work: 10 });
    expect(r.value.outcome_column).toBe("H");
    expect(r.value.notes.join(" ")).not.toMatch(/Column J is not available/i);
  });

  test("a chemical removal not in the poisoning column is flagged", () => {
    const r = classify300LogEntry({
      ...mr,
      days_away_from_work: 5,
      medical_removal_from_chemical_exposure: true,
      illness_type: "other_illness",
    });
    expect(r.value.notes.join(" ")).toMatch(/POISONING column/i);
  });

  test("no flag when poisoning is correctly selected", () => {
    const r = classify300LogEntry({
      ...mr,
      days_away_from_work: 5,
      medical_removal_from_chemical_exposure: true,
      illness_type: "poisoning",
    });
    expect(r.value.notes.join(" ")).not.toMatch(/POISONING column/i);
  });
});

// 1904.11: the respiratory column, and the three enumerated circumstances that
// PERMIT — never require — lining a TB case out.
describe("classify_300_log_entry — tuberculosis (1904.11)", () => {
  const tb = input({
    days_away_from_work: 4,
    tuberculosis_case: true,
    illness_type: "respiratory_condition",
  });

  test("no flag when the respiratory column is selected", () => {
    const r = classify300LogEntry(tb);
    expect(r.value.notes.join(" ")).not.toMatch(/RESPIRATORY CONDITION column/i);
  });

  test("a TB case in the wrong column is flagged", () => {
    const r = classify300LogEntry({ ...tb, illness_type: "other_illness" });
    expect(r.value.notes.join(" ")).toMatch(/RESPIRATORY CONDITION column/i);
  });

  test.each([
    ["household_contact", "1904.11(b)(2)(i)"],
    ["public_health_department_contact", "1904.11(b)(2)(ii)"],
    ["medical_investigation", "1904.11(b)(2)(iii)"],
  ])("%s permits lining the case out, cited to %s", (evidence, cite) => {
    const r = classify300LogEntry({ ...tb, tb_non_occupational_evidence: evidence });
    expect(r.value.amend_existing_entry).toMatch(/line out or erase/i);
    expect(r.value.notes.join(" ")).toContain(cite);
  });

  test("the line-out is permissive, not mandatory", () => {
    const r = classify300LogEntry({ ...tb, tb_non_occupational_evidence: "household_contact" });
    expect(r.value.amend_existing_entry).toMatch(/permissive, not required/i);
    expect(r.value.amend_existing_entry).not.toMatch(/must/i);
  });

  test("no evidence means no line-out instruction", () => {
    const r = classify300LogEntry(tb);
    expect(r.value.amend_existing_entry).toBeNull();
  });
});

// 1904.29(b)(2)-(b)(3): every recordable case needs a 301 as well as a 300 line,
// and both are due within 7 calendar days of LEARNING of the case.
describe("classify_300_log_entry — forms and the recording deadline (1904.29)", () => {
  test("computes the 7-calendar-day deadline from the date information was received", () => {
    const r = classify300LogEntry(
      input({ days_away_from_work: 2, date_information_received: "2026-06-01T00:00:00Z" })
    );
    expect(r.value.record_by_iso).toBe("2026-06-08T00:00:00.000Z");
  });

  test("the clock runs from receiving the information, not from the incident", () => {
    // Same case, learned of a week later — the deadline moves with it.
    const r = classify300LogEntry(
      input({ days_away_from_work: 2, date_information_received: "2026-06-08T00:00:00Z" })
    );
    expect(r.value.record_by_iso).toBe("2026-06-15T00:00:00.000Z");
  });

  test("names the 301 Incident Report, not just the 300 Log", () => {
    const r = classify300LogEntry(input({ days_away_from_work: 2 }));
    expect(r.value.forms_required.join(" ")).toMatch(/301 .*Incident Report/i);
    expect(r.value.forms_required).toHaveLength(2);
  });

  test("a non-recordable case needs no forms and has no deadline", () => {
    const r = classify300LogEntry(input({ is_recordable: false }));
    expect(r.value.forms_required).toHaveLength(0);
    expect(r.value.record_by_iso).toBeNull();
  });

  test("an unparseable date degrades to a note rather than throwing", () => {
    const r = classify300LogEntry(
      input({ days_away_from_work: 2, date_information_received: "last Tuesday" })
    );
    expect(r.value.record_by_iso).toBeNull();
    expect(r.value.notes.join(" ")).toMatch(/ISO 8601/);
  });
});

// Verified against the OSHA Form 300 itself. These assertions exist so the column
// letters and labels cannot drift away from the published form unnoticed — the
// form is the only source for them; 1904.29's text does not enumerate the columns.
describe("classify_300_log_entry — column labels match Form 300", () => {
  test.each([
    ["G", true, false, 0, 0, "Death"],
    ["H", false, false, 3, 0, "Days away from work"],
    ["I", false, false, 0, 3, "job transfer or restriction"],
    ["J", false, false, 0, 0, "other recordable cases"],
  ])("column %s reads %s", (col, death, _x, away, restricted, label) => {
    const r = classify300LogEntry(
      input({
        death: death as boolean,
        days_away_from_work: away as number,
        days_restricted_or_transfer: restricted as number,
      })
    );
    expect(r.value.outcome_column).toBe(col);
    expect(r.value.outcome_column_label!.toLowerCase()).toContain(
      (label as string).toLowerCase()
    );
  });

  test("the 'Remained at Work' bracket covers I and J, never G or H", () => {
    const remained = ["I", "J"];
    for (const [away, restricted] of [
      [0, 3],
      [0, 0],
    ]) {
      const r = classify300LogEntry(
        input({ days_away_from_work: away, days_restricted_or_transfer: restricted })
      );
      expect(remained).toContain(r.value.outcome_column);
      expect(r.value.outcome_column_label).toMatch(/Remained at work/i);
    }
    const daysAway = classify300LogEntry(input({ days_away_from_work: 3 }));
    expect(daysAway.value.outcome_column_label).not.toMatch(/Remained at work/i);
  });

  test.each([
    ["injury", "(M)(1) Injury"],
    ["skin_disorder", "(M)(2) Skin disorder"],
    ["respiratory_condition", "(M)(3) Respiratory condition"],
    ["poisoning", "(M)(4) Poisoning"],
    ["hearing_loss", "(M)(5) Hearing loss"],
    ["other_illness", "(M)(6) All other illnesses"],
  ])("illness type %s reads exactly '%s'", (type, label) => {
    const r = classify300LogEntry(
      input({ days_away_from_work: 1, illness_type: type as never })
    );
    expect(r.value.illness_type_column).toBe(label);
  });
});

// The 301 is as mandatory as the 300 line, and its narrative fields carry a PII
// instruction printed on the form itself. Both must reach the user together.
describe("classify_300_log_entry — the 301 Incident Report", () => {
  test("names the form number, not just its title", () => {
    const r = classify300LogEntry(input({ days_away_from_work: 1 }));
    const forms = r.value.forms_required.join(" ");
    expect(forms).toMatch(/OSHA 300\b/);
    expect(forms).toMatch(/OSHA 301\b/);
  });

  test("carries the Form 301 PII warning for the narrative fields", () => {
    const r = classify300LogEntry(input({ days_away_from_work: 1 }));
    const f301 = r.value.forms_required.find((f) => /OSHA 301/.test(f))!;
    expect(f301).toMatch(/14-17/);
    expect(f301).toMatch(/Social Security/i);
  });

  test("says the 301 is required for every recordable case, not only serious ones", () => {
    const r = classify300LogEntry(input({ days_away_from_work: 0 }));
    const f301 = r.value.forms_required.find((f) => /OSHA 301/.test(f))!;
    expect(f301).toMatch(/EVERY recordable case/i);
  });
});
