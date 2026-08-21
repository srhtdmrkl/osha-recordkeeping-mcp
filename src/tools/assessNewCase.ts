import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import { ruleRecord, type RuleRecord } from "../types.js";

const data = loadDataset<NewCaseData>("new-case");

/** Represents a specific test rule within the new-case dataset. */
interface NewCaseTest {
  cfr_cite: string;
  verdict: "new_case" | "not_new_case";
  description: string;
  basis: string;
}
/** Dataset structure for new-case guidelines, containing test definitions and provenance. */
interface NewCaseData extends WithProvenance {
  tests: Record<string, NewCaseTest>;
  plhcp_override: {
    cfr_cite: string;
    statement: string;
    binding_basis: string;
    conflict_basis: string;
  };
}

/** The possible outcomes of a new-case evaluation. */
export type NewCaseVerdict = "new_case" | "not_new_case" | "requires_judgment";

/** The determination payload returned inside a RuleRecord. */
export interface NewCaseDetermination {
  verdict: NewCaseVerdict;
  /** Convenience boolean for feeding `osha_assess_recordability`; null when unresolved. */
  new_case: boolean | null;
  basis: string;
  applied_test: string | null;
  cfr_cites: string[];
  /** True when a PLHCP recommendation decided it, overriding the rule logic. */
  decided_by_plhcp: boolean;
  judgment_required: { question: string; why: string; cfr_cite: string } | null;
  /** Suggested action for the 300 Log when this is not a new case. */
  log_action: string;
  disclaimer: string;
}

const DISCLAIMER =
  "New-case determination only. It does not decide work-relatedness (1904.5) or whether the case meets " +
  "the recording criteria (1904.7). A PLHCP's recommendation, once sought, is binding under 1904.6(b)(3).";

const NEW_ENTRY = "Create a new entry on the OSHA 300 Log if the case is otherwise recordable.";
const UPDATE_ENTRY =
  "Do not create a new 300-Log entry. Update the existing entry if necessary — day counts, or a more " +
  "serious outcome than was originally recorded.";

/**
 * Input shape for `osha_assess_new_case`. Per-field documentation is carried by the Zod
 * `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const assessNewCaseInputShape = {
  prior_recorded_same_type_same_body_part: z
    .boolean()
    .describe(
      "Has the employee previously experienced a RECORDED injury or illness of the same type affecting the " +
      "same part of the body? (1904.6(a)(1)) If false, the case is new and nothing else needs deciding."
    ),
  plhcp_opinion: z
    .enum(["none", "new_case", "recurrence", "conflicting"])
    .default("none")
    .describe(
      "Any physician or licensed health care professional recommendation on whether this is a new case or a " +
      "recurrence. Under 1904.6(b)(3) an employer need not seek one, but MUST follow it once sought — so " +
      "this OVERRIDES the rule logic. Use 'conflicting' when two or more PLHCPs disagree; the employer " +
      "must then decide which is most authoritative."
    ),
  workplace_event_caused_current_symptoms: z
    .boolean()
    .default(false)
    .describe(
      "Did an event or exposure in the workplace cause the current signs or symptoms? (1904.6(b)(2)) An " +
      "episode of occupational asthma triggered by a workplace exposure is a new case even though the " +
      "asthma itself is not new."
    ),
  recovered_completely_from_prior: z
    .boolean()
    .default(false)
    .describe(
      "Had the employee recovered completely from the prior recorded case — ALL signs and symptoms had " +
      "disappeared — before the current signs or symptoms appeared? (1904.6(a)(2))"
    ),
  chronic_recurs_without_workplace_exposure: z
    .boolean()
    .default(false)
    .describe(
      "Is this an occupational illness whose signs or symptoms may recur or continue in the ABSENCE of a " +
      "workplace exposure? Examples may include occupational cancer, asbestosis, byssinosis and silicosis " +
      "(1904.6(b)(1)). This is a description of character, NOT a closed list of illnesses — judge the " +
      "condition, do not match the name. Such cases are recorded once only."
    ),
  causation_is_clear: z
    .boolean()
    .default(true)
    .describe(
      "Is it clear whether a workplace event caused the current signs or symptoms, as opposed to the " +
      "condition simply continuing? Pass false when the narrative does not establish this; the tool will " +
      "return requires_judgment rather than pick."
    ),
};

const InputSchema = z.object(assessNewCaseInputShape);
export type AssessNewCaseInput = z.infer<typeof InputSchema>;

/**
 * Evaluates whether an injury or illness is a new case under 29 CFR § 1904.6.
 *
 * This function determines if a case should be recorded as a new entry on the OSHA 300 Log
 * or if it is a continuation of an existing case (requiring updates instead of a new entry).
 * It applies the regulatory logic in sequence:
 * 1. Physician or Licensed Health Care Professional (PLHCP) recommendation override.
 * 2. Check if a prior recorded case of the same type exists on the same body part.
 * 3. Workplace event or exposure causing the current symptoms (which is a new case).
 * 4. Recurrence of a chronic condition without a new workplace exposure (which is a continuation).
 * 5. Falls back to requires_judgment if causation is unestablished.
 *
 * @param input The parameters containing prior case status, PLHCP opinions, and exposure details.
 * @returns A cited RuleRecord containing the new-case determination.
 */
export function assessNewCase(input: AssessNewCaseInput): RuleRecord<NewCaseDetermination> {
  const build = (
    verdict: NewCaseVerdict,
    basis: string,
    cites: string[],
    applied: string | null = null,
    opts: {
      plhcp?: boolean;
      judgment?: NewCaseDetermination["judgment_required"];
    } = {}
  ) =>
    ruleRecord(
      data.provenance,
      {
        verdict,
        new_case: verdict === "requires_judgment" ? null : verdict === "new_case",
        basis,
        applied_test: applied,
        cfr_cites: cites,
        decided_by_plhcp: opts.plhcp ?? false,
        judgment_required: opts.judgment ?? null,
        log_action:
          verdict === "new_case"
            ? NEW_ENTRY
            : verdict === "not_new_case"
              ? UPDATE_ENTRY
              : "Resolve the question below before touching the 300 Log.",
        disclaimer: DISCLAIMER,
      },
      cites[0] ?? data.provenance.cfr_cite
    );

  const override = data.plhcp_override;

  // 1904.6(b)(3) first: a recommendation, once sought, is binding. The rule logic
  // below never gets to overrule a PLHCP — that is the regulation's hierarchy,
  // not a preference.
  if (input.plhcp_opinion === "conflicting") {
    return build("requires_judgment", override.conflict_basis, [override.cfr_cite], null, {
      judgment: {
        question:
          "Which of the conflicting PLHCP recommendations is best documented, best reasoned, or most authoritative? Record the case on that basis.",
        why: override.statement,
        cfr_cite: override.cfr_cite,
      },
    });
  }
  if (input.plhcp_opinion === "new_case" || input.plhcp_opinion === "recurrence") {
    const verdict = input.plhcp_opinion === "new_case" ? "new_case" : "not_new_case";
    return build(
      verdict,
      `${override.binding_basis} The recommendation is that this is ${verdict === "new_case" ? "a new case" : "a recurrence of the previously recorded case"
      }.`,
      [override.cfr_cite],
      null,
      { plhcp: true }
    );
  }

  // 1904.6(a)(1): nothing prior of the same type on the same body part.
  if (!input.prior_recorded_same_type_same_body_part) {
    const t = data.tests.no_prior_recorded_case;
    return build("new_case", t.basis, [t.cfr_cite], "no_prior_recorded_case");
  }

  // A workplace event causing the current symptoms makes it a new case whether or
  // not the employee had recovered — 1904.6(b)(2) is the broader of the two tests.
  if (input.workplace_event_caused_current_symptoms) {
    const t = input.recovered_completely_from_prior
      ? data.tests.recovered_then_work_event_caused_reappearance
      : data.tests.workplace_event_caused_episode;
    const key = input.recovered_completely_from_prior
      ? "recovered_then_work_event_caused_reappearance"
      : "workplace_event_caused_episode";
    return build("new_case", t.basis, [t.cfr_cite], key);
  }

  // 1904.6(b)(1): chronic illnesses that recur without exposure are recorded once.
  // Checked after (b)(2) because a workplace exposure episode is a new case even in
  // a chronic condition — the exposure, not the illness, is what decides.
  if (input.chronic_recurs_without_workplace_exposure) {
    const t = data.tests.chronic_recurring_without_exposure;
    return build("not_new_case", t.basis, [t.cfr_cite], "chronic_recurring_without_exposure");
  }

  // Everything below turns on causation, so an unclear narrative stops here.
  if (!input.causation_is_clear) {
    return build(
      "requires_judgment",
      "It is not established whether a workplace event caused the current signs or symptoms or whether the previously recorded condition is simply continuing. That distinction decides the case.",
      ["1904.6(a)", "1904.6(b)(2)"],
      null,
      {
        judgment: {
          question:
            "Did an event or exposure in the work environment cause these signs or symptoms, or is this the previously recorded condition continuing?",
          why: "1904.6(b)(2) makes a workplace-caused episode a new case; absent such an event the case is a continuation of the one already recorded.",
          cfr_cite: "1904.6(b)(2)",
        },
      }
    );
  }

  const t = data.tests.continuing_symptoms_no_new_exposure;
  return build("not_new_case", t.basis, [t.cfr_cite], "continuing_symptoms_no_new_exposure");
}