import fs from "fs";
import { PDFDocument, degrees } from "pdf-lib";
import Tesseract from "tesseract.js";
import { pdf } from "pdf-to-img";
import sharp from "sharp";

/**
 * Preprocess the raw PNG buffer so Tesseract gets a clean, high-res,
 * properly-tagged image instead of a 0-dpi mystery blob.
 */
async function preprocessImage(pngBuffer) {
  return sharp(pngBuffer)
    .grayscale() // remove colour noise
    .normalize() // stretch contrast
    .sharpen() // sharpen edges for glyph detection
    .withMetadata({ density: 300 }) // embed 300 dpi in the PNG header
    .png()
    .toBuffer();
}

/**
 * Heavier preprocessing used on the retry pass, tuned for NOISY, OVER-INKED
 * faxes (dark bold text, halftone dithering, ghosting). The problem here is the
 * opposite of faint text: strokes are already too heavy and smear into blobs,
 * which hides the glyph shapes Tesseract OSD relies on. So we do NOT darken
 * (no gamma) and do NOT merge strokes (no blur). Instead we strip the dither
 * speckle, then binarize at a LOW threshold so only the true-black ink survives
 * and the gray smear/ghosting drops out — thinning the letters back to readable
 * shapes.
 */
async function preprocessImageStrong(pngBuffer) {
  return sharp(pngBuffer)
    .grayscale() // collapse to a single channel
    .median(5) // strip halftone/dither speckle (the dominant fax noise)
    .normalize() // stretch contrast across the full range
    .threshold(140) // LOW threshold: keep only solid ink, drop gray smear/ghosting
    .withMetadata({ density: 300 }) // embed 300 dpi in the PNG header
    .png()
    .toBuffer();
}

async function fixPdfOrientation(inputPath, outputPath) {
  console.log(`🚀 Starting process for: ${inputPath}`);

  try {
    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pdfLibPages = pdfDoc.getPages();

    // 1. Convert PDF → images at high scale (4× gives ~300 dpi for most docs)
    const imageStream = await pdf(inputPath, { scale: 2.0 });

    // Scale used to re-render a page when the first orientation detection
    // comes back with low confidence. Lazily created on first retry.
    const RETRY_SCALE = 2.0;
    let highResDoc = null;

    // 2. Load Tesseract with Legacy engine (OEM 0) — required for detect()
    const worker = await Tesseract.createWorker("osd", 0);

    console.log("🔍 Analyzing pages...");
    let pageIndex = 0;

    for await (const rawBuffer of imageStream) {
      console.log(`  Processing page ${pageIndex + 1}...`);

      try {
        // Preprocess: grayscale + normalize + embed 300 dpi metadata
        const processedBuffer = await preprocessImage(rawBuffer);

        // Perform orientation detection on the processed buffer
        const { data } = await worker.detect(processedBuffer);

        let detectedAngle = data.orientation_degrees;
        let confidence = data.orientation_confidence;

        // If confidence is below 1, re-render just this page at a higher scale
        // and run preprocessing + detection again, then use the retry's result.
        if (confidence < 1 || detectedAngle !== 0) {
          console.log(
            `    ➔ ⚠️ Low confidence (${confidence.toFixed(1)}), retrying page at scale ${RETRY_SCALE}...`,
          );
          try {
            if (!highResDoc) {
              highResDoc = await pdf(inputPath, { scale: RETRY_SCALE });
            }
            // getPage is 1-indexed
            const retryRawBuffer = await highResDoc.getPage(pageIndex + 1);
            const retryProcessedBuffer = await preprocessImageStrong(retryRawBuffer);
            const { data: retryData } = await worker.detect(retryProcessedBuffer);

            detectedAngle = retryData.orientation_degrees;
            confidence = retryData.orientation_confidence;
            console.log(
              `    ➔ Retry result: ${detectedAngle}° (Confidence: ${confidence.toFixed(1)})`,
            );
          } catch (retryErr) {
            console.error(`    ➔ Retry error:`, retryErr.message);
          }
        }

        if (detectedAngle !== 0) {
          console.log(
            `    ➔ ✅ FIXING: Rotated ${detectedAngle}° (Confidence: ${confidence.toFixed(1)})`,
          );
          const currentPage = pdfLibPages[pageIndex];
          const currentRotation = currentPage.getRotation().angle;
          console.log("currentRotation",currentRotation);
          
          const targetRotation =
            (currentRotation + detectedAngle) % 360;
            console.log("targetRotation",targetRotation);
          currentPage.setRotation(degrees(targetRotation));
        } else {
          console.log(`    ➔ Upright (Confidence: ${confidence.toFixed(1)})`);
        }
      } catch (err) {
        console.error(`    ➔ Error:`, err.message);
      }
      pageIndex++;
    }

    await worker.terminate();
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    console.log(`\n✅ Finished! Saved to: ${outputPath}`);
  } catch (error) {
    console.error("❌ Critical Error:", error);
  }
}

export default  fixPdfOrientation ;