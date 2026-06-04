/**
 * Per-document log capture for the live dashboard.
 *
 * Uses AsyncLocalStorage to associate every console.log/console.error made
 * during email processing with the document being processed — so logs from
 * sub-services (content extractor, fixPdfOrientation, cloudinary, etc.) are
 * captured automatically without each service needing to import a logger.
 *
 * Each captured line is:
 *   1) written to the real terminal,
 *   2) emitted as a `log` SSE event for the live dashboard,
 *   3) buffered per-documentId so it can be persisted into data.json.
 */
import { AsyncLocalStorage } from "async_hooks";
import bus from "./processing-events.js";

const buffers = new Map();
const als = new AsyncLocalStorage();

let patched = false;

function format(args) {
  return args
    .map((a) =>
      typeof a === "string"
        ? a
        : a instanceof Error
          ? a.stack || a.message
          : (() => {
              try {
                return JSON.stringify(a);
              } catch {
                return String(a);
              }
            })()
    )
    .join(" ");
}

function patchConsoleOnce() {
  if (patched) return;
  patched = true;
  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  const tee = (level, orig) => (...args) => {
    orig(...args);
    const ctx = als.getStore();
    if (!ctx?.documentId) return;
    const entry = { ts: Date.now(), level, message: format(args) };
    if (!buffers.has(ctx.documentId)) buffers.set(ctx.documentId, []);
    buffers.get(ctx.documentId).push(entry);
    bus.emit("event", { type: "log", documentId: ctx.documentId, ...entry });
  };

  console.log = tee("info", origLog);
  console.error = tee("error", origErr);
  console.warn = tee("warn", origWarn);
}

export function runWithLogContext(documentId, fn) {
  patchConsoleOnce();
  return als.run({ documentId }, fn);
}

export function flushLogs(documentId) {
  const logs = buffers.get(documentId) || [];
  buffers.delete(documentId);
  return logs;
}

// Back-compat: createLogger just forwards to console.log; the patched console
// takes care of buffering/emitting via the ALS context.
export function createLogger() {
  return (message) => console.log(message);
}

export default { runWithLogContext, flushLogs, createLogger };
