import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import { ruleRecord, type RuleRecord } from "../types.js";

/** Represents a worker relationship type and its associated recording rules. */
interface Relationship {
  cfr_cite: string;
  recording_employer: "you" | "depends_on_supervision" | "no_one";
  supervision_decides: boolean;
  rule: string;
}
/** Dataset structure containing payroll categories and worker relationship definitions under 1904.31. */
interface CoveredEmployeeData extends WithProvenance {
  payroll_categories: { cfr_cite: string; rule: string; categories: string[] };
  relationships: Record<string, Relationship>;
  record_once: { cfr_cite: string; rule: string };
}

const data = loadDataset<CoveredEmployeeData>("covered-employees");
const RELATIONSHIP_CODES = Object.keys(data.relationships) as [string, ...string[]];

/** Which party carries the recording obligation, from the perspective of the employer asking. */
export type RecordingEmployer = "you" | "the_other_employer" | "no_one";

/**
 * The result of a recording-responsibility determination under 29 CFR § 1904.31: whose 300 Log
 * the case belongs on for temporary, leased, supplied, or contractor workers.
 */
export interface RecordingEmployerDetermination {
  recording_employer: RecordingEmployer;
  you_must_record: boolean;
  basis: string;
  /** True when day-to-day supervision was the deciding fact. */
  decided_by_supervision: boolean;
  /** 1904.31(b)(4): exactly one log, never both. Present for shared workers. */
  coordination_note: string | null;
  cfr_cites: string[];
  disclaimer: string;
}

const DISCLAIMER =
  "Recording-responsibility determination only (1904.31). It does not decide whether the case is recordable — " +
  "run the recordability chain separately — and it does not address joint-employer questions outside Part 1904.";

/**
 * Input shape for `osha_determine_recording_employer`. Per-field documentation is carried by
 * the Zod `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const determineRecordingEmployerInputShape = {
  worker_relationship: z
    .enum(RELATIONSHIP_CODES)
    .describe(
      "The injured person's relationship to the employer asking. One of: " +
        RELATIONSHIP_CODES.join(", ") +
        ". Note 'on_your_payroll' covers every category — labor, executive, hourly, salary, part-time, " +
        "seasonal and migrant workers all count (1904.31(a))."
    ),
  you_supervise_day_to_day: z
    .boolean()
    .default(false)
    .describe(
      "Do YOU supervise this worker's work on a day-to-day basis? This is the controlling test for " +
        "temporary, leased, supplied and contractor workers — not who issues the paycheck. Irrelevant for " +
        "payroll employees, the self-employed, and owners or partners."
    ),
};

const InputSchema = z.object(determineRecordingEmployerInputShape);
export type DetermineRecordingEmployerInput = z.infer<typeof InputSchema>;

/**
 * Evaluates which employer is responsible for recording an injury or illness under 29 CFR § 1904.31.
 *
 * This function resolves the threshold question of whether a case belongs on the employer's log
 * when a worker is not on the direct payroll (such as temporary, leased, supplied, or contractor employees).
 *
 * It applies the core regulatory principle:
 * 1. **Day-to-Day Supervision Binds:** If the employer provides day-to-day supervision (directing the details,
 *    means, and methods of work), they must record the case. If the supplying employer supervises, the
 *    supplying employer records it.
 * 2. **Payroll Status is Secondary:** The paycheck issuer does not determine the recording obligation.
 * 3. **Exclusion of Owners/Self-employed:** Self-employed workers and sole proprietors/partners are excluded
 *    from recordkeeping obligations.
 * 4. **Single-Log Coordination (1904.31(b)(4)):** Ensures the case is recorded exactly once (never on both logs).
 *
 * @param input The parameters containing worker relationship and day-to-day supervision status.
 * @returns A cited RuleRecord containing the recording responsibility determination.
 */
export function determineRecordingEmployer(
  input: DetermineRecordingEmployerInput
): RuleRecord<RecordingEmployerDetermination> {
  const rel = data.relationships[input.worker_relationship];

  let employer: RecordingEmployer;
  let basis: string;
  const cites = [rel.cfr_cite];

  if (rel.recording_employer === "no_one") {
    employer = "no_one";
    basis = rel.rule;
  } else if (rel.recording_employer === "you") {
    employer = "you";
    basis = rel.rule;
    cites.push(data.payroll_categories.cfr_cite);
  } else if (input.you_supervise_day_to_day) {
    // Supervision, not payroll, is the test. A temp on the agency's payroll whose
    // work you direct daily is your case to record.
    employer = "you";
    basis = `${rel.rule} You provide that day-to-day supervision, so the case goes on YOUR 300 Log.`;
  } else {
    employer = "the_other_employer";
    basis = `${rel.rule} You do not provide day-to-day supervision, so the case goes on the other employer's 300 Log, not yours.`;
  }

  // (b)(4) applies wherever two employers could each think it is theirs.
  const shared = rel.supervision_decides;
  if (shared) cites.push(data.record_once.cfr_cite);

  return ruleRecord(
    data.provenance,
    {
      recording_employer: employer,
      you_must_record: employer === "you",
      basis,
      decided_by_supervision: shared,
      coordination_note: shared ? data.record_once.rule : null,
      cfr_cites: cites,
      disclaimer: DISCLAIMER,
    },
    rel.cfr_cite
  );
}
