import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ruleRecordOutput, READ_ONLY, toolResult } from "../../server.js";
import {
  assessRecordability,
  assessRecordabilityInputShape,
  COMPLETENESS_CLARIFICATION,
  type AssessRecordabilityInput,
} from "../../tools/assessRecordability.js";
import {
  needsStrengthResolution,
  resolveMedicationStrength,
  STRENGTH_CLARIFICATION,
} from "../../tools/medicationStrength.js";

/**
 * Registers the `osha_assess_recordability` (29 CFR § 1904.7) tool with the MCP server —
 * the anchor determination the rest of the chain feeds.
 *
 * Registered by hand rather than through `registerRuleTool`: it is the only tool that may
 * have to ask the user a question before it can decide, so it is async and it appends the
 * resolution state to its own output. The two questions it can raise are an ambiguous
 * medication strength and an incomplete narrative.
 *
 * @param server The MCP server instance.
 */
export function registerAssessRecordability(server: McpServer): void {
  server.registerTool(
    "osha_assess_recordability",
    {
    title: "Assess OSHA Recordability (29 CFR 1904.4)",
    description:
      "Determine whether a work-related injury or illness is OSHA recordable under the 1904.4 decision " +
      "tree: work-related AND a new case AND meeting either the general recording criteria of 1904.7 " +
      "OR a specific-case criterion of 1904.8-1904.12 (needlestick, medical removal, hearing loss, " +
      "tuberculosis). Map the incident narrative to the controlled inputs. The tool applies the closed " +
      "first-aid list in 1904.7(b)(5)(ii) deterministically and returns a cited determination. Reference and triage only — not legal advice or a medical determination. " +
      "If the result has determination_final=false, it is provisional: follow the clarification_required " +
      "instruction, ask the user, and call this tool again with their answer.",
    inputSchema: assessRecordabilityInputShape,
    outputSchema: ruleRecordOutput(
      z.object({
        recordable: z.boolean(),
        basis: z.string(),
        triggering_factors: z.array(z.object({ factor: z.string(), cfr_cite: z.string() })),
        severe_injury_reporting_note: z.string().nullable(),
        log_entry_notes: z.array(z.string()),
        under_specified: z.boolean(),
        determination_final: z.boolean(),
        clarification_required: z
          .object({
            question: z.string(),
            why: z.string(),
            options: z.array(
              z.object({ answer: z.string(), recall_with_treatment_code: z.string() })
            ),
            instruction: z.string(),
          })
          .nullable(),
      })
    ),
    annotations: READ_ONLY,
  },
  async (input) => {
    let args = input as AssessRecordabilityInput;
    let unresolved = false;
    if (needsStrengthResolution(args)) {
      const resolution = await resolveMedicationStrength(server, args);
      args = resolution.args;
      unresolved = resolution.status !== "resolved";
    }

    const record = assessRecordability(args);

    // Two different things can leave a determination provisional: an unresolved
    // medication strength, or a narrative that asserted nothing at all. Strength
    // wins when both apply — it is the more specific, answerable question.
    const clarification = unresolved
      ? STRENGTH_CLARIFICATION
      : record.value.under_specified
        ? COMPLETENESS_CLARIFICATION
        : null;

    const value = {
      ...record.value,
      determination_final: clarification === null,
      clarification_required: clarification,
    };

    const summary = clarification
      ? `Provisional — not a final determination. ${record.value.basis}\n\nAsk the user: ${clarification.question}`
      : `${record.value.recordable ? "RECORDABLE" : "Not recordable"} — ${record.value.basis}` +
        (record.value.log_entry_notes.length
          ? `\n\n${record.value.log_entry_notes.map((n) => `• ${n}`).join("\n")}`
          : "");

      return toolResult({ ...record, value }, summary);
    }
  );
}
