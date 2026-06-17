import unzipper from 'unzipper';

import openaiClientService from '../services/openai-client.service.js';
import contentExtractorService from '../services/content-extractor.service.js';
import cloudinaryService from '../services/cloudinary.service.js';
import fixPdfOrientationBuffer from '../scripts/fixPdfOrientationBuffer.js';

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

async function preprocessAndUpload(buffer, filename) {
  const text = await contentExtractorService.extractFromPdf(buffer);

  let uploadBuffer = buffer;
  if (!text || text.trim().length === 0) {
    console.log(`    📸 Scanned PDF (${filename}) — fixing orientation`);
    try {
      uploadBuffer = await fixPdfOrientationBuffer(buffer, filename);
    } catch (err) {
      console.error(`    ⚠️ Orientation fix failed for ${filename}, uploading original:`, err.message);
      uploadBuffer = buffer;
    }
  } else {
    console.log(`    ✅ Digital PDF (${filename}) — ${text.length} chars, uploading as-is`);
  }

  return cloudinaryService.uploadPdf(uploadBuffer, filename);
}

async function resolvePdfs(sourceUrl) {
  const baseName = filenameFromUrl(sourceUrl, 'document.pdf');
  console.log('  ⬇️  Downloading source...');
  const t0 = Date.now();
  const buf = await downloadBuffer(sourceUrl);
  console.log(`  ⏱️ Download: ${Date.now() - t0}ms (${buf.length} bytes)`);

  if (isZipBuffer(buf)) {
    console.log('  🗜️  ZIP detected — extracting PDFs...');
    const pdfs = await extractPdfsFromZip(buf);
    if (pdfs.length === 0) throw new Error('ZIP contained no PDF files');
    console.log(`  📦 Found ${pdfs.length} PDF(s) in ZIP: ${pdfs.map((p) => p.filename).join(', ')}`);
    return pdfs;
  }

  if (isPdfBuffer(buf)) {
    return [{ filename: baseName, buffer: buf }];
  }

  throw new Error('Source URL did not return a PDF or ZIP file');
}

async function handle(job, deps) {
  const { uniqueId, pdfUrls } = job.data || {};

  if (!uniqueId) throw new Error('Client job missing uniqueId');
  if (!Array.isArray(pdfUrls) || pdfUrls.length === 0) {
    throw new Error('Client job missing pdfUrls');
  }

  const sourceUrl = pdfUrls[0];
  console.log(`\n📄 Client document — uniqueId: ${uniqueId}`);
  console.log(`   🔗 source: ${sourceUrl}`);

  const pdfs = await resolvePdfs(sourceUrl);

  console.log(`  🔧 Preprocessing ${pdfs.length} PDF(s) sequentially...`);
  const tPrep = Date.now();
  const cloudinaryUrls = [];
  for (const pdf of pdfs) {
    const url = await preprocessAndUpload(pdf.buffer, pdf.filename);
    cloudinaryUrls.push(url);
  }
  console.log(`  ⏱️ Preprocess + upload: ${Date.now() - tPrep}ms`);
  cloudinaryUrls.forEach((u) => console.log(`   ☁️  ${u}`));

  console.log(`  🤖 Analyzing ${cloudinaryUrls.length} PDF(s) with OpenAI (gpt-5 Response API)...`);
  const tAI = Date.now();
  const patientResult = await openaiClientService.extractPatientFromPdfUrls(cloudinaryUrls);
  console.log(`  ⏱️ Extraction: ${Date.now() - tAI}ms`);

  if (!patientResult?.patient) {
    throw new Error('OpenAI returned no patient object');
  }

  patientResult.patient.file_url = cloudinaryUrls;
  if (typeof patientResult.patient.confidence_score === 'number') {
    console.log(`  🧠 AI self-rated confidence: ${patientResult.patient.confidence_score}/100`);
  }

  const updateRes = await deps.collection.updateOne(
    { uniqueId },
    {
      $set: {
        result: patientResult,
        status: 'processed',
        processedAt: new Date().toISOString(),
      },
    },
  );

  if (updateRes.matchedCount === 0) {
    throw new Error(`No document found for uniqueId=${uniqueId}`);
  }

  console.log(`  💾 Updated documents.{uniqueId: ${uniqueId}} → status: processed`);
  return { uniqueId, status: 'processed' };
}

async function onCompleted(job) {
  try {
    await job.remove();
    console.log(`🗑️  Removed Job ${job.id} from Redis`);
  } catch (err) {
    console.warn(`⚠️ Cleanup error for Job ${job.id}:`, err?.message || err);
  }
}

async function onFailed(job, _err) {
  try {
    await job?.remove();
    console.log(`🗑️  Removed failed Job ${job?.id} from Redis`);
  } catch (err) {
    console.warn(`⚠️ Cleanup error for failed Job ${job?.id}:`, err?.message || err);
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
