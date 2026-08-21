import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuleTool } from "../../server.js";
import {
  checkRecordkeepingObligation,
  checkRecordkeepingObligationInputShape,
  type CheckRecordkeepingObligationInput,
  type RecordkeepingObligation,
} from "../../tools/checkRecordkeepingObligation.js";

/**
 * Registers the `osha_check_recordkeeping_obligation` tool with the MCP server.
 *
 * This tool determines whether an employer is obligated to keep recordkeeping logs
 * based on size (1904.1) and industry classification (1904.2) — whether Part 1904
 * recordkeeping applies at all.
 *
 * @param server The MCP server instance.
 */
export function registerRecordkeepingObligation(server: McpServer): void {
  registerRuleTool<CheckRecordkeepingObligationInput, RecordkeepingObligation>(server, {
    name: "osha_check_recordkeeping_obligation",
    title: "Check Whether Recordkeeping Applies (29 CFR 1904.1)",
    description:
      "The threshold question every other Part 1904 determination assumes: is this employer required to keep " +
      "OSHA injury and illness records at all? Run this FIRST for any small employer or any establishment " +
      "that may be in a partially exempt industry — otherwise the chain will confidently instruct them to " +
      "make 300-Log entries for a log they need not keep. Two things are commonly got backwards: the size " +
      "exemption is measured across the ENTIRE COMPANY, not one establishment (1904.1(b)(1)), and it uses " +
      "PEAK employment during the last calendar year, not an average or year-end figure (1904.1(b)(2)). A " +
      "written request from OSHA or BLS under 1904.41/1904.42 defeats the exemption. CRITICALLY, the " +
      "exemption is PARTIAL: 1904.39 severe-injury reporting binds every employer covered by the OSH Act " +
      "regardless — an exempt employer still owes OSHA the 8-hour fatality call. Supply establishment_naics_code " +
      "and the tool resolves the 1904.2 industry question itself against the closed Appendix A list, matching " +
      "on the first four digits. Reference and triage only.",
    inputShape: checkRecordkeepingObligationInputShape,
    outputValue: z.object({
      recordkeeping_required: z.boolean(),
      basis: z.string(),
      exemption: z.string(),
      matched_industry: z.object({ naics_group: z.string(), title: z.string() }).nullable(),
      severe_injury_reporting_still_required: z.boolean(),
      severe_injury_reporting_note: z.string(),
      naics_determination_methods: z.array(z.string()),
      cfr_cites: z.array(z.string()),
      disclaimer: z.string(),
    }),
    summarize: (v) =>
      `${v.recordkeeping_required ? "RECORDKEEPING REQUIRED" : "PARTIALLY EXEMPT from recordkeeping"} — ${v.basis}` +
      `\n\n⚠ ${v.severe_injury_reporting_note}` +
      (v.naics_determination_methods.length
        ? `\n\nTo confirm the 1904.2 industry classification:\n${v.naics_determination_methods.map((m) => `• ${m}`).join("\n")}`
        : ""),
    run: checkRecordkeepingObligation,
  });
}
