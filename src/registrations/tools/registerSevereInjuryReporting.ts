import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuleTool } from "../../server.js";
import {
  checkSevereInjuryReporting,
  checkSevereInjuryReportingInputShape,
  type CheckSevereInjuryReportingInput,
  type SevereReportingDetermination,
} from "../../tools/checkSevereInjuryReporting.js";

/**
 * Registers the `osha_check_severe_injury_reporting` tool with the MCP server.
 *
 * This tool determines severe-injury reporting requirements (fatality, hospitalization,
 * amputation, eye loss) and calculates deadlines under 29 CFR § 1904.39 — the reporting
 * clock, which runs independently of whether the case is recordable.
 *
 * @param server The MCP server instance.
 */
export function registerSevereInjuryReporting(server: McpServer): void {
  registerRuleTool<CheckSevereInjuryReportingInput, SevereReportingDetermination>(server, {
    name: "osha_check_severe_injury_reporting",
    title: "Check Severe-Injury Reporting Deadline (29 CFR 1904.39)",
    description:
      "Determine whether a fatality, in-patient hospitalization, amputation, or loss of an eye must be " +
      "reported to OSHA, and compute the actual reporting deadline (8 hours for a fatality, 24 hours for the " +
      "others) from when the employer learned of it. Also checks the eligibility window from the incident. " +
      "Datetimes must be full ISO 8601. Applies the 1904.39(b)(11) amputation definition (a severed ear, " +
    "avulsion, degloving or chipped tooth is NOT an amputation), the (b)(10) rule that a hospitalization for " +
    "observation or diagnostics alone is not reportable, and the (b)(3)-(b)(4) exclusions for public-road motor " +
    "vehicle accidents outside construction work zones and events on commercial or public transport. Every one " +
    "of those still leaves the case RECORDABLE. Reference and triage only — not legal advice.",
    inputShape: checkSevereInjuryReportingInputShape,
    outputValue: z.object({
      reportable: z.boolean(),
      outcome: z.string(),
      deadline_iso: z.string().nullable(),
      hours_remaining: z.number().nullable(),
      overdue: z.boolean(),
      eligibility_note: z.string(),
      reporting_methods: z.array(z.string()),
      required_information: z.array(z.string()),
      still_recordable: z.boolean(),
      input_error: z.string().nullable(),
    }),
    summarize: (v) => {
      if (v.input_error) return `Could not compute the deadline. ${v.input_error}\n\n${v.eligibility_note}`;
      if (!v.reportable) {
        return (
          `Not reportable to OSHA. ${v.eligibility_note}` +
          (v.still_recordable ? "\n\nThis does NOT mean nothing to do — the case still goes on the 300 Log if it meets the 1904.7 criteria." : "")
        );
      }
      const clock = v.overdue
        ? `OVERDUE by ${Math.abs(v.hours_remaining ?? 0)} hours — report immediately.`
        : `${v.hours_remaining} hours remaining.`;
      return (
        `REPORTABLE — deadline ${v.deadline_iso}. ${clock}\n${v.eligibility_note}\n\n` +
        `Have ready (1904.39(b)(2)):\n${v.required_information.map((i) => `• ${i}`).join("\n")}`
      );
    },
    run: checkSevereInjuryReporting,
  });
}
