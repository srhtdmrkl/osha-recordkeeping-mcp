import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import { ruleRecord, type RuleRecord } from "../types.js";

/** Dataset structure for occupational hearing loss criteria under 1904.10. */
interface HearingLossData extends WithProvenance {
  frequencies_hz: number[];
  tests: {
    standard_threshold_shift: { cfr_cite: string; threshold_db: number; description: string };
    total_hearing_level: { cfr_cite: string; threshold_db: number; description: string };
  };
  baseline_selection: { cfr_cite: string; rule: string };
  age_adjustment: { cfr_cite: string; rule: string };
  retest: { cfr_cite: string; window_days: number; record_within_days: number; rule: string };
  plhcp_override: { cfr_cite: string; rule: string };
  log_entry: { cfr_cite: string; rule: string };
}

const data = loadDataset<HearingLossData>("hearing-loss");
const STS_DB = data.tests.standard_threshold_shift.threshold_db;
const TOTAL_DB = data.tests.total_hearing_level.threshold_db;
const DAY_MS = 86_400_000;

/**
 * The audiometric arithmetic for a single ear. Both 1904.10 tests must be met in the *same*
 * ear to record, so the two are tracked per-ear rather than across the audiogram.
 */
export interface EarResult {
  ear: "left" | "right";
  baseline_average_db: number;
  current_average_db: number;
  /** Shift after any age adjustment — the STS test. */
  shift_db: number;
  standard_threshold_shift: boolean;
  /** Current average vs audiometric zero. Never age-adjusted (1904.10(b)(3)). */
  total_hearing_level_db: number;
  total_hearing_level_met: boolean;
  /** Both tests met in THIS ear — the only combination that records. */
  qualifies: boolean;
}

/**
 * The result of an occupational hearing loss evaluation under 29 CFR § 1904.10, combining the
 * per-ear results into a single recordability answer.
 */
export interface HearingLossDetermination {
  recordable: boolean;
  basis: string;
  ears: EarResult[];
  qualifying_ears: string[];
  /** Set when a confirming retest starts the 7-day recording clock. */
  record_by_iso: string | null;
  cfr_cites: string[];
  log_note: string;
  disclaimer: string;
}

const DISCLAIMER =
  "Audiometric arithmetic and the 1904.10 recording tests only. It assumes the audiogram values supplied are " +
  "correct and that work-relatedness has been established under 1904.5 — see 1904.10(b)(5).";

const audiogramShape = z
  .object({
    hz2000: z.number().describe("Hearing threshold in dB at 2000 Hz."),
    hz3000: z.number().describe("Hearing threshold in dB at 3000 Hz."),
    hz4000: z.number().describe("Hearing threshold in dB at 4000 Hz."),
  })
  .describe("Audiometric thresholds in dB at the three frequencies 1904.10 averages.");

/**
 * Input shape for `osha_evaluate_hearing_loss`. Per-field documentation is carried by the Zod
 * `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const evaluateHearingLossInputShape = {
  baseline_left: audiogramShape.describe(
    "LEFT ear baseline audiogram. If the employee has previously had a recordable hearing loss, use the " +
      "REVISED baseline reflecting that case, not the original (1904.10(b)(2)(i))."
  ),
  baseline_right: audiogramShape.describe(
    "RIGHT ear baseline audiogram, or the revised baseline if a prior hearing loss was recorded."
  ),
  current_left: audiogramShape.describe("LEFT ear current audiogram."),
  current_right: audiogramShape.describe("RIGHT ear current audiogram."),
  age_adjustment_db_left: z
    .number()
    .default(0)
    .describe(
      "Optional dB age correction for the LEFT ear, derived from Tables F-1/F-2 of 29 CFR 1910.95 appendix F. " +
        "Applies ONLY to the STS test — it may NOT be applied to the 25 dB total-hearing-level test " +
        "(1904.10(b)(3)). The tool does not compute this; supply it from the tables or leave 0."
    ),
  age_adjustment_db_right: z
    .number()
    .default(0)
    .describe("Optional dB age correction for the RIGHT ear. Same rules as the left."),
  retested_within_30_days: z
    .boolean()
    .default(false)
    .describe(
      "Was the employee's hearing retested within 30 days of the first test? (1904.10(b)(4))"
    ),
  retest_confirmed_sts: z
    .boolean()
    .default(false)
    .describe(
      "If retested, did the retest CONFIRM the recordable STS? A retest within 30 days that does not " +
        "confirm it means the case need not be recorded."
    ),
  retest_date: z
    .string()
    .optional()
    .describe(
      "ISO 8601 date of a confirming retest. Used to compute the 7-calendar-day recording deadline " +
        "(1904.10(b)(4))."
    ),
  plhcp_determined_not_work_related: z
    .boolean()
    .default(false)
    .describe(
      "Has a PLHCP determined, applying 1904.5, that the hearing loss is not work-related or that " +
        "occupational noise did not significantly aggravate it? If so the case need not be recorded " +
        "(1904.10(b)(6))."
    ),
};

const InputSchema = z.object(evaluateHearingLossInputShape);
export type EvaluateHearingLossInput = z.infer<typeof InputSchema>;

type Audiogram = { hz2000: number; hz3000: number; hz4000: number };
const average = (a: Audiogram) => (a.hz2000 + a.hz3000 + a.hz4000) / 3;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Evaluates the audiogram metrics for a single ear.
 * Computes standard threshold shift (STS) and compares total hearing level against audiometric zero.
 *
 * @param ear The ear being evaluated (left or right).
 * @param baseline Baseline audiometric thresholds (hz2000, hz3000, hz4000).
 * @param current Current audiometric thresholds (hz2000, hz3000, hz4000).
 * @param ageAdjustment Optional dB age correction (applies only to the STS test).
 * @returns An EarResult object containing averages, calculated shifts, and pass/fail indicators.
 */
function evaluateEar(
  ear: "left" | "right",
  baseline: Audiogram,
  current: Audiogram,
  ageAdjustment: number
): EarResult {
  const baselineAvg = average(baseline);
  const currentAvg = average(current);
  // Age adjustment reduces the measured shift, and applies to the STS test only.
  const shift = currentAvg - baselineAvg - ageAdjustment;
  // The 25 dB test uses the raw current audiogram against audiometric zero.
  const total = currentAvg;
  const sts = shift >= STS_DB;
  const totalMet = total >= TOTAL_DB;
  return {
    ear,
    baseline_average_db: round1(baselineAvg),
    current_average_db: round1(currentAvg),
    shift_db: round1(shift),
    standard_threshold_shift: sts,
    total_hearing_level_db: round1(total),
    total_hearing_level_met: totalMet,
    qualifies: sts && totalMet,
  };
}

/**
 * Evaluates occupational hearing loss and calculates log entry requirements under 29 CFR § 1904.10.
 *
 * It validates the two standard OSHA tests which must **both be met in the same ear**:
 * 1. **Standard Threshold Shift (STS):** A shift in hearing threshold relative to the baseline
 *    averaging 10 dB or more at 2000, 3000, and 4000 Hz. Age correction tables may be applied.
 * 2. **Total Hearing Level:** The current hearing level must be 25 dB or more above audiometric zero,
 *    averaged at the same three frequencies (never age-corrected).
 *
 * Retests within 30 days and PLHCP determinations (stating the hearing loss is not occupational) are
 * also resolved according to the regulation.
 *
 * @param input The parameters containing baseline and current audiogram results, age corrections, and retest info.
 * @returns A cited RuleRecord containing the hearing-loss determination.
 */
export function evaluateHearingLoss(
  input: EvaluateHearingLossInput
): RuleRecord<HearingLossDetermination> {
  const ears = [
    evaluateEar("left", input.baseline_left, input.current_left, input.age_adjustment_db_left),
    evaluateEar("right", input.baseline_right, input.current_right, input.age_adjustment_db_right),
  ];
  const qualifying = ears.filter((e) => e.qualifies).map((e) => e.ear);

  const build = (
    recordable: boolean,
    basis: string,
    cites: string[],
    recordBy: string | null = null
  ) =>
    ruleRecord(
      data.provenance,
      {
        recordable,
        basis,
        ears,
        qualifying_ears: qualifying,
        record_by_iso: recordBy,
        cfr_cites: cites,
        log_note: recordable ? data.log_entry.rule : "No hearing-loss entry on this basis.",
        disclaimer: DISCLAIMER,
      },
      cites[0] ?? data.provenance.cfr_cite
    );

  // (b)(6): a PLHCP determination of no work-relatedness ends it, whatever the
  // numbers say. Checked first for the same reason as 1904.6(b)(3).
  if (input.plhcp_determined_not_work_related) {
    return build(
      false,
      `Not recordable: ${data.plhcp_override.rule}`,
      [data.plhcp_override.cfr_cite]
    );
  }

  const describeEars = ears
    .map(
      (e) =>
        `${e.ear}: shift ${e.shift_db} dB (STS threshold ${STS_DB}), total ${e.total_hearing_level_db} dB ` +
        `(threshold ${TOTAL_DB})`
    )
    .join("; ");

  if (qualifying.length === 0) {
    const anySts = ears.some((e) => e.standard_threshold_shift);
    const anyTotal = ears.some((e) => e.total_hearing_level_met);
    const mismatch =
      anySts && anyTotal
        ? " Both tests are met, but not in the same ear — 1904.10(a) requires the 25 dB level in the SAME ear as the STS."
        : "";
    return build(
      false,
      `Not recordable: the 1904.10 tests are not both met in the same ear. ${describeEars}.${mismatch}`,
      [data.tests.standard_threshold_shift.cfr_cite, data.tests.total_hearing_level.cfr_cite]
    );
  }

  // (b)(4): a retest inside 30 days that fails to confirm defeats the case.
  if (input.retested_within_30_days && !input.retest_confirmed_sts) {
    return build(
      false,
      `Not recordable: the audiogram met both tests, but a retest within ${data.retest.window_days} days did not confirm the recordable STS (${data.retest.cfr_cite}).`,
      [data.retest.cfr_cite]
    );
  }

  let recordBy: string | null = null;
  if (input.retested_within_30_days && input.retest_confirmed_sts && input.retest_date) {
    const d = new Date(input.retest_date);
    if (!Number.isNaN(d.getTime())) {
      recordBy = new Date(d.getTime() + data.retest.record_within_days * DAY_MS).toISOString();
    }
  }

  const confirmNote =
    input.retested_within_30_days && input.retest_confirmed_sts
      ? ` The retest confirmed the STS, so the case must be recorded within ${data.retest.record_within_days} calendar days of it (${data.retest.cfr_cite}).`
      : "";

  return build(
    true,
    `Recordable: a work-related Standard Threshold Shift and a total hearing level of ${TOTAL_DB} dB or more ` +
      `are both met in the same ear (${qualifying.join(" and ")}). ${describeEars}.${confirmNote}`,
    [data.provenance.cfr_cite, data.tests.standard_threshold_shift.cfr_cite],
    recordBy
  );
}
