import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuleTool } from "../../server.js";
import {
  evaluateHearingLoss,
  evaluateHearingLossInputShape,
  type EvaluateHearingLossInput,
  type HearingLossDetermination,
} from "../../tools/evaluateHearingLoss.js";

const earSchema = z.object({
  ear: z.string(),
  baseline_average_db: z.number(),
  current_average_db: z.number(),
  shift_db: z.number(),
  standard_threshold_shift: z.boolean(),
  total_hearing_level_db: z.number(),
  total_hearing_level_met: z.boolean(),
  qualifies: z.boolean(),
});

/**
 * Registers the `osha_evaluate_hearing_loss` tool with the MCP server.
 *
 * This tool evaluates occupational hearing loss by checking standard threshold shift (STS)
 * and total hearing level thresholds in the same ear under 29 CFR § 1904.10 — the one
 * recording criterion that is arithmetic.
 *
 * @param server The MCP server instance.
 */
export function registerHearingLoss(server: McpServer): void {
  registerRuleTool<EvaluateHearingLossInput, HearingLossDetermination>(server, {
    name: "osha_evaluate_hearing_loss",
    title: "Evaluate Occupational Hearing Loss (29 CFR 1904.10)",
    description:
      "Compute whether an audiogram produces a recordable hearing loss. Two tests must BOTH be met and, " +
      "critically, in the SAME ear: a Standard Threshold Shift of 10 dB or more averaged at 2000, 3000 and " +
      "4000 Hz against the employee's baseline (1904.10(b)(1)), and a total hearing level of 25 dB or more " +
      "above audiometric zero on the current audiogram (1904.10(a)). An STS in one ear and a 25 dB level in " +
      "the other does not record. Pass raw audiogram values and the tool does the arithmetic — do not " +
      "compute averages yourself. If the employee has had a prior recordable hearing loss, pass the REVISED " +
      "baseline (b)(2)(i)). Age adjustment from Tables F-1/F-2 of 1910.95 appendix F applies to the STS test " +
      "only, never to the 25 dB test (b)(3)). A retest within 30 days that does not confirm the STS defeats " +
      "the case; one that confirms it starts a 7-day recording clock (b)(4)). A PLHCP determination of no " +
      "work-relatedness ends it entirely (b)(6)). Reference and triage only — not legal advice.",
    inputShape: evaluateHearingLossInputShape,
    outputValue: z.object({
      recordable: z.boolean(),
      basis: z.string(),
      ears: z.array(earSchema),
      qualifying_ears: z.array(z.string()),
      record_by_iso: z.string().nullable(),
      cfr_cites: z.array(z.string()),
      log_note: z.string(),
      disclaimer: z.string(),
    }),
    summarize: (v) => {
      const rows = v.ears
        .map(
          (e) =>
            `  ${e.ear.padEnd(5)} shift ${String(e.shift_db).padStart(5)} dB  ` +
            `STS ${e.standard_threshold_shift ? "yes" : "no "}  ` +
            `total ${String(e.total_hearing_level_db).padStart(5)} dB  ` +
            `25dB ${e.total_hearing_level_met ? "yes" : "no "}  ` +
            `${e.qualifies ? "→ QUALIFIES" : ""}`
        )
        .join("\n");
      return (
        `${v.recordable ? "RECORDABLE HEARING LOSS" : "Not recordable"} — ${v.basis}\n\n${rows}\n\n` +
        (v.record_by_iso ? `Record by: ${v.record_by_iso}\n` : "") +
        v.log_note
      );
    },
    run: evaluateHearingLoss,
  });
}
