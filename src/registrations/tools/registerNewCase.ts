import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuleTool } from "../../server.js";
import {
  assessNewCase,
  assessNewCaseInputShape,
  type AssessNewCaseInput,
  type NewCaseDetermination,
} from "../../tools/assessNewCase.js";

/**
 * Registers the `osha_assess_new_case` tool with the MCP server.
 *
 * This tool evaluates whether an injury or illness is a new case or a continuation
 * of an existing case under 29 CFR § 1904.6 — a new entry, or an update to the one
 * already on the log.
 *
 * @param server The MCP server instance.
 */
export function registerNewCase(server: McpServer): void {
  registerRuleTool<AssessNewCaseInput, NewCaseDetermination>(server, {
    name: "osha_assess_new_case",
    title: "Assess New Case vs. Continuation (29 CFR 1904.6)",
    description:
      "Determine whether an injury or illness is a NEW case or a continuation of one already on the 300 " +
      "Log — the second condition of the 1904.4(a) conjunction. Run this after osha_assess_work_relatedness " +
      "and before osha_assess_recordability, and pass its `new_case` result through. Key distinctions it " +
      "settles: a recurrence CAUSED by a workplace exposure is a new case (1904.6(b)(2), e.g. an " +
      "occupational asthma episode), while a chronic illness whose symptoms recur WITHOUT exposure is " +
      "recorded only once (1904.6(b)(1)). A PLHCP recommendation, once sought, is binding and overrides " +
      "the rule logic (1904.6(b)(3)). Returns work_case verdicts of new_case, not_new_case, or " +
      "requires_judgment — the last when PLHCP opinions conflict or causation is unestablished. Treat " +
      "requires_judgment as a question for the user, never as a licence to pick. Reference and triage " +
      "only — not legal advice or a medical determination.",
    inputShape: assessNewCaseInputShape,
    outputValue: z.object({
      verdict: z.string(),
      new_case: z.boolean().nullable(),
      basis: z.string(),
      applied_test: z.string().nullable(),
      cfr_cites: z.array(z.string()),
      decided_by_plhcp: z.boolean(),
      judgment_required: z
        .object({ question: z.string(), why: z.string(), cfr_cite: z.string() })
        .nullable(),
      log_action: z.string(),
      disclaimer: z.string(),
    }),
    summarize: (v) => {
      if (v.verdict === "requires_judgment") {
        return `REQUIRES JUDGMENT — ${v.basis}\n\nAsk the user: ${v.judgment_required?.question}`;
      }
      const head = v.verdict === "new_case" ? "NEW CASE" : "Not a new case";
      const via = v.decided_by_plhcp ? " (decided by the binding PLHCP recommendation)" : "";
      return `${head}${via} — ${v.basis}\n${v.log_action}`;
    },
    run: assessNewCase,
  });
}
