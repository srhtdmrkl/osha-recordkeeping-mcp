import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import { ruleRecord, type RuleRecord } from "../types.js";

const data = loadDataset<WorkRelatednessData>("work-relatedness");

/** Represents a regulatory citation and its description. */
interface Cited {
  cfr_cite: string;
  description: string;
}
/** Dataset structure for work-relatedness guidelines under 1904.5. */
interface WorkRelatednessData extends WithProvenance {
  presumption: { cfr_cite: string; statement: string };
  work_environment: { cfr_cite: string; definition: string };
  exceptions: Record<string, Cited & { aliases: string[] }>;
  significant_aggravation: { cfr_cite: string; note: string; tests: Record<string, Cited> };
  judgment_paths: Record<string, Cited>;
}

/**
 * Three-valued on purpose. 1904.5 contains genuinely non-deterministic paths —
 * 1904.5(b)(3) says the employer "must evaluate", and every (b)(2) exception turns
 * on the word "solely", which is a factual finding. Forcing those into true/false
 * would be the tool guessing at the most-litigated determination in Part 1904.
 */
export type WorkRelatednessVerdict = "work_related" | "not_work_related" | "requires_judgment";

/** The determination payload returned inside a RuleRecord. */
export interface WorkRelatednessDetermination {
  verdict: WorkRelatednessVerdict;
  /** Convenience boolean for feeding `osha_assess_recordability`; null when unresolved. */
  work_related: boolean | null;
  basis: string;
  applied_exception: string | null;
  cfr_cites: string[];
  /** Set when the answer needs a human: what must be established, and by whom. */
  judgment_required: { question: string; why: string; cfr_cite: string } | null;
  disclaimer: string;
}

const EXCEPTION_CODES = Object.keys(data.exceptions) as [string, ...string[]];
const AGGRAVATION_CODES = Object.keys(data.significant_aggravation.tests) as [string, ...string[]];

const DISCLAIMER =
  "Work-relatedness is the most frequently disputed determination in Part 1904. This applies the " +
  "1904.5(b)(2) exception list deterministically; it does not establish the underlying facts, and " +
  "contested cases warrant counsel.";

/**
 * Input shape for `osha_assess_work_relatedness`. Per-field documentation is carried by the
 * Zod `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const assessWorkRelatednessInputShape = {
  occurred_in_work_environment: z
    .boolean()
    .describe(
      "Did the event or exposure occur in the work environment as defined by 1904.5(b)(1) — the " +
        "establishment and other locations where employees work or are present as a condition of " +
        "employment, including equipment and materials used in the course of work?"
    ),
  origin_is_clear: z
    .boolean()
    .describe(
      "Is it clear whether the precipitating event occurred at work or away from work? Pass false when " +
        "the narrative genuinely does not establish this — 1904.5(b)(3) then requires the employer to " +
        "evaluate the employee's duties and environment, which this tool cannot do."
    ),
  claimed_exception: z
    .enum([...EXCEPTION_CODES, "none"] as [string, ...string[]])
    .describe(
      "Which 1904.5(b)(2) exception is claimed, if any. Use 'none' when no exception is asserted. One of: " +
        [...EXCEPTION_CODES, "none"].join(", ") +
        "."
    ),
  exception_solely_established: z
    .boolean()
    .default(false)
    .describe(
      "Has it been affirmatively established that the injury results SOLELY from the claimed exception? " +
        "Every 1904.5(b)(2) exception requires this and it is a factual finding, not a lookup. Pass false " +
        "when unverified — the tool will return requires_judgment rather than apply the exception."
    ),
  pre_existing_condition: z
    .boolean()
    .default(false)
    .describe(
      "Is this a pre-existing condition — one that resulted solely from a non-work-related event outside " +
        "the work environment (1904.5(b)(5))? If so it is work-related only if significantly aggravated."
    ),
  aggravation_tests_met: z
    .array(z.enum(AGGRAVATION_CODES))
    .default([])
    .describe(
      "Which 1904.5(b)(4) significant-aggravation tests the workplace event caused. Closed list — nothing " +
        "else counts as significant aggravation. One of: " +
        AGGRAVATION_CODES.join(", ") +
        "."
    ),
  mental_illness_plhcp_opinion_volunteered: z
    .boolean()
    .default(false)
    .describe(
      "For a mental illness only: has the employee VOLUNTARILY given the employer a PLHCP opinion stating " +
        "the illness is work-related? Under 1904.5(b)(2)(ix) a mental illness is not work-related without one."
    ),
  special_situation: z
    .enum(["none", "travel_status", "working_at_home"])
    .default("none")
    .describe(
      "Whether the employee was on travel status (1904.5(b)(6)) or working at home (1904.5(b)(7)). Both are " +
        "fact-heavy and resolve to requires_judgment with the governing test returned."
    ),
};

const InputSchema = z.object(assessWorkRelatednessInputShape);
export type AssessWorkRelatednessInput = z.infer<typeof InputSchema>;

/**
 * Evaluates whether an injury or illness is work-related under 29 CFR § 1904.5.
 *
 * This function applies the 1904.5(a) presumption of work-relatedness for events in
 * the work environment, and resolves exceptions under 1904.5(b)(2) or significant
 * aggravation rules under 1904.5(b)(4) for pre-existing conditions.
 *
 * It yields:
 * - `"work_related"` if the presumption holds or significant aggravation is met.
 * - `"not_work_related"` if a specific exception is met or pre-existing aggravation is not met.
 * - `"requires_judgment"` for travel detours, remote work, unclear origin, or when
 *   the factual finding of "solely" is unestablished.
 *
 * @param input The parameters containing work environment presence, claimed exceptions, and aggravation tests.
 * @returns A cited RuleRecord containing the work-relatedness determination.
 */
export function assessWorkRelatedness(
  input: AssessWorkRelatednessInput
): RuleRecord<WorkRelatednessDetermination> {
  const build = (
    verdict: WorkRelatednessVerdict,
    basis: string,
    cites: string[],
    applied: string | null = null,
    judgment: WorkRelatednessDetermination["judgment_required"] = null
  ) =>
    ruleRecord(
      data.provenance,
      {
        verdict,
        work_related: verdict === "requires_judgment" ? null : verdict === "work_related",
        basis,
        applied_exception: applied,
        cfr_cites: cites,
        judgment_required: judgment,
        disclaimer: DISCLAIMER,
      },
      cites[0] ?? data.provenance.cfr_cite
    );

  // 1904.5(b)(3): unclear origin is expressly the employer's evaluation to make.
  if (!input.origin_is_clear) {
    const p = data.judgment_paths.unclear_origin;
    return build("requires_judgment", `Origin of the precipitating event is not established. ${p.description}`, [p.cfr_cite], null, {
      question:
        "Did one or more events or exposures in the work environment cause, contribute to, or significantly aggravate this condition?",
      why: p.description,
      cfr_cite: p.cfr_cite,
    });
  }

  // 1904.5(b)(6) and (b)(7): rule-shaped but fact-bound. Return the governing test.
  if (input.special_situation !== "none") {
    const p =
      input.special_situation === "travel_status"
        ? data.judgment_paths.travel_status
        : data.judgment_paths.working_at_home;
    return build("requires_judgment", p.description, [p.cfr_cite], null, {
      question:
        input.special_situation === "travel_status"
          ? "Was the employee engaged in work activities in the interest of the employer at the time — and had they checked into a temporary residence, or taken a personal detour?"
          : "Did the injury occur while performing work for pay in the home, and was it directly related to the performance of work rather than the general home environment?",
      why: p.description,
      cfr_cite: p.cfr_cite,
    });
  }

  if (!input.occurred_in_work_environment) {
    return build(
      "not_work_related",
      "The event or exposure did not occur in the work environment (1904.5(b)(1)), so the 1904.5(a) presumption does not attach.",
      [data.work_environment.cfr_cite]
    );
  }

  // Mental illness carries its own rule, and it runs the opposite way to the other
  // exceptions: the case is NOT work-related unless a PLHCP opinion was volunteered.
  if (input.claimed_exception === "mental_illness_without_plhcp_opinion") {
    const ex = data.exceptions.mental_illness_without_plhcp_opinion;
    if (input.mental_illness_plhcp_opinion_volunteered) {
      return build(
        "work_related",
        "Work-related: the employee voluntarily provided a PLHCP opinion stating the mental illness is work-related, so the 1904.5(b)(2)(ix) exception does not apply.",
        [ex.cfr_cite, data.presumption.cfr_cite]
      );
    }
    return build(
      "not_work_related",
      "Not work-related: a mental illness is not work-related unless the employee voluntarily provides a PLHCP opinion stating that it is (1904.5(b)(2)(ix)). No such opinion has been volunteered.",
      [ex.cfr_cite],
      "mental_illness_without_plhcp_opinion"
    );
  }

  if (input.claimed_exception !== "none") {
    const ex = data.exceptions[input.claimed_exception];
    if (!input.exception_solely_established) {
      return build("requires_judgment", `A 1904.5(b)(2) exception was claimed but the "solely" requirement is not established. ${ex.description}`, [ex.cfr_cite], null, {
        question: `Is it established that this resulted SOLELY from the claimed exception (${input.claimed_exception.replace(/_/g, " ")}), with no work-related event or exposure contributing?`,
        why: "Every 1904.5(b)(2) exception applies only when the injury results solely from the excepted circumstance. Absent that finding the 1904.5(a) presumption of work-relatedness stands.",
        cfr_cite: ex.cfr_cite,
      });
    }
    return build(
      "not_work_related",
      `Not work-related: ${ex.description} (${ex.cfr_cite}).`,
      [ex.cfr_cite],
      input.claimed_exception
    );
  }

  // Pre-existing conditions reach work-relatedness only through 1904.5(b)(4).
  if (input.pre_existing_condition) {
    const agg = data.significant_aggravation;
    if (input.aggravation_tests_met.length === 0) {
      return build(
        "not_work_related",
        `Not work-related: a pre-existing condition (1904.5(b)(5)) is work-related only if a workplace event significantly aggravated it, and none of the four closed tests in ${agg.cfr_cite} is met.`,
        [agg.cfr_cite, "1904.5(b)(5)"]
      );
    }
    const cites = input.aggravation_tests_met.map((t) => agg.tests[t].cfr_cite);
    return build(
      "work_related",
      `Work-related: a workplace event significantly aggravated a pre-existing condition (${cites.join(", ")}).`,
      cites
    );
  }

  return build(
    "work_related",
    `Work-related by the 1904.5(a) presumption: the event or exposure occurred in the work environment and no 1904.5(b)(2) exception applies.`,
    [data.presumption.cfr_cite]
  );
}
