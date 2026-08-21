/**
 * Provenance schema for regulatory rules.
 */

/**
 * The provenance block every dataset carries. Kept as one named type so the
 * decay checker, the datasets, and the tools all agree on its shape.
 */
export interface Provenance {
  cfr_cite: string;
  source_url: string;
  last_verified: string;
  decay_threshold_days?: number;
  note?: string;
  /** Federal Register publication and amendment history, verbatim from eCFR. */
  amendment_history?: string[];
  /**
   * Any eCFR Editorial Note bearing on this section. These record things the
   * section text itself does not — most importantly amendments that were later
   * withdrawn, which make an old copy of the regulation actively misleading.
   */
  editorial_note?: string;
}

/**
 * Constructs a RuleRecord from a dataset's provenance.
 *
 * Centralizes rule record instantiation to ensure that CFR citations, source URLs,
 * and last-verification dates are applied consistently across all tool determinations.
 *
 * @param provenance The top-level provenance block from the loaded dataset.
 * @param value The typed evaluation result payload.
 * @param cite Optional specific CFR sub-clause citation that decided the case.
 * @param kind The type of rule record (defaults to "determination").
 * @returns A cited, timestamped RuleRecord containing the payload.
 */
export function ruleRecord<T>(
  provenance: Provenance,
  value: T,
  cite?: string,
  kind: RuleRecord<T>["kind"] = "determination"
): RuleRecord<T> {
  return {
    value,
    kind,
    cfr_cite: cite ?? provenance.cfr_cite,
    source_url: provenance.source_url,
    last_verified: provenance.last_verified,
  };
}

/** A regulatory rule: what OSHA requires, and how we know. */
export interface RuleRecord<T> {
  value: T;
  kind: "determination" | "frequency";
  /** e.g. "1904.7(b)(5)(ii)(D)" */
  cfr_cite: string;
  /** Direct link to eCFR / OSHA source. */
  source_url: string;
  /** YYYY-MM-DD. Monitored by the CI decay test. */
  last_verified: string;
}

/** Shape of the closed first-aid list data asset. */
export interface FirstAidTreatment {
  /** Canonical treatment code used in the tool's controlled vocabulary. */
  code: string;
  /** Sub-clause this treatment is enumerated under. */
  cfr_cite: string;
  /** Plain-language description from the regulation. */
  description: string;
  /** Free-text aliases the calling model may map from (documentation only). */
  aliases: string[];
}

export interface FirstAidDataset {
  provenance: {
    cfr_cite: string;
    source_url: string;
    last_verified: string;
    /** Days after which the CI decay test fails the build for this dataset. */
    decay_threshold_days: number;
    note: string;
  };
  treatments: FirstAidTreatment[];
}

/** The determination payload returned inside a RuleRecord. */
export interface RecordabilityDetermination {
  recordable: boolean;
  basis: string;
  triggering_factors: Array<{ factor: string; cfr_cite: string }>;
  severe_injury_reporting_note: string | null;
  /**
   * Consequences a specific-case criterion imposes on the log entry itself — e.g.
   * 1904.8(a) records a needlestick as an injury AND forbids the employee's name.
   */
  log_entry_notes: string[];
  /**
   * True when no outcome, diagnosis, or treatment was asserted. The answer is
   * then resting on an assumption the caller may not have meant to make.
   */
  under_specified: boolean;
}
