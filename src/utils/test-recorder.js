/**
 * Persists each processed job to disk as JSON under  test/<documentId>.json.
 *
 * Subscribes to the processing event bus and accumulates per-job logs, cost
 * entries, and the final API response, then writes the file when the job
 * finishes (or produces a result). The live demo reads this folder for its
 * history, so it survives page refreshes AND demo restarts.
 *
 * No ground-truth / confidence scoring — just logs + cost + API response.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import bus from './processing-events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEST_DIR = path.resolve(__dirname, '../../test');

const records = new Map(); // documentId -> record (in-flight accumulation)
let started = false;

function safeName(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'job';
}

function getRecord(id, ev = {}) {
  let rec = records.get(id);
  if (!rec) {
    rec = {
      documentId: id,
      jobId: ev.jobId ?? null,
      source: ev.source ?? null,
      sourceUrl: ev.sourceUrl ?? null,
      engine: null,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      logs: [],
      costs: [],
      result: null,
      errorMessage: null,
    };
    records.set(id, rec);
  }
  return rec;
}

function save(rec) {
  try {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, `${safeName(rec.documentId)}.json`), JSON.stringify(rec, null, 2));
  } catch (err) {
    // Use process.stderr to avoid recursing through the patched console.
    process.stderr.write(`test-recorder write failed: ${err.message}\n`);
  }
}

/** Begin recording. Idempotent. */
export function startRecorder() {
  if (started) return;
  started = true;

  bus.on('event', (ev) => {
    if (!ev?.documentId) return;
    const rec = getRecord(ev.documentId, ev);
    switch (ev.type) {
      case 'job:start':
        rec.jobId = ev.jobId ?? rec.jobId;
        rec.source = ev.source ?? rec.source;
        rec.sourceUrl = ev.sourceUrl ?? rec.sourceUrl;
        break;
      case 'log':
        rec.logs.push({ ts: ev.ts, level: ev.level, message: ev.message });
        break;
      case 'cost':
        rec.costs.push({ label: ev.label, model: ev.model, inTokens: ev.inTokens, outTokens: ev.outTokens, cost: ev.cost });
        break;
      case 'result':
        rec.result = ev.response ?? null;
        rec.engine = ev.engine ?? rec.engine;
        save(rec); // persist as soon as we have the API response
        break;
      case 'job:done':
        rec.status = 'done';
        rec.finishedAt = new Date().toISOString();
        save(rec);
        records.delete(ev.documentId);
        break;
      case 'job:error':
        rec.status = 'error';
        rec.errorMessage = ev.message ?? null;
        rec.finishedAt = new Date().toISOString();
        save(rec);
        records.delete(ev.documentId);
        break;
      default:
        break;
    }
  });
}

/** Read all saved job files, oldest → newest. */
export async function listRecords() {
  let files;
  try {
    files = await fsp.readdir(TEST_DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(await fsp.readFile(path.join(TEST_DIR, f), 'utf-8')));
    } catch {
      /* skip unreadable/partial files */
    }
  }
  out.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  return out;
}

export default { startRecorder, listRecords, TEST_DIR };
