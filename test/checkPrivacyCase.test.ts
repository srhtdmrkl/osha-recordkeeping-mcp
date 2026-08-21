/**
 * Test suite for the `checkPrivacyCase` tool (29 CFR § 1904.29(b)(6)-(10)).
 * Validates privacy concern case categorization, including automatic categories,
 * voluntary illness exemptions, required log redactions, and disclosure exceptions.
 */
import { checkPrivacyCase } from "../src/tools/checkPrivacyCase.js";

const base = { is_illness: false, employee_requested_name_omitted: false };

describe("check_privacy_case — 1904.29(b)(6)-(9)", () => {
  test.each([
    ["intimate_body_part_or_reproductive_system", "1904.29(b)(7)(i)"],
    ["sexual_assault", "1904.29(b)(7)(ii)"],
    ["mental_illness", "1904.29(b)(7)(iii)"],
    ["hiv_hepatitis_or_tuberculosis", "1904.29(b)(7)(iv)"],
    ["contaminated_needlestick_or_sharps", "1904.29(b)(7)(v)"],
  ])("%s is automatically a privacy case, cited to %s", (nature, cite) => {
    const r = checkPrivacyCase({ ...base, nature });
    expect(r.value.privacy_case).toBe(true);
    expect(r.value.matched_category).toBe(nature);
    expect(r.cfr_cite).toBe(cite);
    expect(r.value.log_name_entry).toBe("privacy case");
  });

  test("enumerated categories do not require the employee to ask", () => {
    const r = checkPrivacyCase({
      nature: "mental_illness",
      is_illness: true,
      employee_requested_name_omitted: false,
    });
    expect(r.value.privacy_case).toBe(true);
  });

  test("an unlisted case is not a privacy case and cites the closed-list rule", () => {
    const r = checkPrivacyCase({ ...base, nature: "none_of_these" });
    expect(r.value.privacy_case).toBe(false);
    expect(r.value.matched_category).toBeNull();
    expect(r.cfr_cite).toBe("1904.29(b)(8)");
    expect(r.value.log_name_entry).toBe("the employee's name");
    expect(r.value.required_actions).toHaveLength(0);
  });

  test("a laceration is not a privacy case even if the employee asks", () => {
    // (b)(8) closes the list — an employer may not extend it out of sympathy.
    const r = checkPrivacyCase({
      nature: "none_of_these",
      is_illness: false,
      employee_requested_name_omitted: true,
    });
    expect(r.value.privacy_case).toBe(false);
  });

  test("other illness + voluntary request qualifies under (b)(7)(vi)", () => {
    const r = checkPrivacyCase({
      nature: "other_illness_employee_requested",
      is_illness: true,
      employee_requested_name_omitted: true,
    });
    expect(r.value.privacy_case).toBe(true);
    expect(r.cfr_cite).toBe("1904.29(b)(7)(vi)");
  });

  test("(b)(7)(vi) does not cover injuries, even with a request", () => {
    const r = checkPrivacyCase({
      nature: "other_illness_employee_requested",
      is_illness: false,
      employee_requested_name_omitted: true,
    });
    expect(r.value.privacy_case).toBe(false);
    expect(r.value.basis).toMatch(/ILLNESSES only/);
  });

  test("(b)(7)(vi) does not apply to an illness with no request", () => {
    const r = checkPrivacyCase({
      nature: "other_illness_employee_requested",
      is_illness: true,
      employee_requested_name_omitted: false,
    });
    expect(r.value.privacy_case).toBe(false);
    expect(r.value.basis).toMatch(/voluntarily request/);
  });

  test("a privacy case carries the confidential-list and redaction duties", () => {
    const r = checkPrivacyCase({ ...base, nature: "sexual_assault" });
    const cites = r.value.required_actions.map((a) => a.cfr_cite);
    expect(cites).toContain("1904.29(b)(6)"); // "privacy case" + separate list
    expect(cites).toContain("1904.29(b)(9)"); // discretion in the description
    expect(cites).toContain("1904.29(b)(10)"); // redaction on disclosure
  });

  test("carries provenance", () => {
    const r = checkPrivacyCase({ ...base, nature: "mental_illness" });
    expect(r.kind).toBe("determination");
    expect(r.source_url).toMatch(/ecfr\.gov/);
    expect(r.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// 1904.29(b)(10): the only three recipients who may see identifying information.
describe("check_privacy_case — disclosure exceptions (1904.29(b)(10))", () => {
  test("enumerates exactly three recipients", () => {
    const r = checkPrivacyCase({ ...base, nature: "sexual_assault" });
    expect(r.value.disclosure_exceptions).toHaveLength(3);
    const cites = r.value.disclosure_exceptions.map((e) => e.cfr_cite);
    expect(cites).toEqual([
      "1904.29(b)(10)(i)",
      "1904.29(b)(10)(ii)",
      "1904.29(b)(10)(iii)",
    ]);
  });

  test("names the workers' compensation and public-health routes specifically", () => {
    const r = checkPrivacyCase({ ...base, nature: "mental_illness" });
    const text = r.value.disclosure_exceptions.map((e) => e.recipient).join(" ");
    expect(text).toMatch(/workers' compensation/i);
    expect(text).toMatch(/45 CFR 164\.512/);
  });

  test("(b)(9) offers concrete redacted descriptions", () => {
    const r = checkPrivacyCase({ ...base, nature: "sexual_assault" });
    const discretion = r.value.required_actions.find((a) => a.cfr_cite === "1904.29(b)(9)");
    expect(discretion?.action).toMatch(/injury from assault/i);
  });
});
