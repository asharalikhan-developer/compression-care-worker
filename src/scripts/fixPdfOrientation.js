import fs from "fs";
import path from "path";
import { PDFDocument, degrees } from "pdf-lib";
import Tesseract from "tesseract.js";
import { pdf } from "pdf-to-img";
import sharp from "sharp";

const MIN_CONFIDENCE = 5.0;
const RETRY_SCALE = 7.0; // higher resolution for low-confidence retry

const PREPROCESS_PROFILES = [
  {
    name: "light-noise",
    median: 3,
    linearMultiply: 1.5,
    linearOffset: -40,
    sigma: 1.2,
    threshold: 140,
  },
  {
    name: "heavy-noise",
    median: 5,
    linearMultiply: 1.8,
    linearOffset: -60,
    sigma: 1.5,
    threshold: 140,
  },
  {
    name: "very-heavy-noise",
    median: 7,
    linearMultiply: 2.0,
    linearOffset: -70,
    sigma: 2.0,
    threshold: 130,
  },
  {
    name: "faded-scan",
    median: 5,
    linearMultiply: 2.2,
    linearOffset: -80,
    sigma: 1.0,
    threshold: 120,
  },
  {
    name: "high-contrast",
    median: 3,
    linearMultiply: 1.3,
    linearOffset: -20,
    sigma: 1.0,
    threshold: 160,
  },
];

async function preprocessImage(pngBuffer, profile) {
  return sharp(pngBuffer)
    .grayscale()
    .median(profile.median)
    .normalize()
    .linear(profile.linearMultiply, profile.linearOffset)
    .sharpen({ sigma: profile.sigma, m1: 1, m2: 3 })
    .threshold(profile.threshold)
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
}

async function runProfilesOnBuffer(rawBuffer, worker) {
  const results = await Promise.all(
    PREPROCESS_PROFILES.map(async (profile) => {
      try {
        const processed = await preprocessImage(rawBuffer, profile);
        const { data } = await worker.detect(processed);
        return {
          profile: profile.name,
          angle: data.orientation_degrees,
          confidence: data.orientation_confidence ?? 0,
        };
      } catch {
        return null;
      }
    })
  ).then((r) => r.filter(Boolean));

  if (results.length === 0) return null;

  const votes = {};
  for (const r of results) {
    votes[r.angle] = (votes[r.angle] ?? 0) + 1;
  }

  const majorityThreshold = Math.ceil(results.length / 2);

  const majorityAngle = Object.entries(votes)
    .filter(([, count]) => count >= majorityThreshold)
    .sort(([a], [b]) => {
      if (Number(a) === 0) return -1;
      if (Number(b) === 0) return 1;
      return 0;
    })
    .map(([angle]) => Number(angle))[0];

  if (majorityAngle === undefined) {
    return { angle: 0, confidence: 0, profile: "no-consensus", votes };
  }

  const best = results
    .filter((r) => r.angle === majorityAngle)
    .sort((a, b) => b.confidence - a.confidence)[0];

  return { ...best, votes };
}

// Renders a single page from a PDF at the given scale and returns its buffer.
async function renderSinglePage(inputPath, pageNumber, scale) {
  const imageStream = await pdf(inputPath, { scale, pages: pageNumber });
  for await (const buffer of imageStream) {
    return buffer;
  }
  return null;
}

async function fixPdfOrientation(inputPath, outputPath) {
  console.log(`🚀 Starting process for: ${inputPath}`);

  const flaggedPages = []; // pages that couldn't be resolved confidently

  try {
    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pdfLibPages = pdfDoc.getPages();

    const imageStream = await pdf(inputPath, { scale: 4.0 });
    const worker = await Tesseract.createWorker("osd", 0);

    console.log("🔍 Analyzing pages...");
    let pageIndex = 0;

    for await (const rawBuffer of imageStream) {
      const pageNumber = pageIndex + 1;
      console.log(`  Processing page ${pageNumber}...`);

      try {
        let result = await runProfilesOnBuffer(rawBuffer, worker);

        if (!result) {
          console.log(`    ➔ Could not detect orientation, skipping`);
          flaggedPages.push({ page: pageNumber, reason: "detection-failed", confidence: 0, angle: null });
          pageIndex++;
          continue;
        }

        console.log(
          `    ➔ Votes: ${JSON.stringify(result.votes)} | Winner: [${result.profile}] angle=${result.angle}° confidence=${result.confidence.toFixed(1)}`
        );

        // Low confidence — retry at higher resolution before giving up
        if (result.confidence < MIN_CONFIDENCE) {
          console.log(
            `    ➔ Low confidence (${result.confidence.toFixed(1)}), retrying at ${RETRY_SCALE}x resolution...`
          );

          const highResBuffer = await renderSinglePage(inputPath, pageNumber, RETRY_SCALE);

          if (highResBuffer) {
            const retryResult = await runProfilesOnBuffer(highResBuffer, worker);

            if (retryResult) {
              console.log(
                `    ➔ Retry votes: ${JSON.stringify(retryResult.votes)} | Winner: [${retryResult.profile}] angle=${retryResult.angle}° confidence=${retryResult.confidence.toFixed(1)}`
              );
              result = retryResult;
            }
          }
        }

        if (result.angle !== 0 && result.confidence >= MIN_CONFIDENCE) {
          const currentPage = pdfLibPages[pageIndex];
          const currentRotation = currentPage.getRotation().angle;
          const targetRotation = (currentRotation + result.angle) % 360;
          console.log(`    ➔ ✅ FIXING: ${currentRotation}° → ${targetRotation}°`);
          currentPage.setRotation(degrees(targetRotation));
        } else if (result.angle !== 0 && result.confidence < MIN_CONFIDENCE) {
          console.log(
            `    ➔ ⚠️  Still low confidence after retry (${result.confidence.toFixed(1)}), flagging for manual review`
          );
          flaggedPages.push({
            page: pageNumber,
            reason: "low-confidence-after-retry",
            confidence: result.confidence,
            angle: result.angle,
            votes: result.votes,
          });
        } else {
          console.log(`    ➔ Upright, no fix needed`);
        }
      } catch (err) {
        console.error(`    ➔ Error:`, err.message);
        flaggedPages.push({ page: pageNumber, reason: "error", error: err.message });
      }

      pageIndex++;
    }

    await worker.terminate();
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    console.log(`\n✅ Finished! Saved to: ${outputPath}`);

    // Write flagged pages report next to the output PDF
    if (flaggedPages.length > 0) {
      const reportPath = outputPath.replace(/\.pdf$/i, "_flagged.json");
      fs.writeFileSync(reportPath, JSON.stringify({ file: outputPath, flaggedPages }, null, 2));
      console.log(`⚠️  ${flaggedPages.length} page(s) need manual review → ${reportPath}`);
    } else {
      console.log(`✅ All pages resolved with high confidence — no manual review needed`);
    }
  } catch (error) {
    console.error("❌ Critical Error:", error);
  }
}

export default fixPdfOrientation;
