/**
 * Prompt registrations: the incident-triage chain as one user-invoked workflow.
 * Registers prompts that guide the client LLM through a structured, multi-step
 * OSHA recordkeeping triage process.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface TriageArgs {
  incident_description: string;
  incident_datetime?: string;
  learned_datetime?: string;
}

/**
 * Registers the `triage_incident` prompt with the MCP server.
 * This prompt orchestrates the workflow by instructing the calling LLM to invoke
 * deterministic triage tools in a specific sequence corresponding to 29 CFR Part 1904.
 *
 * @param server The MCP server instance.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "triage_incident",
    {
      title: "Triage a workplace incident",
      description:
        "Walk an injury or illness through the full OSHA chain: whether recordkeeping applies at all (1904.1), " +
        "which employer records it (1904.31), " +
        "work-relatedness (1904.5), new case (1904.6), restricted work (1904.7(b)(4)), hearing loss (1904.10), " +
        "recordability (1904.4), " +
        "severe-injury reporting (1904.39), 300-Log classification (1904.29), whether the " +
        "employee's name may appear on the log (1904.29(b)(6)-(9)), and which establishment's log it belongs on (1904.30).",
      argsSchema: {
        incident_description: z
          .string()
          .describe("Plain-language description of what happened, the treatment given, and the outcome."),
        incident_datetime: z
          .string()
          .optional()
          .describe("ISO 8601 datetime the incident occurred (needed for the reporting clock)."),
        learned_datetime: z
          .string()
          .optional()
          .describe("ISO 8601 datetime the employer learned of any severe outcome."),
      },
    },
    ({ incident_description, incident_datetime, learned_datetime }: TriageArgs) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Triage this workplace incident using the OSHA tools, in order. Do not guess — map the ` +
              `narrative to each tool's controlled inputs and rely on the tools' determinations.\n\n` +
              `INCIDENT: ${incident_description}\n` +
              (incident_datetime ? `INCIDENT TIME: ${incident_datetime}\n` : "") +
              (learned_datetime ? `EMPLOYER LEARNED: ${learned_datetime}\n` : "") +
              `\nSteps:\n` +
              `1. If the employer is small (10 or fewer employees company-wide at all times last year) or ` +
              `may be in a partially exempt industry, call osha_check_recordkeeping_obligation FIRST ` +
              `(1904.1). If recordkeeping is not required, STOP the 300-Log chain — but say clearly that ` +
              `1904.39 severe-injury reporting still applies, and run step 8 if the outcome warrants it.\n` +
              `2. If the injured person is NOT on the employer's payroll — a temp, a leased or supplied ` +
              `worker, a contractor's employee, someone self-employed, or an owner — call ` +
              `osha_determine_recording_employer FIRST (1904.31). Day-to-day supervision decides, not the ` +
              `paycheck. If it comes back 'the other employer' or 'no one', stop: this is not the ` +
              `employer's case to record.\n` +
              `3. Call osha_assess_work_relatedness (1904.5) — every other determination depends ` +
              `on it. If it returns requires_judgment, put its question to the user and do not proceed ` +
              `on a guess. Pass the resulting work_related value into the next step.\n` +
              `4. Call osha_assess_new_case (1904.6) — a new 300-Log entry, or an update to one already ` +
              `there. A recurrence caused by a workplace exposure IS a new case; a chronic illness ` +
              `recurring without exposure is recorded once only. A PLHCP recommendation, once sought, ` +
              `binds. Pass the resulting new_case value into the next step.\n` +
              `5. If any work restriction, job transfer, or partial shift is mentioned, call ` +
              `osha_evaluate_restricted_work (1904.7(b)(4)) before treating it as an outcome. Not every ` +
              `restriction counts: one confined to the day of injury does not, and reduced output alone ` +
              `does not — but a vague 'light duty' that cannot be clarified MUST be recorded.\n` +
              `6. If an audiogram is involved, call osha_evaluate_hearing_loss (1904.10). Pass the ` +
              `raw thresholds — both tests must be met in the SAME ear, and the tool does the ` +
              `arithmetic.\n` +
              `7. Call osha_assess_recordability to determine if this is OSHA recordable (1904.4). If it comes ` +
              `back with determination_final=false, ask the user the clarifying question and call it again ` +
              `before continuing.\n` +
              `8. If a fatality, in-patient hospitalization, amputation, or loss of an eye is involved, ` +
              `call osha_check_severe_injury_reporting to compute the OSHA reporting deadline (1904.39). Pass ` +
              `full ISO 8601 datetimes; if you only have vague timing, ask the user rather than guessing.\n` +
              `9. If recordable, call osha_classify_300_log_entry to determine the correct 300-Log column and ` +
              `day counts (1904.29).\n` +
              `10. If recordable, call osha_check_privacy_case to determine whether the employee's name may be ` +
              `entered on the 300 Log (1904.29(b)(6)-(9)). Do this for every recordable case, not only ` +
              `obvious ones — the list is closed in both directions.\n` +
              `11. If the employer has more than one site, call osha_route_to_establishment_log (1904.30). ` +
              `The case follows the PLACE, not the person: an injury at another of the employer's ` +
              `establishments goes on THAT site's log, not the employee's home site.\n\n` +
              `Then summarize: work-related (yes/no + basis), recordable (yes/no + basis), reporting deadline (if any), the 300-Log ` +
              `entry, and whether the name field reads "privacy case". Cite the CFR section for each ` +
              `conclusion, and note that this is reference/triage only, not legal advice.`,
          },
        },
      ],
    })
  );
}

