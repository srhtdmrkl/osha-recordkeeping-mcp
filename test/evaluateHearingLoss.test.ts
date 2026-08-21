/**
 * Test suite for the `evaluateHearingLoss` tool (29 CFR § 1904.10).
 * Validates standard threshold shift (STS) averages, total hearing level thresholds in the same ear,
 * age adjustment application, and retest / PLHCP overrides.
 */
import { evaluateHearingLoss } from "../src/tools/evaluateHearingLoss.js";

const flat = (db: number) => ({ hz2000: db, hz3000: db, hz4000: db });

const base = {
  baseline_left: flat(10),
  baseline_right: flat(10),
  current_left: flat(10),
  current_right: flat(10),
  age_adjustment_db_left: 0,
  age_adjustment_db_right: 0,
  retested_within_30_days: false,
  retest_confirmed_sts: false,
  plhcp_determined_not_work_related: false,
};

describe("evaluate_hearing_loss — the two thresholds", () => {
  test("a 10 dB shift with a 25 dB total records", () => {
    // baseline 15 → current 25: shift 10 (meets STS), total 25 (meets 25 dB).
    const r = evaluateHearingLoss({
      ...base,
      baseline_left: flat(15),
      current_left: flat(25),
    });
    expect(r.value.recordable).toBe(true);
    expect(r.value.qualifying_ears).toEqual(["left"]);
  });

  test("a shift just under 10 dB does not record", () => {
    const r = evaluateHearingLoss({
      ...base,
      baseline_left: flat(16),
      current_left: flat(25),
    });
    expect(r.value.ears[0].shift_db).toBe(9);
    expect(r.value.ears[0].standard_threshold_shift).toBe(false);
    expect(r.value.recordable).toBe(false);
  });

  test("a big shift with a total under 25 dB does not record", () => {
    // 0 → 20: a 20 dB shift, but the total is only 20.
    const r = evaluateHearingLoss({ ...base, baseline_left: flat(0), current_left: flat(20) });
    expect(r.value.ears[0].standard_threshold_shift).toBe(true);
    expect(r.value.ears[0].total_hearing_level_met).toBe(false);
    expect(r.value.recordable).toBe(false);
  });

  test("both thresholds are inclusive at exactly 10 and 25", () => {
    const r = evaluateHearingLoss({ ...base, baseline_left: flat(15), current_left: flat(25) });
    expect(r.value.ears[0].shift_db).toBe(10);
    expect(r.value.ears[0].total_hearing_level_db).toBe(25);
    expect(r.value.ears[0].qualifies).toBe(true);
  });

  test("averaging across the three frequencies, not any single one", () => {
    // 2000/3000/4000 = 20/30/25 → average 25; baseline flat 15 → shift 10.
    const r = evaluateHearingLoss({
      ...base,
      baseline_left: flat(15),
      current_left: { hz2000: 20, hz3000: 30, hz4000: 25 },
    });
    expect(r.value.ears[0].current_average_db).toBe(25);
    expect(r.value.recordable).toBe(true);
  });
});

// 1904.10(a) requires the 25 dB level in the SAME ear as the STS.
describe("evaluate_hearing_loss — the same-ear requirement", () => {
  test("STS in one ear and 25 dB in the other does not record", () => {
    const r = evaluateHearingLoss({
      ...base,
      baseline_left: flat(0),
      current_left: flat(20), // STS yes (20), total no (20)
      baseline_right: flat(30),
      current_right: flat(32), // total yes (32), STS no (2)
    });
    expect(r.value.ears[0].standard_threshold_shift).toBe(true);
    expect(r.value.ears[1].total_hearing_level_met).toBe(true);
    expect(r.value.recordable).toBe(false);
    expect(r.value.basis).toMatch(/SAME ear/i);
  });

  test("both ears qualifying are both reported", () => {
    const r = evaluateHearingLoss({
      ...base,
      baseline_left: flat(15),
      current_left: flat(25),
      baseline_right: flat(15),
      current_right: flat(25),
    });
    expect(r.value.qualifying_ears).toEqual(["left", "right"]);
  });
});

// (b)(3): age adjustment applies to the STS test and never to the 25 dB test.
describe("evaluate_hearing_loss — age adjustment (1904.10(b)(3))", () => {
  test("an age adjustment can defeat the STS", () => {
    const r = evaluateHearingLoss({
      ...base,
      baseline_left: flat(15),
      current_left: flat(25),
      age_adjustment_db_left: 5,
    });
    expect(r.value.ears[0].shift_db).toBe(5);
    expect(r.value.recordable).toBe(false);
  });

  test("age adjustment never reduces the total hearing level", () => {
    const r = evaluateHearingLoss({
      ...base,
      baseline_left: flat(15),
      current_left: flat(25),
      age_adjustment_db_left: 5,
    });
    expect(r.value.ears[0].total_hearing_level_db).toBe(25);
    expect(r.value.ears[0].total_hearing_level_met).toBe(true);
  });
});

describe("evaluate_hearing_loss — retest and PLHCP rules", () => {
  const qualifying = { ...base, baseline_left: flat(15), current_left: flat(25) };

  test("a retest within 30 days that does not confirm defeats the case", () => {
    const r = evaluateHearingLoss({
      ...qualifying,
      retested_within_30_days: true,
      retest_confirmed_sts: false,
    });
    expect(r.value.recordable).toBe(false);
    expect(r.value.cfr_cites).toContain("1904.10(b)(4)");
  });

  test("a confirming retest starts a 7-calendar-day recording clock", () => {
    const r = evaluateHearingLoss({
      ...qualifying,
      retested_within_30_days: true,
      retest_confirmed_sts: true,
      retest_date: "2026-05-01T00:00:00Z",
    });
    expect(r.value.recordable).toBe(true);
    expect(r.value.record_by_iso).toBe("2026-05-08T00:00:00.000Z");
  });

  test("a PLHCP finding of no work-relatedness ends it whatever the numbers say", () => {
    const r = evaluateHearingLoss({ ...qualifying, plhcp_determined_not_work_related: true });
    expect(r.value.recordable).toBe(false);
    expect(r.value.cfr_cites).toContain("1904.10(b)(6)");
  });

  test("a recordable case names the hearing loss column", () => {
    const r = evaluateHearingLoss(qualifying);
    expect(r.value.log_note).toMatch(/HEARING LOSS column/i);
  });

  test("carries provenance", () => {
    const r = evaluateHearingLoss(base);
    expect(r.source_url).toMatch(/ecfr\.gov/);
    expect(r.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
