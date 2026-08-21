import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuleTool } from "../../server.js";
import {
  assessWorkRelatedness,
  assessWorkRelatednessInputShape,
  type AssessWorkRelatednessInput,
  type WorkRelatednessDetermination,
} from "../../tools/assessWorkRelatedness.js";

/**
 * Registers the `osha_assess_work_relatedness` tool with the MCP server.
 *
 * This tool evaluates whether an injury or illness is work-related under 29 CFR § 1904.5 —
 * the gate every other determination rests on.
 *
 * @param server The MCP server instance.
 */
export function registerWorkRelatedness(server: McpServer): void {
  registerRuleTool<AssessWorkRelatednessInput, WorkRelatednessDetermination>(server, {
    name: "osha_assess_work_relatedness",
    title: "Assess Work-Relatedness (29 CFR 1904.5)",
    description:
      "Determine whether an injury or illness is work-related — the gate every other Part 1904 " +
      "determination depends on. 1904.5(a) presumes work-relatedness for anything arising from the work " +
      "environment unless one of the nine closed exceptions in 1904.5(b)(2) applies. Run this BEFORE " +
      "osha_assess_recordability and pass its `work_related` result through. Returns one of three " +
      "verdicts: work_related, not_work_related, or requires_judgment — the last when the regulation " +
      "itself calls for the employer's evaluation (unclear origin under 1904.5(b)(3), travel status, " +
      "working at home) or when an exception's 'solely' requirement is not established. Treat " +
      "requires_judgment as a question to put to the user, never as a licence to pick. Reference and " +
      "triage only — not legal advice.",
    inputShape: assessWorkRelatednessInputShape,
    outputValue: z.object({
      verdict: z.string(),
      work_related: z.boolean().nullable(),
      basis: z.string(),
      applied_exception: z.string().nullable(),
      cfr_cites: z.array(z.string()),
      judgment_required: z
        .object({ question: z.string(), why: z.string(), cfr_cite: z.string() })
        .nullable(),
      disclaimer: z.string(),
    }),
    summarize: (v) => {
      if (v.verdict === "requires_judgment") {
        return (
          `REQUIRES JUDGMENT — this is not a determination the closed list can make.\n${v.basis}\n\n` +
          `Ask the user: ${v.judgment_required?.question}`
        );
      }
      return `${v.verdict === "work_related" ? "WORK-RELATED" : "NOT work-related"} — ${v.basis}`;
    },
    run: assessWorkRelatedness,
  });
}
