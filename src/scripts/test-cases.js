/**
 * CLI for managing test cases.
 *
 * Commands:
 *   node src/scripts/test-cases.js set-truth <documentId> <path-to-ground-truth.json>
 *   node src/scripts/test-cases.js summary   <documentId>
 *   node src/scripts/test-cases.js list
 */

import fs from "fs/promises";
import {
  setGroundTruth,
  promoteRunAsGroundTruth,
  getSummary,
  listDocuments,
} from "../utils/test-case-recorder.js";

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "set-truth": {
      const [documentId, jsonPath] = args;
      if (!documentId || !jsonPath) {
        console.error("Usage: test-cases.js set-truth <documentId> <path-to-ground-truth.json>");
        process.exit(1);
      }
      const raw = await fs.readFile(jsonPath, "utf-8");
      const groundTruth = JSON.parse(raw);
      await setGroundTruth(documentId, groundTruth);
      break;
    }

    case "summary": {
      const [documentId] = args;
      if (!documentId) {
        console.error("Usage: test-cases.js summary <documentId>");
        process.exit(1);
      }
      await getSummary(documentId);
      break;
    }

    case "promote": {
      const [documentId, runStr] = args;
      if (!documentId || !runStr) {
        console.error("Usage: test-cases.js promote <documentId> <runNumber>");
        process.exit(1);
      }
      await promoteRunAsGroundTruth(documentId, parseInt(runStr, 10));
      break;
    }

    case "list": {
      const docs = await listDocuments();
      if (!docs.length) {
        console.log("No test cases found.");
      } else {
        console.log("Test cases:");
        docs.forEach((d) => console.log(`  - ${d}`));
      }
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      console.log("Available commands: set-truth, promote, summary, list");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
