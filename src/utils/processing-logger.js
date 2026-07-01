/**
 * Per-document log capture for the live demo dashboard.
 *
 * Uses AsyncLocalStorage to tag every console.log/warn/error made while a job
 * is processing with that job's documentId — so logs from every sub-service
 * (content extractor, orientation fix, cloudinary, openai, cost) are captured
 * automatically, no per-service wiring required.
 *
 * Each captured line is (1) written to the real terminal and (2) emitted as a
 * `log` SSE event. We do NOT buffer/persist anything (no test-cases).
 */
import { AsyncLocalStorage } from 'async_hooks';
import bus from './processing-events.js';

const als = new AsyncLocalStorage();
let patched = false;

function format(args) {
  return args
    .map((a) =>
      typeof a === 'string'
        ? a
        : a instanceof Error
          ? a.stack || a.message
          : (() => {
              try { return JSON.stringify(a); }
              catch { return String(a); }
            })(),
    )
    .join(' ');
}

function patchConsoleOnce() {
  if (patched) return;
  patched = true;
  const orig = {
    info: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const tee = (level) => (...args) => {
    orig[level](...args);
    const ctx = als.getStore();
    if (!ctx?.documentId) return;
    bus.emit('event', {
      type: 'log',
      documentId: ctx.documentId,
      ts: Date.now(),
      level,
      message: format(args),
    });
  };

  console.log = tee('info');
  console.warn = tee('warn');
  console.error = tee('error');
}

/** Run `fn` with a documentId bound to the async context (enables log capture). */
export function runWithLogContext(documentId, fn) {
  patchConsoleOnce();
  return als.run({ documentId }, fn);
}

/**
 * Emit a structured (non-log) event tagged with the current job's documentId.
 * No-op if called outside a job context. Used for `cost` and `result` events.
 */
export function emitProcessingEvent(type, payload = {}) {
  const ctx = als.getStore();
  bus.emit('event', { type, documentId: ctx?.documentId ?? null, ts: Date.now(), ...payload });
}

export default { runWithLogContext, emitProcessingEvent };
