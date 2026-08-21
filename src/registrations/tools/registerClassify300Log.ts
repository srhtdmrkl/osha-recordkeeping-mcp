import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuleTool } from "../../server.js";
import {
  classify300LogEntry,
  classify300LogEntryInputShape,
  type Classify300LogEntryInput,
  type Log300Classification,
} from "../../tools/classify300LogEntry.js";

/**
 * Registers the `osha_classify_300_log_entry` tool with the MCP server.
 *
 * This tool classifies a recordable case into the correct OSHA 300 Log outcome column (G/H/I/J)
 * and calculates day counts and deadlines under 29 CFR § 1904.29. This is the step that
 * decides which column the case lands in.
 *
 * @param server The MCP server instance.
 */
export function registerClassify300Log(server: McpServer): void {
  registerRuleTool<Classify300LogEntryInput, Log300Classification>(server, {
    name: "osha_classify_300_log_entry",
    title: "Classify OSHA 300 Log Entry (29 CFR 1904.29)",
    description:
      "For a recordable case, determine the correct OSHA 300 Log outcome column (G death, H days away, " +
      "I job transfer/restriction, J other recordable) using the most-serious-outcome rule, the injury/illness " +
      "type column, and the day counts capped at 180. Check `on_log` first — it is false when the case is not " +
      "recordable. Medical removal cases must be days-away or restricted, never column J, and a removal " +
    "following a chemical exposure goes in the poisoning column (1904.9(b)(1)); a tuberculosis case goes in " +
    "the respiratory condition column (1904.11(a)), and may be lined out on the three kinds of evidence " +
    "1904.11(b)(2) enumerates. Run osha_assess_recordability " +
    "first. Reference and triage only.",
    inputShape: classify300LogEntryInputShape,
    outputValue: z.object({
      on_log: z.boolean(),
      outcome_column: z.string().nullable(),
      outcome_column_label: z.string().nullable(),
      illness_type_column: z.string().nullable(),
      days_away_recorded: z.number(),
      days_restricted_or_transfer_recorded: z.number(),
      capped: z.boolean(),
      notes: z.array(z.string()),
      record_by_iso: z.string().nullable(),
      forms_required: z.array(z.string()),
      amend_existing_entry: z.string().nullable(),
    }),
    summarize: (v) =>
      v.on_log
        ? `Column ${v.outcome_column} — ${v.outcome_column_label}. Type: ${v.illness_type_column}. ` +
          `Days away ${v.days_away_recorded}, restricted/transfer ${v.days_restricted_or_transfer_recorded}.` +
          (v.record_by_iso ? `\nRecord by ${v.record_by_iso} — 7 calendar days (1904.29(b)(3)).` : "") +
          (v.forms_required.length ? `\nForms: 300 Log line AND a 301 Incident Report (1904.29(b)(2)).` : "") +
          (v.notes.length ? `\n${v.notes.map((n) => `• ${n}`).join("\n")}` : "") +
          (v.amend_existing_entry ? `\n\n${v.amend_existing_entry}` : "")
        : v.notes[0],
    run: classify300LogEntry,
  });
}
