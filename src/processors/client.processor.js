import unzipper from 'unzipper';

import openaiClientService from '../services/openai-client.service.js';
import contentExtractorService from '../services/content-extractor.service.js';
import cloudinaryService from '../services/cloudinary.service.js';
import fixPdfOrientationBuffer from '../scripts/fixPdfOrientationBuffer.js';

const STAGES = {
  DOWNLOAD: 'download',
  DETECT: 'detect',
  UNZIP: 'unzip',
  PREPROCESS: 'preprocess',
  CLOUDINARY: 'cloudinary',
  OPENAI: 'openai',
  MONGO: 'mongo',
};

const MAX_ATTEMPTS = parseInt(process.env.MAX_WORKER_ATTEMPTS) || 3;
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 60_000;

class PipelineError extends Error {
  constructor(message, { stage, code, permanent = false, cause } = {}) {
    super(message);
    this.name = 'PipelineError';
    this.stage = stage || 'unknown';
    this.code = code || 'PIPELINE_ERROR';
    this.permanent = permanent;
    this.cause = cause;
  }
}

async function withStage(stage, code, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PipelineError) throw err;
    throw new PipelineError(err.message, { stage, code, cause: err });
  }
}

async function init() {
  openaiClientService.initialize();
  cloudinaryService.initialize();
}

function filenameFromUrl(url, fallback = 'document.pdf') {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split('/').pop() || fallback;
    return base.split('?')[0] || fallback;
  } catch {
    return fallback;
  }
}

function isZipBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  return buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}

function isPdfBuffer(buf) {
  if (!buf || buf.length < 5) return false;
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
}

async function downloadBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url} (${res.status} ${res.statusText})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function extractPdfsFromZip(zipBuffer) {
  const directory = await unzipper.Open.buffer(zipBuffer);
  const pdfs = [];
  for (const file of directory.files) {
    if (file.type !== 'File') continue;
    const name = file.path || '';
    if (!name.toLowerCase().endsWith('.pdf')) continue;
    if (name.startsWith('__MACOSX/') || name.split('/').pop().startsWith('.')) continue;
    const buf = await file.buffer();
    pdfs.push({ filename: name.split('/').pop(), buffer: buf });
  }
  return pdfs;
}

async function preprocessPdf(buffer, filename) {
  const text = await contentExtractorService.extractFromPdf(buffer);
  if (!text || text.trim().length === 0) {
    console.log(`    📸 Scanned PDF (${filename}) — fixing orientation`);
    try {
      return await fixPdfOrientationBuffer(buffer, filename);
    } catch (err) {
      console.error(`    ⚠️ Orientation fix failed for ${filename}, uploading original:`, err.message);
      return buffer;
    }
  }
  console.log(`    ✅ Digital PDF (${filename}) — ${text.length} chars, uploading as-is`);
  return buffer;
}

async function cleanupAssets(uploadedAssets) {
  if (!uploadedAssets.length) return;
  console.log(`  🧹 Cleaning up ${uploadedAssets.length} Cloudinary asset(s)...`);
  for (const asset of uploadedAssets) {
    try {
      await cloudinaryService.deleteFile(asset.publicId);
    } catch (err) {
      console.warn(`    ⚠️ Cleanup failed for ${asset.publicId}:`, err?.message || err);
    }
  }
}

function classifyError(err) {
  if (err instanceof PipelineError) {
    return { stage: err.stage, code: err.code, message: err.message, permanent: err.permanent };
  }
  return { stage: 'unknown', code: 'UNHANDLED_ERROR', message: err?.message || String(err), permanent: false };
}

async function handle(job, deps) {
  const attemptNumber = job.data._workerAttempt || 1;
  const { uniqueId, pdfUrls } = job.data || {};

  if (!uniqueId) {
    throw new PipelineError('Client job missing uniqueId', {
      stage: STAGES.DETECT, code: 'BAD_INPUT', permanent: true,
    });
  }
  if (!Array.isArray(pdfUrls) || pdfUrls.length === 0) {
    throw new PipelineError('Client job missing pdfUrls', {
      stage: STAGES.DETECT, code: 'BAD_INPUT', permanent: true,
    });
  }

  const sourceUrl = pdfUrls[0];
  console.log(`\n📄 Client document — uniqueId: ${uniqueId} (attempt ${attemptNumber}/${MAX_ATTEMPTS})`);
  console.log(`   🔗 source: ${sourceUrl}`);

  const uploadedAssets = [];

  try {
    console.log('  ⬇️  Downloading source...');
    const t0 = Date.now();
    const buf = await withStage(STAGES.DOWNLOAD, 'DOWNLOAD_FAILED', () => downloadBuffer(sourceUrl));
    console.log(`  ⏱️ Download: ${Date.now() - t0}ms (${buf.length} bytes)`);

    let pdfs;
    if (isZipBuffer(buf)) {
      console.log('  🗜️  ZIP detected — extracting PDFs...');
      pdfs = await withStage(STAGES.UNZIP, 'UNZIP_FAILED', () => extractPdfsFromZip(buf));
      if (pdfs.length === 0) {
        throw new PipelineError('ZIP contained no PDF files', {
          stage: STAGES.UNZIP, code: 'EMPTY_ZIP', permanent: true,
        });
      }
      console.log(`  📦 Found ${pdfs.length} PDF(s) in ZIP: ${pdfs.map((p) => p.filename).join(', ')}`);
    } else if (isPdfBuffer(buf)) {
      pdfs = [{ filename: filenameFromUrl(sourceUrl), buffer: buf }];
    } else {
      throw new PipelineError('Source URL did not return a PDF or ZIP file', {
        stage: STAGES.DETECT, code: 'UNSUPPORTED_FORMAT', permanent: true,
      });
    }

    console.log(`  🔧 Preprocessing ${pdfs.length} PDF(s) sequentially...`);
    const tPrep = Date.now();
    for (const pdf of pdfs) {
      const uploadBuffer = await withStage(
        STAGES.PREPROCESS, 'PREPROCESS_FAILED',
        () => preprocessPdf(pdf.buffer, pdf.filename),
      );
      const { url, publicId } = await withStage(
        STAGES.CLOUDINARY, 'CLOUDINARY_UPLOAD_FAILED',
        () => cloudinaryService.uploadPdfWithMeta(uploadBuffer, pdf.filename),
      );
      uploadedAssets.push({ url, publicId });
    }
    console.log(`  ⏱️ Preprocess + upload: ${Date.now() - tPrep}ms`);
    uploadedAssets.forEach((a) => console.log(`   ☁️  ${a.url}`));

    const cloudinaryUrls = uploadedAssets.map((a) => a.url);
    console.log(`  🤖 Analyzing ${cloudinaryUrls.length} PDF(s) with OpenAI (gpt-5 Response API)...`);
    const tAI = Date.now();
    const patientResult = await withStage(
      STAGES.OPENAI, 'OPENAI_ERROR',
      () => openaiClientService.extractPatientFromPdfUrls(cloudinaryUrls),
    );
    console.log(`  ⏱️ Extraction: ${Date.now() - tAI}ms`);

    if (!patientResult?.patient) {
      throw new PipelineError('OpenAI returned no patient object', {
        stage: STAGES.OPENAI, code: 'NO_PATIENT_RETURNED', permanent: true,
      });
    }

    patientResult.patient.file_url = cloudinaryUrls;
    if (typeof patientResult.patient.confidence_score === 'number') {
      console.log(`  🧠 AI self-rated confidence: ${patientResult.patient.confidence_score}/100`);
    }

    const updateRes = await withStage(
      STAGES.MONGO, 'MONGO_UPDATE_FAILED',
      () => deps.collection.updateOne(
        { uniqueId },
        {
          $set: {
            result: patientResult,
            status: 'processed',
            processedAt: new Date().toISOString(),
            attemptsMade: attemptNumber,
            error: null,
          },
        },
      ),
    );

    if (updateRes.matchedCount === 0) {
      throw new PipelineError(`No document found for uniqueId=${uniqueId}`, {
        stage: STAGES.MONGO, code: 'DOC_NOT_FOUND', permanent: true,
      });
    }

    console.log(`  💾 Updated documents.{uniqueId: ${uniqueId}} → status: processed`);
    return { uniqueId, status: 'processed', attemptsMade: attemptNumber };
  } catch (err) {
    await cleanupAssets(uploadedAssets);
    throw err;
  }
}

async function onCompleted(job) {
  try {
    await job.remove();
    console.log(`🗑️  Removed Job ${job.id} from Redis`);
  } catch (err) {
    console.warn(`⚠️ Cleanup error for Job ${job.id}:`, err?.message || err);
  }
}

async function onFailed(job, err, deps) {
  const attemptNumber = job?.data?._workerAttempt || 1;
  const info = classifyError(err);
  const canRetry = !info.permanent && attemptNumber < MAX_ATTEMPTS;

  console.error(
    `   ↳ stage=${info.stage} code=${info.code} permanent=${info.permanent} attempt=${attemptNumber}/${MAX_ATTEMPTS}`,
  );

  if (canRetry && deps?.queue) {
    const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (attemptNumber - 1), BACKOFF_MAX_MS);
    try {
      await deps.queue.add(
        job.name,
        { ...job.data, _workerAttempt: attemptNumber + 1 },
        { delay: backoffMs },
      );
      console.log(`🔁 Re-enqueued uniqueId=${job.data?.uniqueId} (attempt ${attemptNumber + 1}/${MAX_ATTEMPTS}) in ${backoffMs}ms`);
    } catch (reEnqErr) {
      console.error('❌ Re-enqueue failed:', reEnqErr?.message || reEnqErr);
    }
    try {
      await job?.remove();
    } catch {}
    return;
  }

  const uniqueId = job?.data?.uniqueId;
  if (uniqueId && deps?.collection) {
    try {
      await deps.collection.updateOne(
        { uniqueId },
        {
          $set: {
            status: 'failed',
            failedAt: new Date().toISOString(),
            attemptsMade: attemptNumber,
            error: {
              message: info.message,
              stage: info.stage,
              code: info.code,
            },
          },
        },
      );
      console.log(`💾 Acknowledged failure: documents.{uniqueId: ${uniqueId}} → status: failed`);
    } catch (mongoErr) {
      console.error('❌ Failure acknowledgement write failed:', mongoErr?.message || mongoErr);
    }
  }

  try {
    await job?.remove();
    console.log(`🗑️  Removed failed Job ${job?.id} from Redis`);
  } catch (cleanupErr) {
    console.warn(`⚠️ Cleanup error for failed Job ${job?.id}:`, cleanupErr?.message || cleanupErr);
  }
}

export default {
  source: 'client',
  jobName: 'client-document',
  init,
  handle,
  onCompleted,
  onFailed,
};
