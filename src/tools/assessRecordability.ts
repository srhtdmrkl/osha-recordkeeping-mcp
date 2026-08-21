import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import {
  ruleRecord,
  type FirstAidDataset,
  type RuleRecord,
  type RecordabilityDetermination,
} from "../types.js";

/**
 * Closed list of 14 first-aid treatments under 1904.7(b)(5)(ii).
 * Any treatment not on this list is considered medical treatment and makes a case recordable.
 */
const firstAid = loadDataset<FirstAidDataset>("first-aid-treatments");

const FIRST_AID_CODES = new Set(firstAid.treatments.map((t) => t.code));

/**
 * 1904.4(a)(3) is a disjunction: a work-related new case is recordable if it meets
 * the general criteria of 1904.7 OR the application to specific cases of 1904.8
 * through 1904.12. These are independent triggers — they never consult the closed
 * first-aid list, so a contaminated needlestick is recorded even when the only
 * treatment was cleaning and a bandage.
 */
interface SpecificCaseCriterion {
  cfr_cite: string;
  title: string;
  description: string;
  basis: string;
  aliases: string[];
  /** 1904.8 cases carry log-entry consequences the criterion itself decides. */
  log_entry_note?: string;
}
interface SpecificCaseData extends WithProvenance {
  criteria: Record<string, SpecificCaseCriterion>;
  medical_removal_rules: {
    voluntary_early_removal: { cfr_cite: string; rule: string };
  };
  tuberculosis_rules: {
    pre_employment_test: { cfr_cite: string; rule: string };
  };
}

/**
 * Specific-case recording criteria (1904.8 through 1904.12) and their exceptions.
 * These are independent recording triggers that do not consult the first-aid list.
 */
const specificCases = loadDataset<SpecificCaseData>("specific-case-criteria");
const SPECIFIC_CASE_CODES = Object.keys(specificCases.criteria) as [string, ...string[]];

/**
 * 1904.7(b)(5)(i) excludes two things from "medical treatment" that look exactly
 * like it to a safety manager: a visit purely for observation or counselling, and
 * diagnostic procedures such as x-rays and blood tests. Without codes for these the
 * calling model has nowhere to put "sent to the clinic, they took an x-ray" except
 * `other_medical_treatment` — which records a case that is not recordable, in the
 * over-recording direction that inflates TRIR.
 */
interface GeneralCriteriaData extends WithProvenance {
  medical_treatment_exclusions: {
    cfr_cite: string;
    definition: string;
    exclusions: Record<string, { cfr_cite: string; description: string; aliases: string[] }>;
  };
  professional_status_irrelevant: { cfr_cite: string; rule: string };
  recommendation_not_followed: {
    cfr_cite: string;
    rule: string;
    situations: Record<string, { cfr_cite: string; description: string; outcome: string }>;
  };
}

/**
 * General recording criteria rules, exclusions, and recommendation handling under 1904.7.
 */
const general = loadDataset<GeneralCriteriaData>("general-criteria");
const EXCLUDED_TREATMENT_CODES = Object.keys(general.medical_treatment_exclusions.exclusions);
const NOT_FOLLOWED_CODES = Object.keys(general.recommendation_not_followed.situations) as [
  string,
  ...string[],
];

/**
 * Common medical-treatment codes. This list is NOT authoritative for
 * recordability — the authoritative test is "is the treatment in the closed
 * first-aid list?" These codes exist so the calling model can name a treatment
 * explicitly rather than pass free text. Anything here (and `other_medical_treatment`)
 * is by definition not on the first-aid list, so it drives a recordable result.
 */
const MEDICAL_TREATMENT_CODES = [
  "sutures_or_staples",
  "prescription_medication",
  "prescription_strength_otc",
  "rigid_immobilization_device",
  "physical_therapy_or_chiropractic",
  "surgical_debridement",
  "immunization_other_than_tetanus",
  "other_medical_treatment",
] as const;

/**
 * Ambiguous case: the narrative mentions medication but not its strength.
 * Nonprescription-strength is first aid (1904.7(b)(5)(ii)(A)); prescription-strength
 * is medical treatment and recordable. The server resolves this via elicitation;
 * if it reaches the pure function unresolved, we treat it conservatively as
 * recordable-pending-confirmation rather than silently guessing.
 */
export const AMBIGUOUS_MEDICATION_CODE = "medication_unspecified_strength";

/**
 * The two codes the ambiguous one resolves into. Named here, next to the
 * treatment vocabulary they belong to, so the elicitation layer cannot drift
 * from the codes this function actually accepts.
 */
export const MEDICATION_STRENGTH_CODES = {
  nonprescription: "non_prescription_medication",
  prescription: "prescription_strength_otc",
} as const;

const TREATMENT_CODES = [
  ...firstAid.treatments.map((t) => t.code),
  ...MEDICAL_TREATMENT_CODES,
  ...EXCLUDED_TREATMENT_CODES,
  AMBIGUOUS_MEDICATION_CODE,
] as unknown as [string, ...string[]];

/** Neither first aid nor medical treatment — expressly excluded by (b)(5)(i). */
const EXCLUDED_CODES = new Set(EXCLUDED_TREATMENT_CODES);

const OUTCOME_CITES: Record<string, string> = {
  death: "1904.7(b)(1)",
  days_away_from_work: "1904.7(b)(3)",
  restricted_work_or_transfer: "1904.7(b)(4)",
  loss_of_consciousness: "1904.7(b)(1)",
};

const DIAGNOSIS_CITES: Record<string, string> = {
  cancer: "1904.7(b)(7)",
  chronic_irreversible_disease: "1904.7(b)(7)",
  fractured_or_cracked_bone: "1904.7(b)(7)",
  punctured_eardrum: "1904.7(b)(7)",
};

/** Outcomes that may trigger 1904.39 severe-injury reporting. */
const SEVERE_REPORTING_NOTE =
  "⚠ Severe-injury reporting may apply (1904.39). Report a fatality to OSHA within 8 hours; " +
  "an in-patient hospitalization, amputation, or loss of an eye within 24 hours. This is a " +
  "separate obligation from recording on the 300 log and applies even to partially exempt employers.";

/**
 * Input shape for `osha_assess_recordability`. Per-field documentation is carried by the Zod
 * `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const assessRecordabilityInputShape = {
  work_related: z
    .boolean()
    .describe("Did the work environment cause or contribute to the injury/illness? (1904.5)"),
  new_case: z
    .boolean()
    .describe("Is this a new case, not a continuation of a previously recorded one? (1904.6)"),
  // These three are REQUIRED, deliberately. A default of [] cannot be told apart
  // from "I checked and there were none", so defaulting them lets an
  // under-specified narrative return a confident, cited false negative — the
  // under-recording direction that draws a citation.
  outcomes: z
    .array(
      z.enum([
        "death",
        "days_away_from_work",
        "restricted_work_or_transfer",
        "loss_of_consciousness",
      ])
    )
    .describe(
      "General recording criteria outcomes present in this case. REQUIRED — pass [] only when the " +
        "narrative affirmatively establishes there were none. If the narrative is silent on time off " +
        "or work restrictions, ask the user before calling; do not pass [] to mean 'unknown'."
    ),
  significant_diagnoses: z
    .array(
      z.enum([
        "cancer",
        "chronic_irreversible_disease",
        "fractured_or_cracked_bone",
        "punctured_eardrum",
      ])
    )
    .describe(
      "Significant injuries/illnesses that are recordable even if only first aid was given (1904.7(b)(7)). " +
        "REQUIRED — pass [] only when affirmatively established, not when the narrative is silent."
    ),
  specific_case_criteria: z
    .array(z.enum(SPECIFIC_CASE_CODES))
    .describe(
      "Specific-case recording criteria under 1904.8-1904.12, which are INDEPENDENT of the first-aid " +
        "list: a case meeting one of these is recordable even when only first aid was given. One of: " +
        SPECIFIC_CASE_CODES.join(", ") +
        ". REQUIRED — pass [] only when affirmatively established. Note 'occupational_hearing_loss_sts' " +
        "asks whether the 1904.10 audiometric test is already MET; the tool does not compute the shift."
    ),
  medical_removal_was_voluntary_and_early: z
    .boolean()
    .default(false)
    .describe(
      "For a medical removal only: was the employee removed VOLUNTARILY, before the medical removal levels " +
        "required by the OSHA standard were reached? If so the case is NOT recordable (1904.9(b)(3)) — an " +
        "employer who acts early is not penalised. Leave false when the removal met the standard's criteria."
    ),
  tuberculosis_test_was_pre_employment: z
    .boolean()
    .default(false)
    .describe(
      "For a tuberculosis case only: was the positive skin test obtained at a PRE-EMPLOYMENT physical? If so " +
        "the case is NOT recordable (1904.11(b)(1)) — the employee was not occupationally exposed to a known " +
        "active case in your workplace."
    ),
  plhcp_recommendations_not_followed: z
    .array(z.enum(NOT_FOLLOWED_CODES))
    .default([])
    .describe(
      "Situations where a PLHCP recommended something and the employee did not follow it. The case is " +
        "recordable anyway — what was recommended controls, not what the employee did. One of: " +
        NOT_FOLLOWED_CODES.join(", ") +
        ". (1904.7(b)(3)(ii), (b)(4)(viii), (b)(5)(v))"
    ),
  treatments: z
    .array(z.enum(TREATMENT_CODES))
    .describe(
      "Controlled treatment codes. Map the incident narrative to these codes. First-aid codes come " +
        "from the closed 1904.7(b)(5)(ii) list; anything else is medical treatment. Use 'other_medical_treatment' if unsure. " +
        "If the report mentions medication but not its strength, use 'medication_unspecified_strength' — the strength " +
        "will be resolved by asking the user, either by the server or by you. Never guess it. " +
        "REQUIRED — pass [] only when the narrative affirmatively establishes no treatment was given. " +
        "Note two codes are NEITHER first aid nor medical treatment: 'observation_or_counseling_only' and " +
        "'diagnostic_procedure_only' (1904.7(b)(5)(i)) — an x-ray or a clinic visit to be checked out does " +
        "not make a case recordable. And the professional status of whoever provided the treatment is " +
        "irrelevant (1904.7(b)(5)(iv)): a bandage is first aid even when a physician applies it."
    ),
};

/**
 * Returned when nothing at all was asserted: no outcome, no diagnosis, no
 * treatment. That is a legitimate not-recordable case, but it is also exactly
 * what an under-specified narrative looks like, and the two are indistinguishable
 * from inside the function. So the caller is told which assumption it is resting on.
 */
export const COMPLETENESS_CLARIFICATION = {
  question:
    "The determination assumed no treatment was given, no days were lost or restricted, no significant " +
    "diagnosis was made, and no specific-case criterion of 1904.8-1904.12 applies (needlestick, medical " +
    "removal, hearing loss, tuberculosis). Does the incident report actually establish all of that, or was " +
    "it simply silent?",
  why:
    "An empty input and an affirmative 'none' produce the same not-recordable answer. If the narrative was " +
    "merely silent, this is a false negative — the under-recording direction that draws an OSHA citation.",
  options: [] as ReadonlyArray<{ answer: string; recall_with_treatment_code: string }>,
  instruction:
    "This determination is NOT final. Confirm with the user what treatment was given, whether any time was " +
    "lost or work restricted, whether a PLHCP made a significant diagnosis, and whether any specific-case " +
    "criterion of 1904.8-1904.12 applies. Then call osha_assess_recordability " +
    "again with those facts stated. Do not present this as a settled not-recordable determination.",
} as const;

const InputSchema = z.object(assessRecordabilityInputShape);
export type AssessRecordabilityInput = z.infer<typeof InputSchema>;

/**
 * Evaluates whether a work-related injury or illness is OSHA recordable under the
 * 29 CFR § 1904.4 decision tree. This is the anchor determination the rest of the chain
 * feeds into.
 *
 * The branches are evaluated in a deliberate order, because the order is what keeps the
 * errors in the safe direction:
 * 1. **Disqualifying guards.** A voluntary medical removal made early (1904.9(b)(3)) and a
 *    pre-employment positive TB test (1904.11(b)(1)) strip their own specific-case criterion
 *    before anything else runs — otherwise the tool penalises an employer for acting early.
 * 2. **Work-related AND new case** (1904.5, 1904.6). A continuation returns not-recordable
 *    *with* an instruction to update the existing entry, so a manager cannot read it as
 *    "close the file".
 * 3. **Specific-case criteria of 1904.8–1904.12**, checked before 1904.7 because they never
 *    consult the first-aid list — a first-aid-only needlestick must never fall through to
 *    "not recordable".
 * 4. **PLHCP recommendations not followed** (1904.7(b)(3)) — the case is recorded on what was
 *    recommended, not on what the employee did.
 * 5. **General recording criteria** (1904.7(b)(1)), then significant diagnoses (1904.7(b)(7)),
 *    then treatment measured against the closed first-aid list in 1904.7(b)(5)(ii).
 *
 * When every signal array is empty the result carries `under_specified: true`. A genuine
 * no-treatment case and a narrative the caller never filled in are indistinguishable from the
 * inputs, so the determination states which assumption it rests on rather than returning a
 * clean negative — the under-recording direction is the one that draws a citation.
 *
 * @param input The mapped incident facts: work-relatedness, new-case status, outcomes,
 *   treatments, significant diagnoses, and specific-case criteria.
 * @returns A cited RuleRecord containing the recordability determination, the triggering
 *   factors with their sub-clause citations, any 1904.39 reporting note, and log-entry notes.
 */
export function assessRecordability(
  input: AssessRecordabilityInput
): RuleRecord<RecordabilityDetermination> {
  const triggering: Array<{ factor: string; cfr_cite: string }> = [];
  let recordable = false;
  let basis: string;

  // 1904.9(b)(3): a voluntary removal made before the standard's medical removal
  // levels are reached is not recordable. Without this guard the tool penalises an
  // employer for acting early — a false positive in the over-recording direction.
  const voluntaryEarlyRemoval =
    input.medical_removal_was_voluntary_and_early &&
    input.specific_case_criteria.includes("medical_removal");
  // 1904.11(b)(1): a pre-employment positive skin test is not an occupational
  // exposure, so the criterion never attaches. Same shape as the removal guard.
  const preEmploymentTb =
    input.tuberculosis_test_was_pre_employment &&
    input.specific_case_criteria.includes("tuberculosis_infection");
  const disqualified = new Set<string>([
    ...(voluntaryEarlyRemoval ? ["medical_removal"] : []),
    ...(preEmploymentTb ? ["tuberculosis_infection"] : []),
  ]);
  const effectiveSpecificCases = input.specific_case_criteria.filter((c) => !disqualified.has(c));

  if (!input.work_related || !input.new_case) {
    basis = !input.work_related
      ? "Not work-related (1904.5). A case must be work-related to be recordable."
      : // The 1904.4(b)(2) decision tree does not end here: a continuation is not a
        // new entry, but the existing entry may still need updating. Saying only
        // "not recordable" invites a manager to close a file that is still open.
        "Not a new case (1904.6) — do not create a new 300-Log entry. This is a continuation of a " +
        "previously recorded case: UPDATE the existing entry if necessary (day counts, or a more " +
        "serious outcome than was originally recorded).";
  } else if (effectiveSpecificCases.length > 0) {
    // Checked before 1904.7 because these never consult the first-aid list. Running
    // them first means a first-aid-only needlestick can never fall through to a
    // "not recordable" answer.
    recordable = true;
    for (const s of effectiveSpecificCases) {
      const criterion = specificCases.criteria[s];
      triggering.push({ factor: `specific case: ${s}`, cfr_cite: criterion.cfr_cite });
    }
    basis = specificCases.criteria[effectiveSpecificCases[0]].basis;
    if (effectiveSpecificCases.length > 1) {
      basis += ` Additional specific-case criteria also met: ${effectiveSpecificCases
        .slice(1)
        .map((s) => specificCases.criteria[s].cfr_cite)
        .join(", ")}.`;
    }
  } else if (input.plhcp_recommendations_not_followed.length > 0) {
    // What the PLHCP recommended controls, not what the employee did. Three
    // separate paragraphs say so, and each is a place a manager under-records
    // because "he came in anyway" or "she refused the treatment".
    recordable = true;
    const sits = general.recommendation_not_followed.situations;
    for (const k of input.plhcp_recommendations_not_followed) {
      triggering.push({ factor: `PLHCP recommendation not followed: ${k}`, cfr_cite: sits[k].cfr_cite });
    }
    basis =
      `Recordable: ${sits[input.plhcp_recommendations_not_followed[0]].description} ` +
      `The case is recorded on what was recommended, not on what the employee did.`;
  } else if (input.outcomes.length > 0) {
    recordable = true;
    for (const o of input.outcomes) {
      triggering.push({ factor: `outcome: ${o}`, cfr_cite: OUTCOME_CITES[o] });
    }
    basis = "Recordable: meets one or more general recording criteria (1904.7(b)(1)).";
  } else if (input.significant_diagnoses.length > 0) {
    recordable = true;
    for (const d of input.significant_diagnoses) {
      triggering.push({ factor: `diagnosis: ${d}`, cfr_cite: DIAGNOSIS_CITES[d] });
    }
    basis =
      "Recordable: significant injury/illness diagnosed by a PLHCP, recordable regardless of treatment (1904.7(b)(7)).";
  } else {
    const hasAmbiguous = input.treatments.includes(AMBIGUOUS_MEDICATION_CODE);
    const medical = input.treatments.filter(
      (t: string) =>
        t !== AMBIGUOUS_MEDICATION_CODE && !FIRST_AID_CODES.has(t) && !EXCLUDED_CODES.has(t)
    );
    const excluded = input.treatments.filter((t: string) => EXCLUDED_CODES.has(t));
    if (medical.length > 0) {
      recordable = true;
      for (const t of medical) {
        triggering.push({ factor: `medical treatment: ${t}`, cfr_cite: "1904.7(b)(5)(i)" });
      }
      basis = "Recordable: medical treatment beyond first aid was provided (1904.7(b)(5)(i)).";
    } else if (hasAmbiguous) {
      recordable = true;
      triggering.push({
        factor: "medication of unspecified strength",
        cfr_cite: "1904.7(b)(5)(ii)(A)",
      });
      basis =
        "Recordable pending confirmation: medication strength was not specified. Nonprescription-strength " +
        "medication is first aid; prescription-strength medication is medical treatment and makes the case " +
        "recordable (1904.7(b)(5)(ii)(A)). Confirm the strength.";
    } else if (disqualified.size > 0) {
      const rule = voluntaryEarlyRemoval
        ? specificCases.medical_removal_rules.voluntary_early_removal
        : specificCases.tuberculosis_rules.pre_employment_test;
      basis =
        "Not recordable: " +
        rule.rule +
        ` (${rule.cfr_cite})` +
        (input.treatments.length
          ? " No other recording criterion is met on the treatment given."
          : "");
    } else if (input.treatments.length === 0) {
      basis =
        "Not recordable ON THE FACTS GIVEN — but nothing was asserted: no treatment, no outcome, no " +
        "significant diagnosis, no specific-case criterion. If the incident report was merely silent on " +
        "these rather than establishing there were none, this is a false negative. Confirm the facts " +
        "before relying on it.";
    } else {
      const voluntaryNote = voluntaryEarlyRemoval
        ? ` The medical removal was voluntary and made before the standard's removal levels were reached, ` +
          `so it is not recordable (${specificCases.medical_removal_rules.voluntary_early_removal.cfr_cite}).`
        : preEmploymentTb
          ? ` The positive TB test was obtained at a pre-employment physical, so it is not recordable ` +
            `(${specificCases.tuberculosis_rules.pre_employment_test.cfr_cite}).`
          : "";
      const exclusionNote = excluded.length
        ? ` Observation, counselling and diagnostic procedures such as x-rays are expressly NOT medical ` +
          `treatment (${general.medical_treatment_exclusions.cfr_cite}), so they do not make this recordable.`
        : "";
      basis =
        "Not recordable: work-related new case, but all treatment given is on the closed first-aid list " +
        "(1904.7(b)(5)(ii)), and no specific-case criterion of 1904.8-1904.12 applies." + voluntaryNote + exclusionNote;
    }
  }

  // Nothing asserted in any of the four signal arrays. A real no-treatment case
  // looks identical to a narrative the caller never filled in, so say which
  // assumption the answer rests on rather than presenting a clean negative.
  const underSpecified =
    input.work_related &&
    input.new_case &&
    input.outcomes.length === 0 &&
    input.significant_diagnoses.length === 0 &&
    effectiveSpecificCases.length === 0 &&
    disqualified.size === 0 &&
    input.plhcp_recommendations_not_followed.length === 0 &&
    input.treatments.length === 0;

  // 1904.39 covers fatality, in-patient hospitalization, amputation, loss of eye.
  // The current inputs don't capture hospitalization/amputation directly, so flag
  // conservatively on death or a significant diagnosis (which often means hospitalization)
  // and word it as "may apply".
  const severeNote =
    input.work_related &&
    input.new_case &&
    (input.outcomes.includes("death") || input.significant_diagnoses.length > 0)
      ? SEVERE_REPORTING_NOTE
      : null;

  // 1904.8(a) decides two things beyond recordability: the case goes on the log as
  // an INJURY, and the employee's name may NOT appear — it is an automatic privacy
  // case. Surfacing it here means the chain cannot silently drop the name rule.
  const logNotes = effectiveSpecificCases
    .map((s) => specificCases.criteria[s].log_entry_note)
    .filter((n): n is string => Boolean(n));

  return ruleRecord(
    firstAid.provenance,
    {
      recordable,
      basis,
      triggering_factors: triggering,
      severe_injury_reporting_note: severeNote,
      log_entry_notes: logNotes,
      under_specified: underSpecified,
    },
    // 1904.4 is the master recording rule; 1904.7 is one branch of 1904.4(a)(3).
    // Each triggering factor still carries the specific sub-clause that decided it.
    "1904.4"
  );
}
