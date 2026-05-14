/**
 * Test-case recorder.
 *
 * Each document gets its own subfolder in test-cases/:
 *   test-cases/{documentId}/data.json
 *
 * Shape of data.json:
 * {
 *   documentId: string,
 *   createdAt: ISO string,
 *   groundTruth: { ...your verified correct parse result... },
 *   runs: [
 *     {
 *       runNumber: 1,
 *       timestamp: ISO string,
 *       result: { ...AI parse output... },
 *       comparison: {
 *         confidenceScore: 0–1,
 *         label: "Very Stable" | "Minor Differences" | "Moderate Drift" | "High Variance",
 *         type: string,
 *         breakdown: { ... }
 *       }
 *     }
 *   ]
 * }
 *
 * Usage:
 *   // One-time: set your ground truth
 *   await setGroundTruth("test-case-1", { type: "shipment", shipments: [...] });
 *
 *   // Every time AI parses the same doc:
 *   await recordRun("test-case-1", aiParseResult);
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { compareRuns } from "./confidence-scorer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_CASES_DIR = path.resolve(__dirname, "../../test-cases");

function caseDir(documentId) {
  const safe = documentId.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  return path.join(TEST_CASES_DIR, safe);
}

function dataFilePath(documentId) {
  return path.join(caseDir(documentId), "data.json");
}

async function ensureDir(documentId) {
  await fs.mkdir(caseDir(documentId), { recursive: true });
}

async function readFile(documentId) {
  try {
    const raw = await fs.readFile(dataFilePath(documentId), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeFile(documentId, data) {
  await ensureDir(documentId);
  await fs.writeFile(dataFilePath(documentId), JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Set (or replace) the ground truth for a document.
 * Call this once per document after you've manually verified the correct result.
 *
 * @param {string} documentId  - any unique identifier for the document
 * @param {object} groundTruth - your correct parse result (same shape as AI output)
 */
export async function setGroundTruth(documentId, groundTruth) {
  await ensureDir(documentId);
  const existing = (await readFile(documentId)) ?? {
    documentId,
    createdAt: new Date().toISOString(),
    groundTruth: null,
    runs: [],
  };

  existing.groundTruth = groundTruth;
  existing.groundTruthSetAt = new Date().toISOString();

  // Re-score all existing runs against new ground truth
  if (existing.runs.length) {
    for (const run of existing.runs) {
      run.comparison = compareRuns(groundTruth, run.result);
    }
  }

  await writeFile(documentId, existing);
  console.log(`✅ Ground truth set for "${documentId}"`);
  return existing;
}

/**
 * Promote an existing run's result as the ground truth.
 * Useful when one of the AI parse runs looks correct — no need to write a JSON file manually.
 *
 * @param {string} documentId
 * @param {number} runNumber  - which run to promote (1-based)
 */
export async function promoteRunAsGroundTruth(documentId, runNumber) {
  const data = await readFile(documentId);
  if (!data) throw new Error(`No test case found for "${documentId}"`);

  const run = data.runs.find((r) => r.runNumber === runNumber);
  if (!run) throw new Error(`Run #${runNumber} not found for "${documentId}"`);

  return setGroundTruth(documentId, run.result);
}

/**
 * Record a new AI parse run and automatically compare it against your ground truth.
 * If no ground truth exists yet, the run is stored but comparison is null.
 *
 * @param {string} documentId - same ID you used in setGroundTruth()
 * @param {object} aiResult   - the raw AI parse output
 * @returns {{ runNumber, comparison }}
 */
export async function recordRun(documentId, aiResult) {
  await ensureDir(documentId);
  const data = (await readFile(documentId)) ?? {
    documentId,
    createdAt: new Date().toISOString(),
    groundTruth: null,
    runs: [],
  };

  const runNumber = data.runs.length + 1;
  const comparison = data.groundTruth
    ? compareRuns(data.groundTruth, aiResult)
    : null;

  data.runs.push({
    runNumber,
    timestamp: new Date().toISOString(),
    result: aiResult,
    comparison,
  });

  await writeFile(documentId, data);

  if (comparison) {
    console.log(
      `📊 Run #${runNumber} for "${documentId}" — confidence: ${(comparison.confidenceScore * 100).toFixed(1)}% (${comparison.label})`,
    );
  } else {
    console.log(
      `📝 Run #${runNumber} for "${documentId}" recorded (no ground truth set yet)`,
    );
  }

  return { runNumber, comparison };
}

/**
 * Get a summary of all runs for a document with their confidence scores.
 *
 * @param {string} documentId
 */
export async function getSummary(documentId) {
  const data = await readFile(documentId);
  if (!data) {
    console.log(`No test case found for "${documentId}"`);
    return null;
  }

  console.log(`\n📋 Summary for "${documentId}"`);
  console.log(`   Ground truth: ${data.groundTruth ? "✅ set" : "❌ not set"}`);
  console.log(`   Total runs: ${data.runs.length}`);

  for (const run of data.runs) {
    if (run.comparison) {
      const pct = (run.comparison.confidenceScore * 100).toFixed(1);
      console.log(
        `   Run #${run.runNumber} [${run.timestamp}] → ${pct}% — ${run.comparison.label}`,
      );
    } else {
      console.log(`   Run #${run.runNumber} [${run.timestamp}] → no comparison`);
    }
  }

  return data;
}

/**
 * List all document IDs that have test cases.
 */
export async function listDocuments() {
  await fs.mkdir(TEST_CASES_DIR, { recursive: true });
  const entries = await fs.readdir(TEST_CASES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
