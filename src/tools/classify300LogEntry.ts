import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import { ruleRecord, type RuleRecord } from "../types.js";

const data = loadDataset<Log300Data>("log300-classification");

/**
 * 1904.8(b)(3): a recorded needlestick that later produces a bloodborne diagnosis
 * does not become a second case — the EXISTING entry is amended, and its
 * classification changes from injury to illness. Loaded from the 1904.8 dataset so
 * the rule text lives with the rest of that section.
 */
/** Dataset structure containing specific rules for reclassifications, medical removals, and tuberculosis cases. */
interface SpecificCaseRules extends WithProvenance {
  bloodborne_pathogens: { reclassify_on_later_diagnosis: { cfr_cite: string; rule: string } };
  medical_removal_rules: { classification: { cfr_cite: string; rule: string } };
  tuberculosis_rules: {
    line_out_circumstances: {
      cfr_cite: string;
      note: string;
      circumstances: Record<string, { cfr_cite: string; description: string }>;
    };
  };
}
/** Dataset structure for OSHA forms and deadlines under 1904.29. */
interface RecordingFormsData extends WithProvenance {
  forms: { cfr_cite: string; required: Record<string, string> };
  recording_deadline: { cfr_cite: string; days: number; rule: string };
}
const forms = loadDataset<RecordingFormsData>("recording-forms");
const DAY_MS = 86_400_000;

const specificRules = loadDataset<SpecificCaseRules>("specific-case-criteria");
const bbp = specificRules.bloodborne_pathogens;
const mrClassification = specificRules.medical_removal_rules.classification;
const tbLineOut = specificRules.tuberculosis_rules.line_out_circumstances;
const TB_LINE_OUT_CODES = Object.keys(tbLineOut.circumstances) as [string, ...string[]];

/** Dataset structure containing outcome and illness type columns for the 300 Log. */
interface Log300Data extends WithProvenance {
  outcome_columns: Record<string, string>;
  illness_type_columns: Record<string, string>;
  day_count_cap: number;
  day_count_cap_cite: string;
}

/**
 * One shape for both answers. A union would force every field optional in the
 * declared outputSchema, which leaves clients probing for key presence instead
 * of reading a contract — `on_log` is the discriminator to branch on.
 */
export interface Log300Classification {
  /** False when the case is not recordable and therefore never reaches the log. */
  on_log: boolean;
  outcome_column: "G" | "H" | "I" | "J" | null;
  outcome_column_label: string | null;
  illness_type_column: string | null;
  days_away_recorded: number;
  days_restricted_or_transfer_recorded: number;
  capped: boolean;
  notes: string[];
  /** 1904.29(b)(3): 7 calendar days from receiving the information. */
  record_by_iso: string | null;
  /** 1904.29(b)(2): the 301 is required for every case, not just the 300 line. */
  forms_required: string[];
  /** Set when 1904.8(b)(3) requires amending an existing entry rather than adding one. */
  amend_existing_entry: string | null;
}

/**
 * Input shape for `osha_classify_300_log_entry`. Per-field documentation is carried by the
 * Zod `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const classify300LogEntryInputShape = {
  is_recordable: z
    .boolean()
    .describe("Is the case recordable? Run osha_assess_recordability first. If false, it does not go on the 300 Log."),
  death: z.boolean().default(false).describe("Did the injury/illness result in death?"),
  days_away_from_work: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "CALENDAR days away from work. Do NOT count the day the injury occurred (1904.7(b)(3)(i)). Count " +
        "calendar days the employee was unable to work regardless of schedule — weekends, holidays and " +
        "vacation days are included if they could not have worked (1904.7(b)(3)(iv)). If a PLHCP " +
        "recommended a return date but the employee stayed home, end the count there (1904.7(b)(3)(iii))."
    ),
  days_restricted_or_transfer: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "CALENDAR days of job transfer or restricted work, counted the same way as days away " +
        "(1904.7(b)(4)(xi)). Run osha_evaluate_restricted_work first — not every restriction counts. If " +
        "the employee was permanently reassigned to a job that eliminates the restricted functions, the " +
        "count may stop when that becomes permanent, but at least ONE day must be counted."
    ),
  medical_removal_case: z
    .boolean()
    .default(false)
    .describe(
      "Is this a medical removal case? 1904.9(b)(1) requires it be entered as EITHER days away OR restricted " +
        "work depending on how the removal requirement was met — 'other recordable' (column J) is not available."
    ),
  medical_removal_from_chemical_exposure: z
    .boolean()
    .default(false)
    .describe(
      "Did the medical removal follow a CHEMICAL exposure? If so the POISONING column must be checked " +
        "(1904.9(b)(1)) — set illness_type to 'poisoning'."
    ),
  date_information_received: z
    .string()
    .optional()
    .describe(
      "ISO 8601 date the employer RECEIVED information that a recordable case occurred. 1904.29(b)(3) gives " +
        "7 calendar days from that moment — not from the incident — to complete both the 300 Log entry and " +
        "the 301 Incident Report."
    ),
  tuberculosis_case: z
    .boolean()
    .default(false)
    .describe("Is this a tuberculosis case? 1904.11(a) requires the RESPIRATORY CONDITION column."),
  tb_non_occupational_evidence: z
    .enum([...TB_LINE_OUT_CODES, "none"] as [string, ...string[]])
    .default("none")
    .describe(
      "For a TB case already on the log: evidence that the infection was NOT caused by occupational " +
        "exposure. 1904.11(b)(2) enumerates three circumstances and permits — does not require — lining out " +
        "or erasing the entry. One of: " +
        [...TB_LINE_OUT_CODES, "none"].join(", ") +
        "."
    ),
  bloodborne_diagnosis_after_recording: z
    .boolean()
    .default(false)
    .describe(
      "Has a case already recorded as a needlestick or sharps INJURY since produced a diagnosis of an " +
        "infectious bloodborne disease? 1904.8(b)(3) then requires the existing entry to be amended rather " +
        "than a new case recorded — including changing its classification from injury to illness."
    ),
  illness_type: z
    .enum([
      "injury",
      "skin_disorder",
      "respiratory_condition",
      "poisoning",
      "hearing_loss",
      "other_illness",
    ])
    .default("injury")
    .describe("The injury/illness type column (M)."),
};

const InputSchema = z.object(classify300LogEntryInputShape);
export type Classify300LogEntryInput = z.infer<typeof InputSchema>;

/**
 * Classifies a recordable case into the correct OSHA 300 Log columns and calculates day counts under 29 CFR § 1904.29.
 *
 * This function resolves:
 * 1. **Outcome Column (G/H/I/J):** Evaluates under the "most-serious-outcome" rule (fatality G > days away H
 *    > job restriction/transfer I > other J).
 * 2. **Illness Type (Column M):** Maps injury and illness types (hearing loss, poisoning, skin disorder, etc.).
 * 3. **Day Counts & Capping (1904.7(b)(3)-(4)):** Capping days away and restriction/transfer at 180 calendar days.
 * 4. **Forms and Deadlines:** Verifies required forms (Forms 300 & 301) and calculates the 7-calendar-day entry deadline (1904.29(b)(3)).
 * 5. **Amendments and Exceptions:** Handles special situations like reclassifications for later BBP diagnoses (1904.8(b)(3)) or permissive line-outs for non-occupational tuberculosis (1904.11(b)(2)).
 *
 * @param input The parameters containing recordability, outcome data, day counts, and special conditions.
 * @returns A cited RuleRecord containing the 300 Log classification results.
 */
export function classify300LogEntry(
  input: Classify300LogEntryInput
): RuleRecord<Log300Classification> {
  if (!input.is_recordable) {
    return ruleRecord(data.provenance, {
      on_log: false,
      outcome_column: null,
      outcome_column_label: null,
      illness_type_column: null,
      days_away_recorded: 0,
      days_restricted_or_transfer_recorded: 0,
      capped: false,
      notes: ["Case is not recordable, so it is not entered on the OSHA 300 Log."],
      record_by_iso: null,
      forms_required: [],
      amend_existing_entry: null,
    });
  }

  const cap = data.day_count_cap;
  const daysAway = Math.min(input.days_away_from_work, cap);
  const daysRestricted = Math.min(input.days_restricted_or_transfer, cap);
  const capped =
    input.days_away_from_work > cap || input.days_restricted_or_transfer > cap;

  // Most serious outcome wins the single outcome column.
  let column: "G" | "H" | "I" | "J";
  if (input.death) column = "G";
  else if (daysAway > 0) column = "H";
  else if (daysRestricted > 0) column = "I";
  else column = "J";

  const notes: string[] = [];

  // 1904.29(b)(2)-(b)(3): the 301 is as mandatory as the 300 line, and both are due
  // within 7 calendar days of the employer learning of the case.
  let recordBy: string | null = null;
  if (input.date_information_received) {
    const d = new Date(input.date_information_received);
    if (!Number.isNaN(d.getTime())) {
      recordBy = new Date(d.getTime() + forms.recording_deadline.days * DAY_MS).toISOString();
    } else {
      notes.push(
        `Could not parse date_information_received — supply an ISO 8601 date. ${forms.recording_deadline.rule}`
      );
    }
  }
  if (capped) {
    notes.push(`Day counts capped at ${cap} (${data.day_count_cap_cite}).`);
  }
  if (column === "H" && daysRestricted > 0) {
    notes.push(
      "Classified under days-away (H) as the more serious outcome, but both the days-away count (K) and the restriction count (L) are still recorded."
    );
  }
  if (column === "G") {
    notes.push("Fatality — check 1904.39 severe-injury reporting deadline separately.");
  }
  if (input.tuberculosis_case && input.illness_type !== "respiratory_condition") {
    notes.push(
      `A tuberculosis case is entered in the RESPIRATORY CONDITION column, not '${input.illness_type}' (1904.11(a)).`
    );
  }
  if (input.medical_removal_case && column === "J") {
    // (b)(1) removes column J from the menu: the employer chose days away or
    // restriction when they complied, and the log must say which.
    notes.push(
      `Column J is not available for a medical removal case. ${mrClassification.rule} (${mrClassification.cfr_cite})`
    );
  }
  if (input.medical_removal_from_chemical_exposure && input.illness_type !== "poisoning") {
    notes.push(
      `Medical removal following a chemical exposure must be entered in the POISONING column, not '${input.illness_type}' (${mrClassification.cfr_cite}).`
    );
  }
  if (input.tb_non_occupational_evidence !== "none") {
    const c = tbLineOut.circumstances[input.tb_non_occupational_evidence];
    // "May", not "must" — the regulation permits removal, it does not compel it.
    notes.push(
      `You MAY line out or erase this TB case from the log: ${c.description} (${c.cfr_cite}). ${tbLineOut.note}`
    );
  }
  if (input.bloodborne_diagnosis_after_recording) {
    notes.push(
      `Do NOT record a second case. ${bbp.reclassify_on_later_diagnosis.rule} (${bbp.reclassify_on_later_diagnosis.cfr_cite})`
    );
  }

  return ruleRecord(data.provenance, {
    on_log: true,
    outcome_column: column,
    outcome_column_label: data.outcome_columns[column],
    illness_type_column: data.illness_type_columns[input.illness_type],
    days_away_recorded: daysAway,
    days_restricted_or_transfer_recorded: daysRestricted,
    capped,
    notes,
    record_by_iso: recordBy,
    forms_required: [forms.forms.required.osha_300, forms.forms.required.osha_301],
    amend_existing_entry: input.bloodborne_diagnosis_after_recording
      ? `${bbp.reclassify_on_later_diagnosis.rule} (${bbp.reclassify_on_later_diagnosis.cfr_cite})`
      : input.tb_non_occupational_evidence !== "none"
        ? `You may line out or erase this entry — ${tbLineOut.circumstances[input.tb_non_occupational_evidence].description} (${tbLineOut.circumstances[input.tb_non_occupational_evidence].cfr_cite}). This is permissive, not required.`
        : null,
  });
}
