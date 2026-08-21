import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import { ruleRecord, type RuleRecord } from "../types.js";

const data = loadDataset<SevereReportingData>("severe-injury-reporting");

/** Represents the time window following an incident within which the severe outcome must occur to be reportable. */
interface EligibilityWindow {
  unit: "days" | "hours";
  amount: number;
}
/** Represents a specific 1904.39 severe-injury reporting rule. */
interface ReportingRule {
  deadline_hours: number;
  eligibility_window: EligibilityWindow;
  cfr_cite: string;
}
/** Dataset structure for severe-injury reporting rules under 1904.39. */
interface SevereReportingData extends WithProvenance {
  reporting: Record<string, ReportingRule>;
  reporting_methods: string[];
  definitions: {
    in_patient_hospitalization: {
      cfr_cite: string;
      definition: string;
      excluded: { cfr_cite: string; rule: string };
    };
    amputation: {
      cfr_cite: string;
      definition: string;
      includes: Record<string, string>;
      excludes: Record<string, string>;
    };
  };
  reporting_exclusions: {
    cfr_cite: string;
    note: string;
    exclusions: Record<string, { cfr_cite: string; rule: string }>;
  };
  required_information: { cfr_cite: string; items: string[] };
  area_office_closed: { cfr_cite: string; rule: string };
}

/**
 * The result of a severe-injury reporting evaluation under 29 CFR § 1904.39: whether OSHA
 * must be called directly, and how much of the 8- or 24-hour clock is left.
 */
export interface SevereReportingDetermination {
  reportable: boolean;
  outcome: string;
  deadline_iso: string | null;
  hours_remaining: number | null;
  overdue: boolean;
  eligibility_note: string;
  reporting_methods: string[];
  /** The eight things OSHA asks for on the call (1904.39(b)(2)). */
  required_information: string[];
  /**
   * True when the event is NOT reportable but must still go on the 300 Log —
   * a definitional miss or a 1904.39(b)(3)-(b)(4) exclusion. The distinction
   * matters: "no call to OSHA" is not "nothing to do".
   */
  still_recordable: boolean;
  /** Set when a datetime could not be parsed; the deadline is then uncomputable. */
  input_error: string | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const ISO_HINT =
  "Supply a full ISO 8601 datetime, e.g. 2026-07-25T09:40:00-05:00. Relative phrasing " +
  "like 'yesterday morning' cannot be used to compute a legal deadline.";

const AMPUTATION_KINDS = [
  ...Object.keys(data.definitions.amputation.includes),
  ...Object.keys(data.definitions.amputation.excludes),
] as [string, ...string[]];
const EXCLUSION_CODES = Object.keys(data.reporting_exclusions.exclusions) as [string, ...string[]];

/**
 * Input shape for `osha_check_severe_injury_reporting`. Per-field documentation is carried
 * by the Zod `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const checkSevereInjuryReportingInputShape = {
  outcome: z
    .enum(["fatality", "in_patient_hospitalization", "amputation", "loss_of_an_eye", "none"])
    .describe("The severe outcome, if any. 'none' means no 1904.39 reporting is triggered."),
  incident_datetime: z
    .string()
    .describe("ISO 8601 datetime of the work-related incident, e.g. 2026-07-25T09:40:00-05:00."),
  learned_datetime: z
    .string()
    .describe("ISO 8601 datetime the employer LEARNED of the outcome. Reporting deadlines run from this moment."),
  amputation_kind: z
    .enum([...AMPUTATION_KINDS, "not_applicable"] as [string, ...string[]])
    .default("not_applicable")
    .describe(
      "For an amputation only: what kind. 1904.39(b)(11) defines amputation as the traumatic loss of a limb " +
        "or external body part, and expressly EXCLUDES avulsions, enucleations, deglovings, scalpings, " +
        "severed ears, and broken or chipped teeth. Fingertip amputations count with or without bone loss, " +
        "as do medical amputations and parts since reattached. One of: " +
        [...AMPUTATION_KINDS, "not_applicable"].join(", ") +
        "."
    ),
  hospitalization_for_observation_or_diagnostics_only: z
    .boolean()
    .default(false)
    .describe(
      "For an in-patient hospitalization only: was the admission for OBSERVATION or DIAGNOSTIC TESTING " +
        "alone? If so it is not reportable (1904.39(b)(10)) — only admissions for care or treatment are."
    ),
  reporting_exclusion: z
    .enum([...EXCLUSION_CODES, "none"] as [string, ...string[]])
    .default("none")
    .describe(
      "Whether a 1904.39(b)(3)-(b)(4) reporting exclusion applies. A motor vehicle accident on a public " +
        "street or highway is excluded UNLESS it happened in a construction work zone; events on commercial " +
        "or public transport (airplane, train, subway, bus) are excluded. Either way the event is still " +
        "RECORDABLE. One of: " +
        [...EXCLUSION_CODES, "none"].join(", ") +
        "."
    ),
  outcome_datetime: z
    .string()
    .optional()
    .describe(
      "ISO 8601 datetime the outcome occurred (e.g. date of death). Used to check the eligibility window " +
        "(fatality within 30 days of incident; hospitalization/amputation/eye loss within 24 hours). If omitted, the window cannot be verified."
    ),
};

const InputSchema = z.object(checkSevereInjuryReportingInputShape);
export type CheckSevereInjuryReportingInput = z.infer<typeof InputSchema>;

function windowMs(w: EligibilityWindow): number {
  return w.unit === "days" ? w.amount * DAY_MS : w.amount * HOUR_MS;
}

/** null rather than an Invalid Date, so callers must handle the bad-input case. */
function parseIso(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Evaluates severe-injury reporting requirements and calculates reporting deadlines under 29 CFR § 1904.39.
 *
 * This function determines if a work-related incident must be reported directly to OSHA
 * (e.g. within 8 hours for a fatality, or 24 hours for in-patient hospitalization, amputation, or loss
 * of an eye). Deadlines run from the moment the employer *learns* of the outcome.
 *
 * It validates:
 * 1. Definitional boundaries (e.g., admitting for observation only is not reportable; specific physical
 *    criteria for amputations).
 * 2. Reporting exclusions (e.g., motor vehicle accidents on public highways outside work zones).
 * 3. The eligibility window (the outcome must occur within 30 days of the incident for a fatality, or 24 hours
 *    for hospitalization, amputation, or loss of an eye).
 * 4. Remaining time and overdue status against the current time.
 *
 * @param input The parameters containing dates, times, and characteristics of the severe outcome.
 * @param now Current timestamp in milliseconds (injected so the overdue logic is testable, defaults to `Date.now()`).
 * @returns A cited RuleRecord containing the severe injury reporting determination.
 */
export function checkSevereInjuryReporting(
  input: CheckSevereInjuryReportingInput,
  now: number = Date.now()
): RuleRecord<SevereReportingDetermination> {
  const notReportable = (
    eligibility_note: string,
    input_error: string | null = null,
    stillRecordable = false
  ): SevereReportingDetermination => ({
    reportable: false,
    outcome: input.outcome,
    deadline_iso: null,
    hours_remaining: null,
    overdue: false,
    eligibility_note,
    reporting_methods: [],
    required_information: [],
    still_recordable: stillRecordable,
    input_error,
  });

  if (input.outcome === "none") {
    return ruleRecord(
      data.provenance,
      notReportable(
        "No fatality, in-patient hospitalization, amputation, or loss of an eye — 1904.39 reporting is not triggered."
      ),
      "1904.39"
    );
  }

  const rule = data.reporting[input.outcome];
  const defs = data.definitions;

  // 1904.39(b)(11): the word "amputation" is defined, and the definition excludes
  // six things people call amputations. A severed ear is not one.
  if (input.outcome === "amputation" && input.amputation_kind in defs.amputation.excludes) {
    return ruleRecord(
      data.provenance,
      notReportable(
        `Not reportable: ${defs.amputation.excludes[input.amputation_kind]} 1904.39(b)(11) defines an ` +
          `amputation as ${defs.amputation.definition.toLowerCase()} and expressly excludes this. The injury ` +
          `must still be RECORDED on the 300 Log if it meets the 1904.7 criteria.`,
        null,
        true
      ),
      defs.amputation.cfr_cite
    );
  }

  // 1904.39(b)(10): an admission for observation or diagnostics alone is not the
  // "care or treatment" the definition requires.
  if (
    input.outcome === "in_patient_hospitalization" &&
    input.hospitalization_for_observation_or_diagnostics_only
  ) {
    return ruleRecord(
      data.provenance,
      notReportable(
        `Not reportable: ${defs.in_patient_hospitalization.excluded.rule} The hospitalization must still be ` +
          `RECORDED on the 300 Log if it meets the 1904.7 criteria.`,
        null,
        true
      ),
      defs.in_patient_hospitalization.excluded.cfr_cite
    );
  }

  // 1904.39(b)(3)-(b)(4): reporting exclusions. These end the call to OSHA and
  // nothing else — the case stays on the log.
  if (input.reporting_exclusion !== "none") {
    const ex = data.reporting_exclusions.exclusions[input.reporting_exclusion];
    return ruleRecord(
      data.provenance,
      notReportable(`Not reportable to OSHA: ${ex.rule} ${data.reporting_exclusions.note}`, null, true),
      ex.cfr_cite
    );
  }

  // A malformed datetime must not throw: this tool exists to produce a deadline,
  // and a crash tells the user nothing about the obligation they still have.
  const learned = parseIso(input.learned_datetime);
  const incident = parseIso(input.incident_datetime);
  const badFields = [
    incident ? null : "incident_datetime",
    learned ? null : "learned_datetime",
    input.outcome_datetime && !parseIso(input.outcome_datetime) ? "outcome_datetime" : null,
  ].filter((f): f is string => f !== null);

  if (badFields.length > 0 || !learned || !incident) {
    return ruleRecord(
      data.provenance,
      notReportable(
        `Deadline not computed — could not parse ${badFields.join(", ")}. The reporting obligation under ` +
          `${rule.cfr_cite} still stands: a ${input.outcome.replace(/_/g, " ")} must be reported within ` +
          `${rule.deadline_hours} hours of the employer learning of it. Re-run with a valid datetime.`,
        `Unparseable datetime in: ${badFields.join(", ")}. ${ISO_HINT}`
      ),
      rule.cfr_cite
    );
  }

  // Eligibility window: the outcome must occur within the window after the incident.
  let eligible = true;
  let eligibilityNote: string;
  const outcomeAt = input.outcome_datetime ? parseIso(input.outcome_datetime) : null;
  if (outcomeAt) {
    const gap = outcomeAt.getTime() - incident.getTime();
    eligible = gap >= 0 && gap <= windowMs(rule.eligibility_window);
    eligibilityNote = eligible
      ? `Within the ${rule.eligibility_window.amount} ${rule.eligibility_window.unit} eligibility window of the incident (${rule.cfr_cite}).`
      : `Outcome occurred outside the ${rule.eligibility_window.amount} ${rule.eligibility_window.unit} window after the incident — not reportable under ${rule.cfr_cite}. Verify manually.`;
  } else {
    eligibilityNote = `Eligibility window not verified (outcome_datetime not provided). A ${input.outcome.replace(/_/g, " ")} is reportable only if it occurs within ${rule.eligibility_window.amount} ${rule.eligibility_window.unit} of the incident (${rule.cfr_cite}).`;
  }

  const deadline = new Date(learned.getTime() + rule.deadline_hours * HOUR_MS);
  const hoursRemaining = (deadline.getTime() - now) / HOUR_MS;

  return ruleRecord(
    data.provenance,
    {
      reportable: eligible,
      outcome: input.outcome,
      deadline_iso: deadline.toISOString(),
      hours_remaining: Math.round(hoursRemaining * 10) / 10,
      overdue: hoursRemaining < 0,
      eligibility_note: eligibilityNote,
      reporting_methods: data.reporting_methods,
      required_information: data.required_information.items,
      still_recordable: true,
      input_error: null,
    },
    rule.cfr_cite
  );
}
