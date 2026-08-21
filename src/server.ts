/**
 * Server construction and the registration helper every tool goes through.
 * Wiring only — no regulatory logic lives here.
 *
 * A factory rather than a singleton: the stdio entry point builds one server for
 * the process lifetime, while the HTTP entry point builds one per request so that
 * concurrent callers never share a connection. The determinations are pure, so a
 * fresh server per request costs nothing but the object allocation.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import type { RuleRecord } from "./types.js";
import { registerTools } from "./registrations/tools/index.js";
import { registerResources } from "./registrations/resources.js";
import { registerPrompts } from "./registrations/prompts.js";

export const SERVER_INFO = {
  name: "osha-recordkeeping-mcp",
  version: "0.1.0",
} as const;

/**
 * All tools are pure lookups over bundled regulatory data. Every hint is stated
 * explicitly rather than left to the client's defaults: nothing here writes,
 * nothing is destructive, the same input always yields the same output, and no
 * call reaches outside the process.
 */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Generates the Zod schema representing a RuleRecord output structure.
 *
 * Every tool returns a RuleRecord<T>. Declaring an outputSchema lets clients
 * consume typed structuredContent, not a JSON string.
 *
 * @param value The Zod type schema for the rule record's inner value payload.
 * @returns An object containing the combined Zod schema definition.
 */
export const ruleRecordOutput = (value: z.ZodTypeAny) => ({
  value,
  kind: z.string(),
  cfr_cite: z.string(),
  source_url: z.string(),
  last_verified: z.string(),
});

/**
 * Constructs an MCP-compliant tool response object from a RuleRecord.
 *
 * `structuredContent` carries the full typed record for programmatic clients; the text
 * content carries a sentence a safety manager can read, because dumping raw JSON at a
 * human is not an answer. The CFR cite rides along in the text so the citation survives
 * even in a plain-text transcript.
 *
 * @param record The rule record containing value and provenance.
 * @param summary A human-readable sentence summarizing the determination.
 * @returns The formatted MCP tool result object.
 */
export function toolResult<T>(record: RuleRecord<T>, summary: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${summary}\n\n— ${record.cfr_cite} · verified ${record.last_verified} · ${record.source_url}`,
      },
    ],
    structuredContent: record as unknown as Record<string, unknown>,
  };
}

interface RuleToolSpec<TInput, TValue> {
  name: string;
  title: string;
  description: string;
  inputShape: ZodRawShape;
  /** Zod schema for the RuleRecord's `value` payload. */
  outputValue: z.ZodTypeAny;
  /** One human sentence describing the determination. */
  summarize: (value: TValue) => string;
  run: (input: TInput) => RuleRecord<TValue>;
}

/**
 * Registers a synchronous OSHA evaluation tool onto the MCP server.
 *
 * Collapses the identical metadata/cast/wrap boilerplate that each tool would otherwise
 * repeat, so the only thing a tool file has to supply is its schema, its rule, and its
 * summary.
 *
 * @param server The MCP server instance.
 * @param spec The specification definition including name, schemas, summary generator, and execution rule.
 */
export function registerRuleTool<TInput, TValue>(
  server: McpServer,
  spec: RuleToolSpec<TInput, TValue>
): void {
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputShape,
      outputSchema: ruleRecordOutput(spec.outputValue),
      annotations: READ_ONLY,
    },
    async (input) => {
      const record = spec.run(input as TInput);
      return toolResult(record, spec.summarize(record.value));
    }
  );
}

/**
 * Factory function that instantiates and wires a fully configured McpServer.
 * Registers all regulatory evaluation tools, static resource documents, and prompts.
 *
 * @returns The fully constructed McpServer instance.
 */
export function createServer(): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerTools(server);
  registerResources(server);
  registerPrompts(server);
  return server;
}
