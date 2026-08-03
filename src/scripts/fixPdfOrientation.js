import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { PDFDocument, degrees } from "pdf-lib";
import { pdf } from "pdf-to-img";
import sharp from "sharp";
import ort from "onnxruntime-node";

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_PATH =
  process.env.PPLCNET_MODEL_PATH ||
  path.resolve(__dirname, "../../models/PP-LCNet_x1_0_doc_ori.onnx");

// pdf-to-img render scale. The model resizes to 256 short edge internally,
// so anything beyond ~2.0 (≈144 DPI) is wasted compute.
const RENDER_SCALE = 2.0;

// Below this margin (top-1 prob − runner-up prob), leave the page as-is.
// On confident pages margin ≈ 0.25; on blank/sparse pages margin ≈ 0.00.
const MIN_MARGIN_FOR_ROTATION = 0.15;

// ─── Model contract (from inference.yml — do not tune) ──────────────────────
const RESIZE_SHORT = 256;
const CROP_SIZE = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const LABELS = [0, 90, 180, 270];

// ────────────────────────────────────────────────────────────────────────────
// ONNX session singleton — load the model once for the lifetime of the
// process, instead of re-loading 6.5 MB from disk on every PDF. Inference is
// thread-safe so the same session can be used by concurrent jobs.
// ────────────────────────────────────────────────────────────────────────────
let _session = null;
let _inputName = null;
let _outputName = null;
let _loadPromise = null;

async function getSession() {
  if (_session) return { session: _session, inputName: _inputName, outputName: _outputName };
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    if (!fs.existsSync(MODEL_PATH)) {
      _loadPromise = null;
      throw new Error(
        `PP-LCNet ONNX model not found at ${MODEL_PATH}. ` +
        `Set PPLCNET_MODEL_PATH or place the file there.`,
      );
    }
    const t0 = Date.now();
    // logSeverityLevel 3 = ERROR: drops onnxruntime's benign WARNING noise
    // (e.g. "Removing initializer ... not used by any node") on session load.
    _session = await ort.InferenceSession.create(MODEL_PATH, { logSeverityLevel: 3 });
    _inputName = _session.inputNames[0];
    _outputName = _session.outputNames[0];
    console.log(`✅ PP-LCNet ONNX session loaded in ${Date.now() - t0}ms (singleton)`);
    return { session: _session, inputName: _inputName, outputName: _outputName };
  })();

  return _loadPromise;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function softmax(arr) {
  const m = Math.max(...arr);
  const exps = arr.map((v) => Math.exp(v - m));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

async function preprocess(pngBuffer) {
  const meta = await sharp(pngBuffer).metadata();
  const short = Math.min(meta.width, meta.height);
  const scale = RESIZE_SHORT / short;
  const newW = Math.round(meta.width * scale);
  const newH = Math.round(meta.height * scale);

  const { data, info } = await sharp(pngBuffer)
    .resize(newW, newH, { fit: "fill" })
    .extract({
      left: Math.floor((newW - CROP_SIZE) / 2),
      top: Math.floor((newH - CROP_SIZE) / 2),
      width: CROP_SIZE,
      height: CROP_SIZE,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`Expected 3 channels after preprocess, got ${info.channels}`);
  }

  const numPixels = CROP_SIZE * CROP_SIZE;
  const tensor = new Float32Array(3 * numPixels);
  for (let i = 0; i < numPixels; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    tensor[i] = (r - MEAN[0]) / STD[0];
    tensor[numPixels + i] = (g - MEAN[1]) / STD[1];
    tensor[2 * numPixels + i] = (b - MEAN[2]) / STD[2];
  }
  return new ort.Tensor("float32", tensor, [1, 3, CROP_SIZE, CROP_SIZE]);
}

async function detectOrientation(session, inputName, outputName, rawBuffer) {
  const tensor = await preprocess(rawBuffer);
  const out = await session.run({ [inputName]: tensor });
  const logits = Array.from(out[outputName].data);
  const probs = softmax(logits);

  let bestIdx = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[bestIdx]) bestIdx = i;
  }

  // The model outputs the CURRENT rotation of the page (CW from upright).
  // To fix the page we apply the COMPLEMENTARY CW rotation.
  const detectedAngle = LABELS[bestIdx];
  const fixAngle = (360 - detectedAngle) % 360;

  const confidence = probs[bestIdx];
  const runnerUp = Math.max(...probs.filter((_, i) => i !== bestIdx));
  const margin = confidence - runnerUp;

  return { detectedAngle, fixAngle, confidence, margin };
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────
async function fixPdfOrientation(inputPath, outputPath) {
  console.log(`🚀 Starting process for: ${inputPath}`);

  try {
    const { session, inputName, outputName } = await getSession();

    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pdfLibPages = pdfDoc.getPages();

    const imageStream = await pdf(inputPath, { scale: RENDER_SCALE });

    console.log("🔍 Analyzing pages...");
    let pageIndex = 0;

    for await (const rawBuffer of imageStream) {
      console.log(`  Processing page ${pageIndex + 1}...`);
      try {
        const { detectedAngle, fixAngle, confidence, margin } =
          await detectOrientation(session, inputName, outputName, rawBuffer);

        console.log(
          `    ➔ Page rotated ${detectedAngle}° → apply ${fixAngle}° ` +
          `(prob ${confidence.toFixed(3)}, margin ${margin.toFixed(3)})`,
        );

        if (fixAngle === 0) {
          console.log(`    ➔ Upright (Margin: ${margin.toFixed(3)})`);
        } else if (margin < MIN_MARGIN_FOR_ROTATION) {
          console.log(
            `    ➔ ⚠️ Detected ${fixAngle}° but margin ${margin.toFixed(3)} below threshold — leaving page as-is`,
          );
        } else {
          console.log(`    ➔ ✅ FIXING: Rotated ${fixAngle}° (Margin: ${margin.toFixed(3)})`);
          const currentPage = pdfLibPages[pageIndex];
          const currentRotation = currentPage.getRotation().angle;
          const targetRotation = (currentRotation + fixAngle) % 360;
          currentPage.setRotation(degrees(targetRotation));
        }
      } catch (err) {
        console.error(`    ➔ Error:`, err.message);
      }
      pageIndex++;
    }

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    console.log(`\n✅ Finished! Saved to: ${outputPath}`);
  } catch (error) {
    console.error("❌ Critical Error:", error);
  }
}

export default fixPdfOrientation;
