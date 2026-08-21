/**
 * Single point of contact with the JSON data assets.
 *
 * Static imports with import attributes, not `createRequire`: the same module then
 * resolves under Node and under a Workers-style runtime with no filesystem, so the
 * tools run unchanged on all three entry points — stdio, node HTTP, and the
 * Cloudflare worker. A bundler can also see every dataset and inline it.
 *
 * Centralising loading here gives the tools and the Resource registrations one
 * shared table, so a dataset cannot be exposed as a Resource under an id no tool
 * actually loads.
 */
import type { Provenance } from "./types.js";

import firstAidTreatments from "./data/first_aid_treatments.json" with { type: "json" };
import workRelatedness from "./data/work_relatedness.json" with { type: "json" };
import newCase from "./data/new_case.json" with { type: "json" };
import generalCriteria from "./data/general_criteria.json" with { type: "json" };
import specificCaseCriteria from "./data/specific_case_criteria.json" with { type: "json" };
import hearingLoss from "./data/hearing_loss.json" with { type: "json" };
import severeInjuryReporting from "./data/severe_injury_reporting.json" with { type: "json" };
import log300Classification from "./data/log300_classification.json" with { type: "json" };
import recordkeepingObligation from "./data/recordkeeping_obligation.json" with { type: "json" };
import partiallyExemptIndustries from "./data/partially_exempt_industries.json" with { type: "json" };
import definitions from "./data/definitions.json" with { type: "json" };
import coveredEmployees from "./data/covered_employees.json" with { type: "json" };
import establishments from "./data/establishments.json" with { type: "json" };
import recordingForms from "./data/recording_forms.json" with { type: "json" };
import privacyCases from "./data/privacy_cases.json" with { type: "json" };

/** Every dataset, keyed by the id used for both loading and the Resource URI. */
export const DATASETS = {
  "first-aid-treatments": {
    data: firstAidTreatments,
    title: "Closed first-aid list (1904.7(b)(5)(ii))",
  },
  "work-relatedness": {
    data: workRelatedness,
    title: "Work-relatedness presumption and exceptions (1904.5)",
  },
  "new-case": {
    data: newCase,
    title: "New case vs. continuation (1904.6)",
  },
  "general-criteria": {
    data: generalCriteria,
    title: "General recording criteria implementation (1904.7(b))",
  },
  "specific-case-criteria": {
    data: specificCaseCriteria,
    title: "Specific-case recording criteria (1904.8-1904.12)",
  },
  "hearing-loss": {
    data: hearingLoss,
    title: "Occupational hearing loss criteria (1904.10)",
  },
  "severe-injury-reporting": {
    data: severeInjuryReporting,
    title: "Severe-injury reporting rules (1904.39)",
  },
  "log300-classification": {
    data: log300Classification,
    title: "OSHA 300 Log classification (1904.29)",
  },
  "recordkeeping-obligation": {
    data: recordkeepingObligation,
    title: "Scope — partial exemptions (1904.1)",
  },
  "partially-exempt-industries": {
    data: partiallyExemptIndustries,
    title: "Partially exempt industries (Appendix A to Subpart B)",
  },
  "definitions": {
    data: definitions,
    title: "Part 1904 definitions (1904.46)",
  },
  "covered-employees": {
    data: coveredEmployees,
    title: "Covered employees and recording responsibility (1904.31)",
  },
  "establishments": {
    data: establishments,
    title: "Multiple business establishments (1904.30)",
  },
  "recording-forms": {
    data: recordingForms,
    title: "Recording forms and the 7-day deadline (1904.29(a)-(b)(5))",
  },
  "privacy-cases": {
    data: privacyCases,
    title: "Privacy concern cases (1904.29(b)(6)-(9))",
  },
} as const;

export type DatasetId = keyof typeof DATASETS;

/** Anything loadable here carries provenance — that is the point of the asset. */
export interface WithProvenance {
  provenance: Provenance;
}

/**
 * Central loading utility for datasets containing regulatory data and provenance.
 * Centralizing load logic here ensures that all datasets carry a verified provenance block.
 *
 * @param id The dataset identifier.
 * @returns The typed dataset structure containing provenance.
 */
export function loadDataset<T extends WithProvenance>(id: DatasetId): T {
  return DATASETS[id].data as unknown as T;
}

/**
 * Resolves a dataset ID to its custom MCP resource URI.
 *
 * @param id The dataset identifier.
 * @returns The corresponding `osha://data/<id>` URI.
 */
export function datasetUri(id: DatasetId): string {
  return `osha://data/${id}`;
}
