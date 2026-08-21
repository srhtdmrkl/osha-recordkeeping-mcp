import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuleTool } from "../../server.js";
import {
  checkPrivacyCase,
  checkPrivacyCaseInputShape,
  type CheckPrivacyCaseInput,
  type PrivacyCaseDetermination,
} from "../../tools/checkPrivacyCase.js";

/**
 * Registers the `osha_check_privacy_case` tool with the MCP server.
 *
 * This tool determines if a recordable case qualifies as a privacy concern case,
 * requiring the omission of the employee's name from the log under 29 CFR § 1904.29(b)(6)-(9).
 * It answers whether the employee's name may go on the log at all.
 *
 * @param server The MCP server instance.
 */
export function registerPrivacyCase(server: McpServer): void {
  registerRuleTool<CheckPrivacyCaseInput, PrivacyCaseDetermination>(server, {
    name: "osha_check_privacy_case",
    title: "Check Privacy Concern Case (29 CFR 1904.29(b)(6)-(9))",
    description:
      "Determine whether a recordable case is a privacy concern case, meaning the employee's name must NOT " +
      "be entered on the OSHA 300 Log. 1904.29(b)(7) is a closed list — injury to an intimate body part or the " +
      "reproductive system, sexual assault, mental illness, HIV/hepatitis/tuberculosis, a contaminated " +
      "needlestick or sharps cut, and other illnesses where the employee voluntarily asks to be left off. " +
      "1904.29(b)(8) forbids treating anything else as a privacy case. Returns the required log entry and the " +
      "confidential-list and redaction obligations that follow, plus the only three recipients who may receive " +
      "the forms with identifying information intact (1904.29(b)(10)). Run this after a case is determined recordable.",
    inputShape: checkPrivacyCaseInputShape,
    outputValue: z.object({
      privacy_case: z.boolean(),
      basis: z.string(),
      matched_category: z.string().nullable(),
      log_name_entry: z.string(),
      required_actions: z.array(z.object({ action: z.string(), cfr_cite: z.string() })),
      disclosure_exceptions: z.array(z.object({ recipient: z.string(), cfr_cite: z.string() })),
      disclaimer: z.string(),
    }),
    summarize: (v) =>
      `${v.privacy_case ? "PRIVACY CASE" : "Not a privacy case"} — ${v.basis}\n` +
      `Name field on the 300 Log: ${v.log_name_entry}.` +
      (v.required_actions.length
        ? `\n\nAlso required:\n${v.required_actions.map((a) => `• ${a.action} [${a.cfr_cite}]`).join("\n")}`
        : ""),
    run: checkPrivacyCase,
  });
}
