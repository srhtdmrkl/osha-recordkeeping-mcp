/**
 * CI decay trap. Fails the build if any dataset's `last_verified` date is older
 * than its `decay_threshold_days`. Provenance as a field is theater unless the
 * build refuses to ship stale compliance data.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");

interface Provenance {
  cfr_cite: string;
  source_url: string;
  last_verified: string;
  decay_threshold_days: number;
  editorial_note?: string;
}

/**
 * Which subpart each section lives in. A source_url pointing at the wrong subpart
 * is a dead provenance link — it looks right and leads nowhere, which is worse
 * than no link at all.
 */
const SUBPART: Record<string, string> = {
  "1904.1": "B", "1904.2": "B", "1904.4": "C", "1904.5": "C", "1904.6": "C", "1904.7": "C", "1904.8": "C",
  "1904.9": "C", "1904.10": "C", "1904.11": "C", "1904.12": "C", "1904.29": "C",
  "1904.30": "D", "1904.31": "D", "1904.39": "E", "1904.46": "G",
};

/**
 * Calculates the number of calendar days elapsed since a given ISO date.
 *
 * @param iso YYYY-MM-DD date string.
 * @returns The integer count of elapsed days.
 */
function daysSince(iso: string): number {
  const then = new Date(iso + "T00:00:00Z").getTime();
  return Math.floor((Date.now() - then) / 86_400_000);
}

let failures = 0;
const editorialNotes = new Set<string>();
const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
  const p: Provenance | undefined = raw.provenance;

  if (!p || !p.last_verified || typeof p.decay_threshold_days !== "number") {
    console.error(`✗ ${file}: missing provenance (last_verified / decay_threshold_days).`);
    failures++;
    continue;
  }

  const age = daysSince(p.last_verified);
  if (age > p.decay_threshold_days) {
    console.error(
      `✗ ${file} (${p.cfr_cite}): last verified ${age} days ago, threshold is ${p.decay_threshold_days}. Re-verify against eCFR.`
    );
    failures++;
  } else {
    console.log(`✓ ${file} (${p.cfr_cite}): ${age} days old, within ${p.decay_threshold_days}.`);
  }

  // Editorial notes record things the section text does not — chiefly amendments
  // later withdrawn. Anyone re-verifying against an archived copy needs to see this.
  if (p.editorial_note) editorialNotes.add(p.editorial_note);

  const section = p.cfr_cite?.match(/1904\.\d+/)?.[0];
  const urlSubpart = p.source_url?.match(/subpart-([A-G])/)?.[1];
  const wantSubpart = section ? SUBPART[section] : undefined;
  if (wantSubpart && urlSubpart && urlSubpart !== wantSubpart) {
    console.error(
      `✗ ${file}: source_url points at subpart ${urlSubpart} but ${section} is in subpart ${wantSubpart}.`
    );
    failures++;
  }
}

for (const note of editorialNotes) {
  console.warn(`\n⚠ Editorial note bearing on re-verification:\n  ${note}`);
}

if (failures > 0) {
  console.error(`\nDecay check failed: ${failures} dataset(s) stale or malformed.`);
  process.exit(1);
}
console.log("\nDecay check passed.");
