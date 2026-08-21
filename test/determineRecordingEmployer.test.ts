/**
 * Test suite for the `determineRecordingEmployer` tool (29 CFR § 1904.31).
 * Validates recording responsibility, day-to-day supervision test, payroll category applicability,
 * and single-log coordination notes for shared employees.
 */
import { determineRecordingEmployer } from "../src/tools/determineRecordingEmployer.js";

type Input = Parameters<typeof determineRecordingEmployer>[0];

/**
 * zod `.default()` fields are optional at the call site but REQUIRED in the
 * inferred type, so every new defaulted input would otherwise churn every fixture
 * here. Build inputs through this instead.
 */
const input = (over: Partial<Input> = {}): Input => ({
  worker_relationship: "on_your_payroll",
  you_supervise_day_to_day: false,
  ...over,
});

describe("determine_recording_employer — payroll employees", () => {
  test("a payroll employee is yours regardless of who supervises", () => {
    for (const supervise of [true, false]) {
      const r = determineRecordingEmployer(
        input({ worker_relationship: "on_your_payroll", you_supervise_day_to_day: supervise })
      );
      expect(r.value.you_must_record).toBe(true);
      expect(r.value.decided_by_supervision).toBe(false);
    }
  });

  test("part-time, seasonal and migrant workers are covered like any other", () => {
    const r = determineRecordingEmployer(input());
    expect(r.value.basis).toMatch(/whatever their employment category/i);
    expect(r.value.cfr_cites).toContain("1904.31(a)");
  });
});

// The heart of 1904.31: supervision decides, not the paycheck.
describe("determine_recording_employer — supervision, not payroll", () => {
  test.each([
    ["temporary_leased_or_supplied", "1904.31(b)(2)"],
    ["contractor_employee", "1904.31(b)(3)"],
  ])("%s under YOUR day-to-day supervision is yours to record (%s)", (rel, cite) => {
    const r = determineRecordingEmployer(
      input({ worker_relationship: rel, you_supervise_day_to_day: true })
    );
    expect(r.value.you_must_record).toBe(true);
    expect(r.value.recording_employer).toBe("you");
    expect(r.value.cfr_cites).toContain(cite);
    expect(r.value.decided_by_supervision).toBe(true);
  });

  test.each([["temporary_leased_or_supplied"], ["contractor_employee"]])(
    "%s supervised by the other employer is NOT yours",
    (rel) => {
      const r = determineRecordingEmployer(
        input({ worker_relationship: rel, you_supervise_day_to_day: false })
      );
      expect(r.value.you_must_record).toBe(false);
      expect(r.value.recording_employer).toBe("the_other_employer");
      expect(r.value.basis).toMatch(/not yours/i);
    }
  );

  test("shared workers always carry the record-once coordination note", () => {
    const r = determineRecordingEmployer(
      input({ worker_relationship: "temporary_leased_or_supplied", you_supervise_day_to_day: true })
    );
    expect(r.value.coordination_note).toMatch(/exactly once/i);
    expect(r.value.cfr_cites).toContain("1904.31(b)(4)");
  });

  test("a payroll employee carries no coordination note — nobody else could record it", () => {
    const r = determineRecordingEmployer(input());
    expect(r.value.coordination_note).toBeNull();
  });
});

describe("determine_recording_employer — people nobody records", () => {
  test("a self-employed person is outside the OSH Act entirely", () => {
    const r = determineRecordingEmployer(
      input({ worker_relationship: "self_employed", you_supervise_day_to_day: true })
    );
    expect(r.value.recording_employer).toBe("no_one");
    expect(r.value.you_must_record).toBe(false);
    expect(r.value.cfr_cites).toContain("1904.31(b)(1)");
  });

  test("supervision cannot pull a self-employed person onto your log", () => {
    // The one place day-to-day supervision does NOT decide.
    const supervised = determineRecordingEmployer(
      input({ worker_relationship: "self_employed", you_supervise_day_to_day: true })
    );
    const unsupervised = determineRecordingEmployer(
      input({ worker_relationship: "self_employed", you_supervise_day_to_day: false })
    );
    expect(supervised.value.recording_employer).toBe("no_one");
    expect(unsupervised.value.recording_employer).toBe("no_one");
  });

  test("an owner or partner is not an employee for recordkeeping", () => {
    const r = determineRecordingEmployer(input({ worker_relationship: "owner_or_partner" }));
    expect(r.value.recording_employer).toBe("no_one");
    expect(r.value.basis).toMatch(/sole proprietorship or partnership/i);
  });

  test("carries provenance", () => {
    const r = determineRecordingEmployer(input());
    expect(r.source_url).toMatch(/ecfr\.gov/);
    expect(r.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
