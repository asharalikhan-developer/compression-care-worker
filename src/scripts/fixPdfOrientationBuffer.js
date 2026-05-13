
import fixPdfOrientation from './fixPdfOrientation.js';
import fs from 'fs';
import path from 'path';

/**
 * Fixes orientation of a PDF buffer and returns the corrected buffer.
 * Writes to a temp file, processes, reads result, then deletes temp files.
 * @param {Buffer} pdfBuffer
 * @param {string} filename
 * @returns {Promise<Buffer>}
 */
async function fixPdfOrientationBuffer(pdfBuffer, filename = 'document.pdf') {
  const inputPath = path.join('/tmp', `input_${Date.now()}_${filename}`);
  const outputPath = path.join('/tmp', `output_${Date.now()}_${filename}`);
  try {
    fs.writeFileSync(inputPath, pdfBuffer);
    await fixPdfOrientation(inputPath, outputPath);
    const fixedBuffer = fs.readFileSync(outputPath);
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
    return fixedBuffer;
  } catch (err) {
    // Clean up temp files if error
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    throw err;
  }
}

export default fixPdfOrientationBuffer;