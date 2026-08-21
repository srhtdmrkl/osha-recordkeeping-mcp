import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuleTool } from "../../server.js";
import {
  determineRecordingEmployer,
  determineRecordingEmployerInputShape,
  type DetermineRecordingEmployerInput,
  type RecordingEmployerDetermination,
} from "../../tools/determineRecordingEmployer.js";

/**
 * Registers the `osha_determine_recording_employer` tool with the MCP server.
 *
 * This tool determines which employer must record the case under 29 CFR § 1904.31
 * for temporary, leased, supplied, or contractor employees — whose 300 Log, settled before
 * the question of which one.
 *
 * @param server The MCP server instance.
 */
export function registerRecordingEmployer(server: McpServer): void {
  registerRuleTool<DetermineRecordingEmployerInput, RecordingEmployerDetermination>(server, {
    name: "osha_determine_recording_employer",
    title: "Determine Which Employer Records the Case (29 CFR 1904.31)",
    description:
      "Decide WHOSE OSHA 300 Log a case belongs on when the injured person is not a straightforward payroll " +
      "employee — a temp, a leased or supplied worker, a contractor's employee, someone self-employed, or an " +
      "owner. Run this FIRST whenever the injured person is not on the employer's payroll: if the answer is " +
      "'the other employer' or 'no one', the rest of the chain is not this employer's obligation. The " +
      "controlling test is DAY-TO-DAY SUPERVISION, not who issues the paycheck (1904.31(b)(2)-(b)(3)): a " +
      "temp on an agency's payroll whose work you direct daily is your case to record. Self-employed people " +
      "are not covered by the OSH Act at all (b)(1)), and owners or partners of a sole proprietorship or " +
      "partnership are not employees for recordkeeping (a)). Every payroll category counts — part-time, " +
      "seasonal and migrant workers included. 1904.31(b)(4) requires the case be recorded exactly once, " +
      "never on both employers' logs. Reference and triage only — not legal advice.",
    inputShape: determineRecordingEmployerInputShape,
    outputValue: z.object({
      recording_employer: z.string(),
      you_must_record: z.boolean(),
      basis: z.string(),
      decided_by_supervision: z.boolean(),
      coordination_note: z.string().nullable(),
      cfr_cites: z.array(z.string()),
      disclaimer: z.string(),
    }),
    summarize: (v) => {
      const head =
        v.recording_employer === "you"
          ? "YOU record this case"
          : v.recording_employer === "the_other_employer"
            ? "The OTHER employer records this case — not you"
            : "No one records this case";
      return `${head} — ${v.basis}` + (v.coordination_note ? `\n\n${v.coordination_note}` : "");
    },
    run: determineRecordingEmployer,
  });
}
