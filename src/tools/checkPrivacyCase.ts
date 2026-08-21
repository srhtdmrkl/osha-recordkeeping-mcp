import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import { ruleRecord, type RuleRecord } from "../types.js";

const data = loadDataset<PrivacyCaseData>("privacy-cases");

/** Represents a privacy concern case category under 1904.29(b)(7). */
interface Category {
  cfr_cite: string;
  description: string;
  conditional: boolean;
  requires?: string[];
  aliases: string[];
}
/** Represents an employer obligation that follows once a case is a privacy case. */
interface Obligation {
  cfr_cite: string;
  requirement: string;
}
/** Dataset structure for privacy cases, containing categories and obligations. */
interface PrivacyCaseData extends WithProvenance {
  categories: Record<string, Category>;
  obligations: Record<string, Obligation>;
  closed_list_rule: Obligation;
  disclosure_exceptions: {
    cfr_cite: string;
    note: string;
    exceptions: Record<string, { cfr_cite: string; description: string }>;
  };
}

/**
 * The result of a privacy concern case evaluation under 29 CFR § 1904.29(b)(6)-(9):
 * whether the employee's name may appear on the 300 Log, and what else follows once it
 * may not.
 */
export interface PrivacyCaseDetermination {
  privacy_case: boolean;
  basis: string;
  matched_category: string | null;
  /** What to write in the name field of the 300 Log. */
  log_name_entry: string;
  /** Everything the employer must do once a case is a privacy case. */
  required_actions: Array<{ action: string; cfr_cite: string }>;
  /**
   * The only three recipients who may receive the forms WITH identifying
   * information (1904.29(b)(10)). Anyone else gets a redacted copy.
   */
  disclosure_exceptions: Array<{ recipient: string; cfr_cite: string }>;
  disclaimer: string;
}

const CATEGORY_CODES = Object.keys(data.categories) as [string, ...string[]];
const CONDITIONAL_CODE = "other_illness_employee_requested";

const DISCLAIMER =
  "Recordkeeping determination only. Privacy-case status governs what goes on the 300 Log; it does not " +
  "change whether the case is recordable, and it does not address state law, medical confidentiality, or " +
  "workers' compensation obligations.";

/**
 * Input shape for `osha_check_privacy_case`. Per-field documentation is carried by the Zod
 * `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const checkPrivacyCaseInputShape = {
  nature: z
    .enum([...CATEGORY_CODES, "none_of_these"] as [string, ...string[]])
    .describe(
      "The nature of the case, mapped from the incident narrative. Use 'none_of_these' if the case does not " +
        "match any enumerated category. One of: " +
        [...CATEGORY_CODES, "none_of_these"].join(", ") +
        "."
    ),
  is_illness: z
    .boolean()
    .default(false)
    .describe(
      "Is this an illness (not an injury)? Only relevant to 1904.29(b)(7)(vi), which covers other ILLNESSES " +
        "and never injuries."
    ),
  employee_requested_name_omitted: z
    .boolean()
    .default(false)
    .describe(
      "Did the employee voluntarily request that their name not be entered on the log? Only relevant to " +
        "1904.29(b)(7)(vi), which covers other ILLNESSES."
    ),
};

const InputSchema = z.object(checkPrivacyCaseInputShape);
export type CheckPrivacyCaseInput = z.infer<typeof InputSchema>;

/**
 * Evaluates whether a recordable case is a privacy concern case under 29 CFR § 1904.29(b)(6)-(9).
 *
 * An employer must enter "privacy case" in the employee's name field if the case falls within
 * the closed list of six categories defined in 1904.29(b)(7). Crucially, 1904.29(b)(8) forbids
 * treating any other case as a privacy case (e.g., out of sympathy or general policy).
 *
 * It checks:
 * 1. Automatic categories (intimate body parts, sexual assault, mental illness, HIV/hepatitis/tuberculosis,
 *    needlestick/sharps injuries under 1904.8).
 * 2. The conditional category (other illnesses under 1904.29(b)(7)(vi), which applies only if the condition
 *    is an illness and the employee voluntarily requests omission).
 *
 * @param input The parameters containing the mapped nature of the case, illness status, and employee requests.
 * @returns A cited RuleRecord containing the privacy concern case determination.
 */
export function checkPrivacyCase(
  input: CheckPrivacyCaseInput
): RuleRecord<PrivacyCaseDetermination> {
  let privacy = false;
  let matched: string | null = null;
  let basis: string;
  let cite = data.closed_list_rule.cfr_cite;

  if (input.nature === "none_of_these") {
    basis =
      "Not a privacy concern case: the case does not fall within the enumerated list in 1904.29(b)(7). " +
      data.closed_list_rule.requirement +
      " Enter the employee's name on the 300 Log as normal.";
  } else if (input.nature === CONDITIONAL_CODE) {
    // (b)(7)(vi) is the only conditional branch: illnesses only, and only on the
    // employee's own initiative. Both gates must hold or the name goes on the log.
    const category = data.categories[CONDITIONAL_CODE];
    if (input.is_illness && input.employee_requested_name_omitted) {
      privacy = true;
      matched = CONDITIONAL_CODE;
      cite = category.cfr_cite;
      basis =
        "Privacy concern case: an other illness for which the employee voluntarily requested that their " +
        "name not be entered on the log (1904.29(b)(7)(vi)).";
    } else if (!input.is_illness) {
      cite = category.cfr_cite;
      basis =
        "Not a privacy concern case: 1904.29(b)(7)(vi) covers other ILLNESSES only. An injury does not " +
        "qualify under this category even when the employee asks to be left off the log. " +
        data.closed_list_rule.requirement;
    } else {
      cite = category.cfr_cite;
      basis =
        "Not a privacy concern case: 1904.29(b)(7)(vi) requires that the employee voluntarily request " +
        "omission of their name. No such request is recorded. If the employee does request it, re-run this check.";
    }
  } else {
    const category = data.categories[input.nature];
    privacy = true;
    matched = input.nature;
    cite = category.cfr_cite;
    basis = `Privacy concern case: ${category.description} (${category.cfr_cite}). This category is automatic — it does not depend on the employee asking.`;
  }

  const required_actions = privacy
    ? Object.values(data.obligations).map((o) => ({
        action: o.requirement,
        cfr_cite: o.cfr_cite,
      }))
    : [];

  return ruleRecord(
    data.provenance,
    {
      privacy_case: privacy,
      basis,
      matched_category: matched,
      log_name_entry: privacy ? "privacy case" : "the employee's name",
      required_actions,
      disclosure_exceptions: Object.values(data.disclosure_exceptions.exceptions).map((e) => ({
        recipient: e.description,
        cfr_cite: e.cfr_cite,
      })),
      disclaimer: DISCLAIMER,
    },
    cite
  );
}
