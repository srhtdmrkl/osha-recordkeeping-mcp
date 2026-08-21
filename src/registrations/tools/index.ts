/**
 * Barrel file for MCP tool registrations.
 *
 * Each module exports a register function; this barrel is the only thing that needs
 * updating when a tool is added.
 *
 * Order of imports and registrations follows the incident-triage chain, which is also
 * the order the `triage_incident` prompt walks and the order clients list tools in.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRecordkeepingObligation } from "./registerRecordkeepingObligation.js";
import { registerRecordingEmployer } from "./registerRecordingEmployer.js";
import { registerWorkRelatedness } from "./registerWorkRelatedness.js";
import { registerNewCase } from "./registerNewCase.js";
import { registerRestrictedWork } from "./registerRestrictedWork.js";
import { registerHearingLoss } from "./registerHearingLoss.js";
import { registerAssessRecordability } from "./registerAssessRecordability.js";
import { registerSevereInjuryReporting } from "./registerSevereInjuryReporting.js";
import { registerClassify300Log } from "./registerClassify300Log.js";
import { registerEstablishmentLog } from "./registerEstablishmentLog.js";
import { registerPrivacyCase } from "./registerPrivacyCase.js";

/**
 * Registers all OSHA triage and determination tools onto the MCP server instance.
 *
 * @param server The MCP server instance.
 */
export function registerTools(server: McpServer): void {
  registerRecordkeepingObligation(server);
  registerRecordingEmployer(server);
  registerWorkRelatedness(server);
  registerNewCase(server);
  registerRestrictedWork(server);
  registerHearingLoss(server);
  registerAssessRecordability(server);
  registerSevereInjuryReporting(server);
  registerClassify300Log(server);
  registerPrivacyCase(server);
  registerEstablishmentLog(server);
}
