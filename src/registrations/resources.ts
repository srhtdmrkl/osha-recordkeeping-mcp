/**
 * Resource registrations.
 *
 * Exposes the static JSON datasets directly as MCP Resources under custom `osha://`
 * URIs, allowing clients to load reference data directly as context.
 *
 * All resources are driven off the central `DATASETS` table under `src/datasets.ts`,
 * ensuring consistency between reference datasets and active tool logic.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DATASETS, datasetUri, loadDataset, type DatasetId } from "../datasets.js";

/**
 * Registers all OSHA reference datasets as MCP resources.
 *
 * @param server The MCP server instance.
 */
export function registerResources(server: McpServer): void {
  for (const id of Object.keys(DATASETS) as DatasetId[]) {
    const { title } = DATASETS[id];
    const data = loadDataset(id);

    server.registerResource(
      id,
      datasetUri(id),
      {
        title,
        description: `Provenance-backed reference data: ${title}. Every record carries a CFR cite, source URL, and last-verified date.`,
        mimeType: "application/json",
      },
      async (uri: URL) => ({
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) },
        ],
      })
    );
  }
}

