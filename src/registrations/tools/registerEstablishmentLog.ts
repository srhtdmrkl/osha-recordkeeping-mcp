import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRuleTool } from "../../server.js";
import {
  routeToEstablishmentLog,
  routeToEstablishmentLogInputShape,
  type RouteToEstablishmentLogInput,
  type EstablishmentRouting,
} from "../../tools/routeToEstablishmentLog.js";

/**
 * Registers the `osha_route_to_establishment_log` tool with the MCP server.
 *
 * This tool routes a recordable case to the correct establishment log under 29 CFR § 1904.30
 * based on place of occurrence, telecommuting status, and recordkeeping configuration —
 * which establishment's 300 Log the case belongs on.
 *
 * @param server The MCP server instance.
 */
export function registerEstablishmentLog(server: McpServer): void {
  registerRuleTool<RouteToEstablishmentLogInput, EstablishmentRouting>(server, {
    name: "osha_route_to_establishment_log",
    title: "Route a Case to the Right Establishment Log (29 CFR 1904.30)",
    description:
      "Decide WHICH establishment's OSHA 300 Log a recordable case belongs on — the last question about an " +
      "individual incident, and one multi-site employers routinely get backwards. Under 1904.30(b)(4) the " +
      "case follows the PLACE, not the person: an injury occurring at one of the employer's establishments " +
      "is recorded on THAT establishment's log even when the employee normally works elsewhere, while an " +
      "injury away from all of them (a customer site, in transit, remote work) goes on the log of the " +
      "establishment where the employee normally works. Also reports whether the destination needs its own " +
      "log — required for establishments expected to operate a year or longer (1904.30(a)), optional for " +
      "short-term sites which may share a combined log (b)(1) — and, when records are kept centrally, the " +
      "7-calendar-day transmission deadline and the two conditions central recordkeeping depends on " +
      "(b)(2)). Reference and triage only — not legal advice.",
    inputShape: routeToEstablishmentLogInputShape,
    outputValue: z.object({
      log_destination: z.string(),
      basis: z.string(),
      destination_needs_own_log: z.boolean(),
      own_log_basis: z.string(),
      transmit_by_iso: z.string().nullable(),
      central_recordkeeping_conditions: z.array(
        z.object({ condition: z.string(), cfr_cite: z.string() })
      ),
      cfr_cites: z.array(z.string()),
      disclaimer: z.string(),
    }),
    summarize: (v) =>
      `Record on the log of the ${v.log_destination.replace(/_/g, " ")}.\n${v.basis}\n\n` +
      `${v.destination_needs_own_log ? "That establishment needs its own 300 Log." : "That establishment may share a combined short-term log."} ${v.own_log_basis}` +
      (v.transmit_by_iso
        ? `\n\nCentral recordkeeping: transmit by ${v.transmit_by_iso} (7 calendar days).`
        : "") +
      (v.central_recordkeeping_conditions.length
        ? `\n${v.central_recordkeeping_conditions.map((c) => `• ${c.condition} [${c.cfr_cite}]`).join("\n")}`
        : ""),
    run: routeToEstablishmentLog,
  });
}
