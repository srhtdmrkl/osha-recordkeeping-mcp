import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import { ruleRecord, type RuleRecord } from "../types.js";

/** Dataset structure for recordkeeping obligation scope guidelines under 1904.1. */
interface ObligationData extends WithProvenance {
  size_exemption: {
    cfr_cite: string;
    threshold_employees: number;
    rule: string;
    scope: { cfr_cite: string; rule: string };
    measurement: { cfr_cite: string; rule: string };
  };
  over_ten_employees: { cfr_cite: string; rule: string };
  written_notification_override: { cfr_cite: string; also_cited: string[]; rule: string };
  survives_exemption: {
    cfr_cite: string;
    also_stated_at: string[];
    rule: string;
    why_this_matters: string;
  };
  industry_exemption: {
    cfr_cite: string;
    rule: string;
    scope: { cfr_cite: string; rule: string };
    non_exempt_establishments: { cfr_cite: string; rule: string };
    naics_determination: { cfr_cite: string; methods: string[] };
  };
}

/** Dataset structure for the partially exempt NAICS list (Appendix A to Subpart B). */
interface AppendixAData extends WithProvenance {
  match_rule: { granularity: string; rule: string };
  defeated_by: { cfr_cite: string; rule: string };
  industries: Record<string, string>;
}

const data = loadDataset<ObligationData>("recordkeeping-obligation");
const appendixA = loadDataset<AppendixAData>("partially-exempt-industries");
const THRESHOLD = data.size_exemption.threshold_employees;

/**
 * The result of a recordkeeping scope determination under 29 CFR § 1904.1 and § 1904.2:
 * whether Part 1904 recordkeeping applies to this employer at all, and which exemption
 * decided it.
 */
export interface RecordkeepingObligation {
  /** Must the employer keep the 300 Log, 300-A and 301 forms? */
  recordkeeping_required: boolean;
  basis: string;
  /** Which exemption applied, if any. */
  exemption: "none" | "size_1904_1" | "industry_1904_2";
  /** The Appendix A industry group matched, when a NAICS code was supplied. */
  matched_industry: { naics_group: string; title: string } | null;
  /**
   * ALWAYS true. 1904.39 reporting binds every employer covered by the OSH Act,
   * exempt or not — this is the inference an exempt employer gets wrong.
   */
  severe_injury_reporting_still_required: boolean;
  severe_injury_reporting_note: string;
  /**
   * How to determine the NAICS classification, returned when the company is over
   * the size threshold so the 1904.2 answer actually decides the outcome.
   */
  naics_determination_methods: string[];
  cfr_cites: string[];
  disclaimer: string;
}

const DISCLAIMER =
  "Scope determination only (1904.1 and 1904.2). It decides whether the recordkeeping requirements apply at " +
  "all — not whether any particular case is recordable. When establishment_naics_code is supplied, the " +
  "1904.2 industry classification is resolved against the closed Appendix A to Subpart B list bundled with " +
  "this tool; otherwise it is taken as supplied via establishment_in_partially_exempt_industry.";

/**
 * Input shape for `osha_check_recordkeeping_obligation`. Per-field documentation is carried
 * by the Zod `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const checkRecordkeepingObligationInputShape = {
  company_peak_employees_last_calendar_year: z
    .number()
    .int()
    .min(0)
    .describe(
      "The PEAK number of employees across the ENTIRE COMPANY at any time during the last calendar year " +
      "(1904.1(b)(1)-(b)(2)). Not an average, not a year-end headcount, and not a single establishment's " +
      "count — if the company touched 11 employees for one week, it is over the threshold."
    ),
  establishment_naics_code: z
    .string()
    .optional()
    .describe(
      "The establishment's NAICS code, 4 to 6 digits. Supply this and the tool looks it up against the " +
      "closed Appendix A list itself — the match is on the first FOUR digits, since Appendix A lists " +
      "industry groups. If you do not know the code, omit it and use " +
      "establishment_in_partially_exempt_industry instead."
    ),
  establishment_in_partially_exempt_industry: z
    .boolean()
    .default(false)
    .describe(
      "Fallback for when the NAICS code is unknown: is this ESTABLISHMENT classified in a partially exempt " +
      "industry under 1904.2? Ignored when establishment_naics_code is supplied, because the tool then " +
      "determines it. Note this exemption attaches to the establishment, whereas the size exemption " +
      "applies to the whole company."
    ),
  notified_in_writing_to_keep_records: z
    .boolean()
    .default(false)
    .describe(
      "Has OSHA or the Bureau of Labor Statistics informed the employer IN WRITING that it must keep records " +
      "under 1904.41 or 1904.42? Appendix A extends this to a STATE AGENCY operating under the authority of " +
      "OSHA or the BLS. Such a request defeats BOTH exemptions — 1904.1(a)(1) for size, 1904.2(a)(1) for " +
      "industry."
    ),
};

const InputSchema = z.object(checkRecordkeepingObligationInputShape);
export type CheckRecordkeepingObligationInput = z.infer<typeof InputSchema>;

/**
 * Evaluates whether an employer is required to keep OSHA recordkeeping logs (Forms 300, 300-A, 301)
 * under 29 CFR § 1904.1 and § 1904.2.
 *
 * It checks scope using two primary gates:
 * 1. **Size Exemption (1904.1):** Employers with 10 or fewer employees at all times during the last
 *    calendar year across their entire company (not just one establishment) are partially exempt.
 * 2. **Industry Exemption (1904.2):** Establishments in specific low-hazard industries listed in
 *    Appendix A to Subpart B are partially exempt.
 *
 * Both exemptions are defeated if the employer receives a written notification from OSHA or the BLS to
 * keep records (1904.41 / 1904.42). Crucially, **1904.39 severe-injury reporting remains mandatory**
 * for all employers, even if they are exempt from keeping logs.
 *
 * @param input The parameters containing peak employee count, NAICS code, and notification overrides.
 * @returns A cited RuleRecord containing the scope determination.
 */
export function checkRecordkeepingObligation(
  input: CheckRecordkeepingObligationInput
): RuleRecord<RecordkeepingObligation> {
  const overSize = input.company_peak_employees_last_calendar_year > THRESHOLD;

  // Appendix A lists NAICS INDUSTRY GROUPS (4 digits). An establishment's own code
  // is usually 6, so the match is on its first four.
  const group = input.establishment_naics_code?.replace(/\D/g, "").slice(0, 4);
  const matchedTitle = group ? appendixA.industries[group] : undefined;
  const matchedIndustry = group && matchedTitle ? { naics_group: group, title: matchedTitle } : null;
  // A supplied code is authoritative — it decides, and the boolean is ignored.
  const industryExempt = input.establishment_naics_code
    ? matchedIndustry !== null
    : input.establishment_in_partially_exempt_industry;

  const build = (
    required: boolean,
    exemption: RecordkeepingObligation["exemption"],
    basis: string,
    cites: string[]
  ) =>
    ruleRecord(
      data.provenance,
      {
        recordkeeping_required: required,
        basis,
        exemption,
        // Never conditional. The whole point of "partial" is that this survives.
        severe_injury_reporting_still_required: true,
        severe_injury_reporting_note: data.survives_exemption.rule,
        // Only useful when the industry classification could change the answer.
        matched_industry: matchedIndustry,
        // Only useful when the classification is still open: over the size threshold
        // and no NAICS code supplied for the tool to resolve.
        naics_determination_methods:
          overSize && !input.establishment_naics_code
            ? data.industry_exemption.naics_determination.methods
            : [],
        cfr_cites: [...cites, data.survives_exemption.cfr_cite],
        disclaimer: DISCLAIMER,
      },
      cites[0] ?? data.provenance.cfr_cite
    );

  // A written request under 1904.41/1904.42 defeats the size exemption, so it is
  // checked before the headcount rather than after.
  if (input.notified_in_writing_to_keep_records) {
    return build(
      true,
      "none",
      `Recordkeeping IS required. ${data.written_notification_override.rule}`,
      [data.written_notification_override.cfr_cite, ...data.written_notification_override.also_cited]
    );
  }

  const withinSize = input.company_peak_employees_last_calendar_year <= THRESHOLD;

  if (withinSize) {
    return build(
      false,
      "size_1904_1",
      `Recordkeeping is NOT required: peak employment across the entire company was ` +
      `${input.company_peak_employees_last_calendar_year}, which is ${THRESHOLD} or fewer at all times ` +
      `during the last calendar year (${data.size_exemption.cfr_cite}). ${data.size_exemption.scope.rule}`,
      [data.size_exemption.cfr_cite, data.size_exemption.scope.cfr_cite]
    );
  }

  if (industryExempt) {
    const named = matchedIndustry
      ? ` NAICS ${matchedIndustry.naics_group} — ${matchedIndustry.title} — is listed in Appendix A to Subpart B.`
      : "";
    return build(
      false,
      "industry_1904_2",
      `Recordkeeping is NOT required for this establishment: the company exceeds the ${THRESHOLD}-employee ` +
      `size threshold, but the establishment is classified in a partially exempt industry ` +
      `(${data.industry_exemption.cfr_cite}).${named} ${data.industry_exemption.scope.rule}`,
      [
        data.industry_exemption.cfr_cite,
        data.industry_exemption.scope.cfr_cite,
        data.over_ten_employees.cfr_cite,
      ]
    );
  }

  return build(
    true,
    "none",
    `Recordkeeping IS required. ${data.over_ten_employees.rule} Peak company employment was ` +
    `${input.company_peak_employees_last_calendar_year}, above the ${THRESHOLD}-employee threshold, and ` +
    `${input.establishment_naics_code
      ? `NAICS ${group} is not listed in Appendix A to Subpart B, so no 1904.2 industry exemption applies.`
      : "no 1904.2 industry exemption was claimed for this establishment."
    } ` +
    `${data.industry_exemption.non_exempt_establishments.rule}`,
    [data.over_ten_employees.cfr_cite, data.industry_exemption.non_exempt_establishments.cfr_cite]
  );
}