import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuleTool } from "../../server.js";
import {
  evaluateRestrictedWork,
  evaluateRestrictedWorkInputShape,
  type EvaluateRestrictedWorkInput,
  type RestrictedWorkDetermination,
} from "../../tools/evaluateRestrictedWork.js";

/**
 * Registers the `osha_evaluate_restricted_work` tool with the MCP server.
 *
 * This tool evaluates work restrictions and job transfers to determine if they meet the
 * definition of restricted work under 29 CFR § 1904.7(b)(4) — whether the restriction
 * actually counts.
 *
 * @param server The MCP server instance.
 */
export function registerRestrictedWork(server: McpServer): void {
  registerRuleTool<EvaluateRestrictedWorkInput, RestrictedWorkDetermination>(server, {
    name: "osha_evaluate_restricted_work",
    title: "Evaluate Restricted Work or Job Transfer (29 CFR 1904.7(b)(4))",
    description:
      "Decide whether a work restriction or job transfer actually counts as restricted work — not every " +
      "restriction does. Run this BEFORE passing 'restricted_work_or_transfer' as an outcome to " +
      "osha_assess_recordability, because getting it wrong moves cases onto or off the 300 Log. The rules " +
      "it applies: a restriction confined to the day of injury does not count (b)(4)(iii); reduced output " +
      "while still doing all routine functions does not count (b)(4)(vi); a restriction that misses every " +
      "routine function does not count (b)(4)(iv), where routine functions are activities performed at " +
      "least once per week (b)(4)(ii); a partial shift does count (b)(4)(v); and a job transfer is recorded " +
      "in the same column (b)(4)(ix)-(x)). Critically, when a vague recommendation such as 'light duty' " +
      "cannot be clarified with the PLHCP, the case MUST be recorded as restricted work (b)(4)(vii)) — the " +
      "regulation resolves that doubt toward recording. Reference and triage only — not legal advice.",
    inputShape: evaluateRestrictedWorkInputShape,
    outputValue: z.object({
      restricted_work: z.boolean(),
      basis: z.string(),
      applied_test: z.string().nullable(),
      cfr_cites: z.array(z.string()),
      recorded_by_default: z.boolean(),
      log_note: z.string(),
      disclaimer: z.string(),
    }),
    summarize: (v) =>
      `${v.restricted_work ? "RESTRICTED WORK" : "Not restricted work"}${
        v.recorded_by_default ? " (recorded by default — clarification unobtainable)" : ""
      } — ${v.basis}\n${v.log_note}`,
    run: evaluateRestrictedWork,
  });
}
