/**
 * Test suite for the `checkRecordkeepingObligation` tool (29 CFR § 1904.1 / § 1904.2).
 * Validates the size-based exemption (10 or fewer employees) and NAICS-based industry exemption
 * rules, as well as written notification overrides.
 */
import { readFileSync } from "node:fs";
import { checkRecordkeepingObligation } from "../src/tools/checkRecordkeepingObligation.js";

type Input = Parameters<typeof checkRecordkeepingObligation>[0];

/**
 * zod `.default()` fields are optional at the call site but REQUIRED in the
 * inferred type, so every new defaulted input would otherwise churn every fixture
 * here. Build inputs through this instead.
 */
const input = (over: Partial<Input> = {}): Input => ({
  company_peak_employees_last_calendar_year: 50,
  establishment_in_partially_exempt_industry: false,
  notified_in_writing_to_keep_records: false,
  ...over,
});

describe("check_recordkeeping_obligation — the size exemption (1904.1(a)(1))", () => {
  test("10 or fewer at all times is exempt", () => {
    const r = checkRecordkeepingObligation(input({ company_peak_employees_last_calendar_year: 10 }));
    expect(r.value.recordkeeping_required).toBe(false);
    expect(r.value.exemption).toBe("size_1904_1");
  });

  test("eleven at peak is not exempt — the threshold is inclusive at 10", () => {
    const r = checkRecordkeepingObligation(input({ company_peak_employees_last_calendar_year: 11 }));
    expect(r.value.recordkeeping_required).toBe(true);
    expect(r.value.exemption).toBe("none");
  });

  test("the basis states the exemption is company-wide, not per establishment", () => {
    // 1904.1(b)(1). A 200-person company with a 4-person site is NOT exempt.
    const r = checkRecordkeepingObligation(input({ company_peak_employees_last_calendar_year: 4 }));
    expect(r.value.basis).toMatch(/ENTIRE COMPANY/i);
    expect(r.value.cfr_cites).toContain("1904.1(b)(1)");
  });

  test("a written OSHA or BLS request defeats the size exemption", () => {
    const r = checkRecordkeepingObligation(
      input({
        company_peak_employees_last_calendar_year: 3,
        notified_in_writing_to_keep_records: true,
      })
    );
    expect(r.value.recordkeeping_required).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.1(a)(1)");
    expect(r.value.basis).toMatch(/1904\.41 or 1904\.42/);
  });
});

describe("check_recordkeeping_obligation — the industry exemption (1904.2)", () => {
  test("a partially exempt industry exempts an over-threshold company's establishment", () => {
    const r = checkRecordkeepingObligation(
      input({
        company_peak_employees_last_calendar_year: 500,
        establishment_in_partially_exempt_industry: true,
      })
    );
    expect(r.value.recordkeeping_required).toBe(false);
    expect(r.value.exemption).toBe("industry_1904_2");
  });

  test("the industry exemption is flagged as establishment-level, not company-wide", () => {
    const r = checkRecordkeepingObligation(
      input({
        company_peak_employees_last_calendar_year: 500,
        establishment_in_partially_exempt_industry: true,
      })
    );
    // 1904.2(b)(1) in its own words: the exemption is per establishment, so one
    // company can have some sites keeping records and others exempt.
    expect(r.value.basis).toMatch(/INDIVIDUAL BUSINESS ESTABLISHMENTS/i);
    expect(r.value.basis).toMatch(/some may be required to keep records while others are partially exempt/i);
    expect(r.value.cfr_cites).toContain("1904.2(b)(1)");
  });

  test("no industry exemption claimed and over threshold means records required", () => {
    const r = checkRecordkeepingObligation(input({ company_peak_employees_last_calendar_year: 500 }));
    expect(r.value.recordkeeping_required).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.1(a)(2)");
  });
});

// The reason this tool exists. An exempt employer who generalises "no logs" into
// "no OSHA obligations" misses the 8-hour fatality call.
describe("check_recordkeeping_obligation — what survives exemption", () => {
  test.each([
    ["exempt by size", { company_peak_employees_last_calendar_year: 5 }],
    ["exempt by industry", { company_peak_employees_last_calendar_year: 500, establishment_in_partially_exempt_industry: true }],
    ["not exempt", { company_peak_employees_last_calendar_year: 500 }],
    ["notified in writing", { company_peak_employees_last_calendar_year: 2, notified_in_writing_to_keep_records: true }],
  ])("1904.39 reporting still applies when %s", (_label, over) => {
    const r = checkRecordkeepingObligation(input(over as Partial<Input>));
    expect(r.value.severe_injury_reporting_still_required).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.39");
  });

  test("the note names the four reportable outcomes explicitly", () => {
    const r = checkRecordkeepingObligation(input({ company_peak_employees_last_calendar_year: 5 }));
    const n = r.value.severe_injury_reporting_note;
    expect(n).toMatch(/fatality/i);
    expect(n).toMatch(/in-patient hospitalization/i);
    expect(n).toMatch(/amputation/i);
    expect(n).toMatch(/loss of an eye/i);
  });

  test("carries provenance", () => {
    const r = checkRecordkeepingObligation(input());
    expect(r.source_url).toMatch(/subpart-B/);
    expect(r.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// 1904.2(a)(2): size trumps industry. A size-exempt company needs no records even
// where its establishments sit in non-exempt industries.
describe("check_recordkeeping_obligation — how the two exemptions interact", () => {
  test("size exemption wins over a non-exempt industry classification", () => {
    const r = checkRecordkeepingObligation(
      input({
        company_peak_employees_last_calendar_year: 8,
        establishment_in_partially_exempt_industry: false,
      })
    );
    expect(r.value.recordkeeping_required).toBe(false);
    expect(r.value.exemption).toBe("size_1904_1");
  });

  test("a written request defeats BOTH exemptions, citing each", () => {
    const r = checkRecordkeepingObligation(
      input({
        company_peak_employees_last_calendar_year: 3,
        establishment_in_partially_exempt_industry: true,
        notified_in_writing_to_keep_records: true,
      })
    );
    expect(r.value.recordkeeping_required).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.1(a)(1)");
    expect(r.value.cfr_cites).toContain("1904.2(a)(1)");
  });

  test("a required answer cites 1904.2(a)(2), which governs non-exempt establishments", () => {
    const r = checkRecordkeepingObligation(input({ company_peak_employees_last_calendar_year: 500 }));
    expect(r.value.cfr_cites).toContain("1904.2(a)(2)");
    expect(r.value.basis).toMatch(/Size therefore trumps industry/i);
  });
});

// 1904.2(b)(2) gives three ways to find the NAICS code. Returned only when the
// company is over the size threshold, because that is when the answer decides it.
describe("check_recordkeeping_obligation — NAICS determination guidance", () => {
  test("offers the three methods plus the OSHA/State contact when over threshold", () => {
    const r = checkRecordkeepingObligation(input({ company_peak_employees_last_calendar_year: 40 }));
    expect(r.value.naics_determination_methods).toHaveLength(4);
    const all = r.value.naics_determination_methods.join(" ");
    expect(all).toMatch(/census\.gov/);
    expect(all).toMatch(/SIC/);
    expect(all).toMatch(/State agency/i);
  });

  test("stays silent when the company is size-exempt — the classification cannot matter", () => {
    const r = checkRecordkeepingObligation(input({ company_peak_employees_last_calendar_year: 5 }));
    expect(r.value.naics_determination_methods).toHaveLength(0);
  });
});

// Appendix A to Subpart B is a closed list of 82 NAICS industry groups. With a code
// supplied the tool determines the 1904.2 answer instead of taking it on faith.
describe("check_recordkeeping_obligation — Appendix A lookup", () => {
  const big = { company_peak_employees_last_calendar_year: 400 };

  test("a six-digit code matches on its first four digits", () => {
    // 621111 Offices of Physicians, Mental Health Specialists → group 6211.
    const r = checkRecordkeepingObligation(input({ ...big, establishment_naics_code: "621111" }));
    expect(r.value.recordkeeping_required).toBe(false);
    expect(r.value.matched_industry).toEqual({
      naics_group: "6211",
      title: "Offices of Physicians",
    });
  });

  test("a four-digit code matches directly", () => {
    const r = checkRecordkeepingObligation(input({ ...big, establishment_naics_code: "5411" }));
    expect(r.value.matched_industry?.title).toBe("Legal Services");
    expect(r.value.exemption).toBe("industry_1904_2");
  });

  test("a code outside the list is not exempt, and the basis says so", () => {
    // 2361 Residential Building Construction — conspicuously not in Appendix A.
    const r = checkRecordkeepingObligation(input({ ...big, establishment_naics_code: "236118" }));
    expect(r.value.recordkeeping_required).toBe(true);
    expect(r.value.matched_industry).toBeNull();
    expect(r.value.basis).toMatch(/2361 is not listed in Appendix A/);
  });

  test("a supplied code overrides the boolean fallback", () => {
    // The caller claims exemption; the code says otherwise. The code wins.
    const r = checkRecordkeepingObligation(
      input({
        ...big,
        establishment_naics_code: "236118",
        establishment_in_partially_exempt_industry: true,
      })
    );
    expect(r.value.recordkeeping_required).toBe(true);
  });

  test("the boolean still works when no code is supplied", () => {
    const r = checkRecordkeepingObligation(
      input({ ...big, establishment_in_partially_exempt_industry: true })
    );
    expect(r.value.recordkeeping_required).toBe(false);
    expect(r.value.matched_industry).toBeNull();
  });

  test("NAICS guidance is withheld once a code has been supplied", () => {
    const withCode = checkRecordkeepingObligation(input({ ...big, establishment_naics_code: "5411" }));
    const without = checkRecordkeepingObligation(input(big));
    expect(withCode.value.naics_determination_methods).toHaveLength(0);
    expect(without.value.naics_determination_methods).toHaveLength(4);
  });

  test("size exemption still wins over an Appendix A miss", () => {
    const r = checkRecordkeepingObligation(
      input({ company_peak_employees_last_calendar_year: 5, establishment_naics_code: "236118" })
    );
    expect(r.value.recordkeeping_required).toBe(false);
    expect(r.value.exemption).toBe("size_1904_1");
  });

  test("the list holds all 82 industry groups, none duplicated", () => {
    const industries = (
      JSON.parse(
        readFileSync("src/data/partially_exempt_industries.json", "utf8")
      ) as { industries: Record<string, string> }
    ).industries;
    const keys = Object.keys(industries);
    expect(keys).toHaveLength(82);
    expect(new Set(keys).size).toBe(82);
    expect(keys.every((k) => /^\d{4}$/.test(k))).toBe(true);
  });
});
