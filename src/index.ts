#!/usr/bin/env node
/**
 * Entry point. Importing the registration modules is what wires the server —
 * each module registers its own primitives against the shared instance.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

/**
 * Main entry point for the standard input/output (stdio) transport mode.
 * Spawns the MCP server and connects it to the stdio transport channel.
 * Reports client version and capabilities on initial connection.
 */
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();

  server.server.oninitialized = () => {
    const caps = server.server.getClientCapabilities();
    // Elicitation is optional in the protocol; surfacing what the client actually
    // negotiated turns "the prompt never appeared" into a one-line diagnosis.
    console.error(
      `client=${JSON.stringify(server.server.getClientVersion())} capabilities=${JSON.stringify(caps)} ` +
        `elicitation=${caps?.elicitation ? "supported" : "NOT supported"}`
    );
  };

  await server.connect(transport);
  // stderr so we never corrupt the stdio JSON-RPC channel
  console.error("osha-recordkeeping-mcp running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting osha-recordkeeping-mcp:", err);
  process.exit(1);
});
