import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import { ruleRecord, type RuleRecord } from "../types.js";

/** Represents a specific restricted work test case definition. */
interface RestrictedTest {
  cfr_cite: string;
  verdict: "restricted" | "not_restricted";
  description: string;
}
/** Dataset structure for restricted work rules and definitions under 1904.7(b)(4). */
interface RestrictedWorkData extends WithProvenance {
  restricted_work: {
    cfr_cite: string;
    routine_functions: { cfr_cite: string; definition: string };
    tests: Record<string, RestrictedTest>;
    vague_restriction: { cfr_cite: string; rule: string; default_when_unclarifiable: string };
    day_counting: { cfr_cite: string; rule: string };
  };
}

const data = loadDataset<RestrictedWorkData>("general-criteria");
const rw = data.restricted_work;

/**
 * The result of a restricted-work evaluation under 29 CFR § 1904.7(b)(4): whether a
 * restriction or job transfer actually meets the regulation's definition.
 */
export interface RestrictedWorkDetermination {
  restricted_work: boolean;
  basis: string;
  applied_test: string | null;
  cfr_cites: string[];
  /** True when (b)(4)(vii) forced a record because clarification was unobtainable. */
  recorded_by_default: boolean;
  /** 300-Log consequence: transfer and restriction share one column. */
  log_note: string;
  disclaimer: string;
}

const DISCLAIMER =
  "Restricted-work evaluation only (1904.7(b)(4)). It does not decide whether the case is otherwise " +
  "recordable, and it does not count days — days of restriction are counted like days away (1904.7(b)(4)(xi)).";

/**
 * Input shape for `osha_evaluate_restricted_work`. Per-field documentation is carried by the
 * Zod `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const evaluateRestrictedWorkInputShape = {
  restriction_applies_beyond_day_of_injury: z
    .boolean()
    .describe(
      "Does the restriction or transfer extend beyond the day the injury occurred or the illness began? " +
        "A restriction imposed ONLY for that day is not recordable as restricted work (1904.7(b)(4)(iii))."
    ),
  keeps_from_routine_function_or_full_shift: z
    .boolean()
    .describe(
      "Does the restriction keep the employee from one or more ROUTINE functions, or from working the full " +
        "workday they would otherwise have been scheduled? Routine functions are activities the employee " +
        "regularly performs AT LEAST ONCE PER WEEK (1904.7(b)(4)(ii)). A restriction on something done less " +
        "often than weekly is not a restriction on a routine function."
    ),
  worked_partial_shift: z
    .boolean()
    .default(false)
    .describe(
      "Did the employee work only part of a shift because of the injury or illness? A partial day counts as " +
        "a day of restriction or transfer, except on the day of the injury (1904.7(b)(4)(v))."
    ),
  transferred_to_another_job: z
    .boolean()
    .default(false)
    .describe(
      "Was the employee assigned to a job other than their regular job for part of the day? Transfers are " +
        "recorded in the same 300-Log box as restricted work (1904.7(b)(4)(ix)-(x))."
    ),
  reduced_output_only: z
    .boolean()
    .default(false)
    .describe(
      "Is the ONLY effect that the employee produces less while still performing all routine functions and " +
        "working the full shift? That is not restricted work (1904.7(b)(4)(vi))."
    ),
  restriction_is_vague: z
    .boolean()
    .default(false)
    .describe(
      "Is the recommendation vague — 'light duty', 'take it easy for a week' — rather than specific? " +
        "(1904.7(b)(4)(vii))"
    ),
  vague_restriction_clarified: z
    .boolean()
    .default(false)
    .describe(
      "If the restriction was vague, was the PLHCP successfully asked whether the employee can do ALL " +
        "routine functions AND work the FULL shift? If clarification could NOT be obtained, pass false — " +
        "1904.7(b)(4)(vii) then requires the case to be recorded as restricted work."
    ),
};

const InputSchema = z.object(evaluateRestrictedWorkInputShape);
export type EvaluateRestrictedWorkInput = z.infer<typeof InputSchema>;

/**
 * Evaluates whether job transfer or work restriction has occurred under 29 CFR § 1904.7(b)(4).
 *
 * This function determines if a case qualifies as restricted work by checking:
 * 1. **Day of Injury Rule (1904.7(b)(4)(iii)):** Restrictions confined purely to the day of injury are not recordable.
 * 2. **Vague Restrictions (1904.7(b)(4)(vii)):** If a restriction is vague (e.g. "light duty") and could not be clarified
 *    with a PLHCP, the case *must* be recorded as restricted work (default-to-record).
 * 3. **Reduced Output vs Routine Functions (1904.7(b)(4)(ii) & (vi)):** Reduced productivity alone does not count
 *    as restricted work unless the employee is prevented from performing routine functions (activities done at least
 *    once per week) or from working a full shift.
 * 4. **Partial Shifts (1904.7(b)(4)(v)):** Working a partial shift due to injury/illness is restricted work.
 * 5. **Job Transfers (1904.7(b)(4)(ix)-(x)):** Reassigning an employee to another job is restricted work and shares
 *    the same log column.
 *
 * @param input The parameters containing restriction details, shift information, and vague clarification status.
 * @returns A cited RuleRecord containing the restricted-work determination.
 */
export function evaluateRestrictedWork(
  input: EvaluateRestrictedWorkInput
): RuleRecord<RestrictedWorkDetermination> {
  const build = (
    restricted: boolean,
    basis: string,
    cites: string[],
    applied: string | null,
    byDefault = false
  ) =>
    ruleRecord(
      data.provenance,
      {
        restricted_work: restricted,
        basis,
        applied_test: applied,
        cfr_cites: cites,
        recorded_by_default: byDefault,
        log_note: restricted
          ? "Check the job transfer / restriction box on the 300 Log and enter the day count. Transfers and restrictions share one column (1904.7(b)(4)(x)). " +
            rw.day_counting.rule
          : "No entry in the job transfer / restriction column on this basis.",
        disclaimer: DISCLAIMER,
      },
      cites[0] ?? rw.cfr_cite
    );

  // (b)(4)(iii): a restriction confined to the day of injury is never recordable,
  // whatever else is true. Checked first so nothing below can override it.
  if (!input.restriction_applies_beyond_day_of_injury) {
    const t = rw.tests.day_of_injury_only;
    return build(false, t.description, [t.cfr_cite], "day_of_injury_only");
  }

  // (b)(4)(vii): the regulation's own default. If the PLHCP cannot be reached to
  // clarify a vague restriction, the case MUST be recorded — the doubt resolves
  // toward recording, not away from it.
  if (input.restriction_is_vague && !input.vague_restriction_clarified) {
    return build(
      true,
      `The recommendation is vague and clarification could not be obtained. ${rw.vague_restriction.rule}`,
      [rw.vague_restriction.cfr_cite],
      "vague_restriction_unclarifiable",
      true
    );
  }

  if (input.reduced_output_only && !input.keeps_from_routine_function_or_full_shift) {
    const t = rw.tests.reduced_output_only;
    return build(false, t.description, [t.cfr_cite], "reduced_output_only");
  }

  if (input.keeps_from_routine_function_or_full_shift) {
    const t = rw.tests.kept_from_routine_function_or_full_shift;
    return build(true, t.description, [t.cfr_cite], "kept_from_routine_function_or_full_shift");
  }

  if (input.worked_partial_shift) {
    const t = rw.tests.partial_shift_worked;
    return build(true, t.description, [t.cfr_cite], "partial_shift_worked");
  }

  if (input.transferred_to_another_job) {
    const t = rw.tests.job_transfer;
    return build(true, t.description, [t.cfr_cite], "job_transfer");
  }

  // (b)(4)(iv): a restriction that misses every routine function is not recordable.
  const t = rw.tests.restriction_misses_routine_functions;
  return build(false, `${t.description} ${rw.routine_functions.definition}`, [t.cfr_cite], "restriction_misses_routine_functions");
}
