import { z } from "zod";
import { loadDataset, type WithProvenance } from "../datasets.js";
import { ruleRecord, type RuleRecord } from "../types.js";

/** Represents a regulatory citation with an optional rule or description. */
interface Cited {
  cfr_cite: string;
  rule?: string;
  description?: string;
}
/** Dataset structure containing rules and definitions for establishment routing under 1904.30. */
interface EstablishmentData extends WithProvenance {
  separate_log_rule: { cfr_cite: string; threshold_months: number; rule: string };
  short_term_establishments: { cfr_cite: string; rule: string };
  employee_establishment_link: { cfr_cite: string; rule: string };
  routing: {
    cfr_cite: string;
    rules: Record<string, { cfr_cite: string; destination: string; rule: string }>;
  };
  central_recordkeeping: {
    cfr_cite: string;
    transmit_within_days: number;
    rule: string;
    conditions: Record<string, Cited>;
  };
  establishment_definition: {
    cfr_cite: string;
    definition: string;
    mobile_operations: { cfr_cite: string; rule: string };
    telecommuting: { cfr_cite: string; rule: string };
  };
}

const data = loadDataset<EstablishmentData>("establishments");
const DAY_MS = 86_400_000;

/**
 * The result of an establishment routing determination under 29 CFR § 1904.30: which
 * establishment's 300 Log the case belongs on, and whether that site needs its own log.
 */
export interface EstablishmentRouting {
  /** Which establishment's 300 Log the case belongs on. */
  log_destination: "establishment_where_injury_occurred" | "establishment_where_employee_normally_works";
  basis: string;
  /** False when the site may be folded into a combined short-term log. */
  destination_needs_own_log: boolean;
  own_log_basis: string;
  /** Set when records are kept centrally: the 1904.30(b)(2)(i) transmission deadline. */
  transmit_by_iso: string | null;
  central_recordkeeping_conditions: Array<{ condition: string; cfr_cite: string }>;
  cfr_cites: string[];
  disclaimer: string;
}

const DISCLAIMER =
  "Routing only — which establishment's 300 Log the case belongs on. It does not decide whether the case is " +
  "recordable, and it assumes the establishment facts supplied are correct.";

/**
 * Input shape for `osha_route_to_establishment_log`. Per-field documentation is carried by
 * the Zod `.describe()` strings below, which is what MCP clients surface to the model.
 */
export const routeToEstablishmentLogInputShape = {
  occurred_at_one_of_your_establishments: z
    .boolean()
    .describe(
      "Did the injury or illness occur AT one of the employer's own establishments? True even if it is not " +
        "the employee's usual site. False for a customer site, in transit, or working from home. An " +
        "establishment is a single physical location where business is conducted (1904.46); for mobile work " +
        "— construction, transportation, utilities — it is the office, terminal or station that supervises " +
        "the activity or is the base for it."
    ),
  employee_was_telecommuting_from_home: z
    .boolean()
    .default(false)
    .describe(
      "Was the employee working from home at the time? A home is NEVER a business establishment and needs " +
        "no separate 300 Log (1904.46(3)) — the case goes on the log of the establishment the telecommuter " +
        "is linked to under 1904.30(b)(3). Pass false for occurred_at_one_of_your_establishments in this case."
    ),
  destination_expected_to_operate_a_year_or_longer: z
    .boolean()
    .default(true)
    .describe(
      "Is the establishment whose log will carry the case expected to be in operation for a year or longer? " +
        "If not, no separate log is required — its cases may go on a combined short-term log, optionally per " +
        "division or geographic region (1904.30(a), (b)(1))."
    ),
  records_kept_centrally: z
    .boolean()
    .default(false)
    .describe(
      "Are the establishment's records kept at headquarters or another central location? Permitted only on " +
        "the two conditions in 1904.30(b)(2)."
    ),
  date_information_received: z
    .string()
    .optional()
    .describe(
      "ISO 8601 date the employer received information that a recordable case occurred. Used with central " +
        "recordkeeping to compute the 7-calendar-day transmission deadline (1904.30(b)(2)(i))."
    ),
};

const InputSchema = z.object(routeToEstablishmentLogInputShape);
export type RouteToEstablishmentLogInput = z.infer<typeof InputSchema>;

/**
 * Determines which establishment's log a recordable case belongs on under 29 CFR § 1904.30.
 *
 * This function routes cases according to the place of injury rather than employee residence/assignment:
 * 1. **Place-of-Injury Rule (1904.30(b)(4)):** If an injury occurs at one of the employer's establishments,
 *    it goes on *that* establishment's log (even if it's not the employee's usual site).
 * 2. **Off-site/Transit/Telecommuter Rule (1904.30(b)(3)):** If the injury occurs away from any establishment
 *    (or while telecommuting from home), it goes on the log of the establishment where the employee normally works.
 * 3. **Short-Term Operations (1904.30(b)(1)):** Temporary sites operating for less than a year do not need
 *    separate logs and can share a combined log.
 * 4. **Central Recordkeeping (1904.30(b)(2)):** Calculates the 7-day transmission deadline if logs are kept centrally.
 *
 * @param input The parameters containing event location, telecommuting status, site operation span, and recordkeeping mode.
 * @returns A cited RuleRecord containing the establishment routing determination.
 */
export function routeToEstablishmentLog(
  input: RouteToEstablishmentLogInput
): RuleRecord<EstablishmentRouting> {
  // (b)(4): the case follows the PLACE, not the person. This is the whole rule,
  // and the direction people get backwards.
  // 1904.46(3): a home is never an establishment, so telecommuting always routes to
  // the establishment the employee is linked to — never to "the site of the injury".
  const telecommuting = input.employee_was_telecommuting_from_home;
  const rule =
    input.occurred_at_one_of_your_establishments && !telecommuting
      ? data.routing.rules.occurred_at_an_establishment
      : data.routing.rules.occurred_away_from_all_establishments;

  const needsOwnLog = input.destination_expected_to_operate_a_year_or_longer;
  const ownLogBasis = needsOwnLog
    ? data.separate_log_rule.rule
    : data.short_term_establishments.rule;

  let transmitBy: string | null = null;
  if (input.records_kept_centrally && input.date_information_received) {
    const d = new Date(input.date_information_received);
    if (!Number.isNaN(d.getTime())) {
      transmitBy = new Date(
        d.getTime() + data.central_recordkeeping.transmit_within_days * DAY_MS
      ).toISOString();
    }
  }

  const cites = [
    rule.cfr_cite,
    ...(telecommuting ? [data.establishment_definition.telecommuting.cfr_cite] : []),
    needsOwnLog ? data.separate_log_rule.cfr_cite : data.short_term_establishments.cfr_cite,
    ...(input.records_kept_centrally ? [data.central_recordkeeping.cfr_cite] : []),
  ];

  return ruleRecord(
    data.provenance,
    {
      log_destination: rule.destination as EstablishmentRouting["log_destination"],
      basis: telecommuting
        ? `${data.establishment_definition.telecommuting.rule} ${rule.rule}`
        : rule.rule,
      destination_needs_own_log: needsOwnLog,
      own_log_basis: ownLogBasis,
      transmit_by_iso: transmitBy,
      central_recordkeeping_conditions: input.records_kept_centrally
        ? Object.values(data.central_recordkeeping.conditions).map((c) => ({
            condition: c.description ?? c.rule ?? "",
            cfr_cite: c.cfr_cite,
          }))
        : [],
      cfr_cites: cites,
      disclaimer: DISCLAIMER,
    },
    rule.cfr_cite
  );
}
