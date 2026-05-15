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

async function fixPdfOrientation(inputPath, outputPath) {
  console.log(`🚀 Starting process for: ${inputPath}`);

  try {
    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pdfLibPages = pdfDoc.getPages();

    // 1. Convert PDF → images at high scale (4× gives ~300 dpi for most docs)
    const imageStream = await pdf(inputPath, { scale: 2.0 });

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

        const detectedAngle = data.orientation_degrees;
        const confidence = data.orientation_confidence;

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