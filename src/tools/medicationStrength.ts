/**
 * The one recordability question the tool must never answer by guessing:
 * was the medication over-the-counter strength, or prescription-strength?
 * Nonprescription-strength is first aid (1904.7(b)(5)(ii)(A)); prescription-
 * strength is medical treatment and makes the case recordable.
 *
 * Two channels resolve it, because elicitation is an optional MCP capability:
 *   1. Clients that advertise `elicitation` — the server asks the user directly.
 *   2. Clients that do not (Claude Desktop today) — the server hands the question
 *      back to the calling model, which can always ask in conversation.
 * Either way a human answers. The tool never picks for them.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AMBIGUOUS_MEDICATION_CODE,
  MEDICATION_STRENGTH_CODES,
  type AssessRecordabilityInput,
} from "./assessRecordability.js";

/** The outcome of a medication strength resolution attempt. */
export type StrengthResolution =
  | { status: "resolved"; args: AssessRecordabilityInput }
  | { status: "declined" | "unsupported"; args: AssessRecordabilityInput };

/**
 * Evaluates whether medication strength resolution is required to decide recordability.
 *
 * Elicitation should only be initiated when the strength of the medication is the *deciding factor* for
 * recordability (i.e., a work-related new case with no other recordable trigger). If the case is already
 * recordable due to other factors (such as days away, significant diagnoses, or specific-case triggers),
 * asking for clarification would be unnecessary noise.
 *
 * @param args The input arguments for the recordability assessment.
 * @returns True if resolution is needed to determine recordability.
 */
export function needsStrengthResolution(args: AssessRecordabilityInput): boolean {
  return (
    args.work_related &&
    args.new_case &&
    args.outcomes.length === 0 &&
    args.significant_diagnoses.length === 0 &&
    // A specific-case criterion (1904.8-1904.12) already makes the case recordable
    // without consulting the first-aid list, so the strength cannot change the answer.
    args.specific_case_criteria.length === 0 &&
    args.plhcp_recommendations_not_followed.length === 0 &&
    args.treatments.includes(AMBIGUOUS_MEDICATION_CODE)
  );
}

/** The fallback payload: everything the model needs to ask and re-call correctly. */
export const STRENGTH_CLARIFICATION = {
  question:
    "Was the medication over-the-counter strength, or prescription-strength (or prescribed by a PLHCP)?",
  why:
    "Nonprescription-strength medication is first aid (not recordable). Prescription-strength " +
    "medication is medical treatment and makes the case recordable (1904.7(b)(5)(ii)(A)).",
  options: [
    {
      answer: "over-the-counter strength",
      recall_with_treatment_code: MEDICATION_STRENGTH_CODES.nonprescription,
    },
    {
      answer: "prescription-strength or prescribed",
      recall_with_treatment_code: MEDICATION_STRENGTH_CODES.prescription,
    },
  ],
  instruction:
    "This determination is NOT final. Ask the user the question above, then call osha_assess_recordability " +
    "again, replacing 'medication_unspecified_strength' with the treatment code matching their answer. " +
    "Do not present the pending result as a final recordability decision.",
} as const;

/**
 * Helper function to replace the ambiguous medication code with the resolved strength code in the inputs.
 *
 * @param args The original input arguments.
 * @param code The resolved medication strength code (nonprescription or prescription).
 * @returns The updated input arguments.
 */
function withStrength(
  args: AssessRecordabilityInput,
  code: string
): AssessRecordabilityInput {
  return {
    ...args,
    treatments: args.treatments.map((t) => (t === AMBIGUOUS_MEDICATION_CODE ? code : t)),
  };
}

/**
 * Resolves the medication strength (over-the-counter vs prescription-strength) by asking the client.
 *
 * It checks if the client advertises `elicitation` capabilities in accordance with the Model Context Protocol:
 * - **If supported:** It prompts the user directly via `server.server.elicitInput()` and returns the resolved input.
 * - **If unsupported:** It returns `{ status: "unsupported", args }` so the calling model can ask in the chat.
 *
 * @param server The MCP server instance.
 * @param args The current assessRecordability inputs containing the ambiguous medication code.
 * @returns The resolution status and updated arguments.
 */
export async function resolveMedicationStrength(
  server: McpServer,
  args: AssessRecordabilityInput
): Promise<StrengthResolution> {
  // Check what the client supports before spending a round-trip. Claude Desktop
  // advertises no elicitation capability, so this is the common path, not the edge.
  if (!server.server.getClientCapabilities()?.elicitation) {
    return { status: "unsupported", args };
  }
  try {
    const res = await server.server.elicitInput({
      message:
        "The report mentions medication but not its strength. Nonprescription-strength medication is " +
        "first aid; prescription-strength (or prescribed) medication is medical treatment and makes the " +
        "case OSHA recordable. Which was it?",
      requestedSchema: {
        type: "object",
        properties: {
          strength: {
            type: "string",
            title: "Medication strength",
            description:
              "nonprescription = over-the-counter dose; prescription = prescription-strength or prescribed",
            enum: ["nonprescription", "prescription"],
          },
        },
        required: ["strength"],
      },
    });

    if (res.action === "accept" && res.content && typeof res.content.strength === "string") {
      const code =
        res.content.strength === "prescription"
          ? MEDICATION_STRENGTH_CODES.prescription
          : MEDICATION_STRENGTH_CODES.nonprescription;
      return { status: "resolved", args: withStrength(args, code) };
    }
    return { status: "declined", args };
  } catch {
    return { status: "unsupported", args };
  }
}
