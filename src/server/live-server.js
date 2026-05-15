/**
 * Live demo server.
 * Serves the dashboard at http://localhost:3030
 * Streams processing events to the browser via Server-Sent Events.
 *
 * Start alongside the worker:  npm run demo
 */

import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import bus from "../utils/processing-events.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_CASES_DIR = path.resolve(__dirname, "../../test-cases");
const PORT = process.env.LIVE_PORT || 3030;

const app = express();

// ── SSE endpoint — browser connects here for a specific document ────────────
app.get("/events/:documentId", (req, res) => {
  const { documentId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const handler = (event) => {
    if (event.documentId === documentId) send(event);
  };

  bus.on("event", handler);
  req.on("close", () => bus.off("event", handler));
});

// ── test-case data endpoint ─────────────────────────────────────────────────
app.get("/data/:documentId", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  try {
    const raw = await fs.readFile(
      path.join(TEST_CASES_DIR, req.params.documentId, "data.json"),
      "utf-8",
    );
    res.json(JSON.parse(raw));
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});

// ── list documents ──────────────────────────────────────────────────────────
app.get("/documents", async (req, res) => {
  try {
    const entries = await fs.readdir(TEST_CASES_DIR, { withFileTypes: true });
    const docs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    res.json(docs);
  } catch {
    res.json([]);
  }
});

// ── serve the live dashboard HTML ───────────────────────────────────────────
app.get("/", (req, res) => res.send(dashboardHTML()));
app.get("/live/:documentId", (req, res) => res.send(livePageHTML(req.params.documentId)));

app.listen(PORT, () => {
  console.log(`\n🚀 Live demo server running at http://localhost:${PORT}\n`);
});

// ── HTML pages ───────────────────────────────────────────────────────────────

function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Compression Care — Live Demo</title>
  <style>
    ${commonCSS()}
    .doc-list { display: flex; flex-direction: column; gap: 12px; margin-top: 24px; }
    .doc-card {
      background: white; border: 1px solid #e5e7eb; border-radius: 12px;
      padding: 18px 24px; display: flex; align-items: center; justify-content: space-between;
      text-decoration: none; color: inherit; transition: box-shadow 0.15s, border-color 0.15s;
    }
    .doc-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); border-color: #3b82f6; }
    .doc-id { font-family: monospace; font-size: 14px; font-weight: 600; }
    .doc-hint { font-size: 12px; color: #9ca3af; margin-top: 3px; }
    .live-btn {
      background: #3b82f6; color: white; border: none; border-radius: 8px;
      padding: 8px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
      text-decoration: none;
    }
    .empty { color: #9ca3af; text-align: center; padding: 48px; font-size: 15px; }
    .header-sub { font-size: 14px; opacity: 0.8; margin-top: 6px; }
  </style>
</head>
<body>
<div class="page-header">
  <h1>Compression Care — Live Demo</h1>
  <div class="header-sub">Select a document to watch it process in real-time</div>
</div>
<div class="container">
  <div id="list"><div class="empty">Loading documents…</div></div>
</div>
<script>
  fetch('/documents').then(r => r.json()).then(docs => {
    const el = document.getElementById('list');
    if (!docs.length) { el.innerHTML = '<div class="empty">No test cases found. Parse an email first.</div>'; return; }
    el.innerHTML = '<div class="doc-list">' + docs.map(id => \`
      <a class="doc-card" href="/live/\${id}">
        <div>
          <div class="doc-id">\${id}</div>
          <div class="doc-hint">Click to open live processing view</div>
        </div>
        <span class="live-btn">▶ Live View</span>
      </a>
    \`).join('') + '</div>';
  });
</script>
</body>
</html>`;
}

function livePageHTML(documentId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Live — ${documentId}</title>
  <style>
    ${commonCSS()}

    /* ── pipeline ── */
    .pipeline { display: flex; flex-direction: column; gap: 6px; }
    .step {
      display: flex; align-items: flex-start; gap: 16px;
      background: white; border: 1px solid #e5e7eb; border-radius: 12px;
      padding: 16px 20px; opacity: 0.35; transition: opacity 0.4s, border-color 0.4s, box-shadow 0.4s;
      position: relative;
    }
    .step.active {
      opacity: 1; border-color: #3b82f6; box-shadow: 0 0 0 3px #bfdbfe;
    }
    .step.done { opacity: 1; border-color: #d1fae5; }
    .step.skipped { opacity: 0.45; }
    .step.error { opacity: 1; border-color: #fecaca; background: #fff5f5; }
    .step-icon { font-size: 22px; flex-shrink: 0; }
    .step-body { flex: 1; }
    .step-title { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
    .step-detail { font-size: 13px; color: #6b7280; line-height: 1.5; min-height: 18px; }
    .step-badge {
      font-size: 11px; font-weight: 700; padding: 3px 10px;
      border-radius: 999px; flex-shrink: 0; transition: all 0.3s;
    }
    .badge-waiting  { background:#f3f4f6; color:#9ca3af; }
    .badge-active   { background:#dbeafe; color:#1d4ed8; animation: pulse 1s infinite; }
    .badge-done     { background:#d1fae5; color:#065f46; }
    .badge-skipped  { background:#f3f4f6; color:#9ca3af; }
    .badge-error    { background:#fee2e2; color:#b91c1c; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }

    /* ── spinner ── */
    .spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid #bfdbfe; border-top-color: #3b82f6;
      border-radius: 50%; animation: spin 0.7s linear infinite;
      vertical-align: middle; margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── url link ── */
    .url-link {
      display: inline-block; background: #eff6ff; color: #1d4ed8;
      border: 1px solid #bfdbfe; border-radius: 6px; padding: 3px 10px;
      font-family: monospace; font-size: 12px; text-decoration: none;
      word-break: break-all; margin-top: 4px;
    }
    .url-link:hover { background: #dbeafe; }
    .file-badge {
      display: inline-block; background: #f0fdf4; color: #166534;
      border: 1px solid #bbf7d0; border-radius: 6px; padding: 2px 8px;
      font-size: 12px; margin-right: 4px; margin-top: 4px;
    }

    /* ── confidence section ── */
    .confidence-section {
      background: white; border: 1px solid #e5e7eb; border-radius: 12px;
      padding: 28px; text-align: center; display: none;
      animation: fadeIn 0.5s ease;
    }
    .confidence-section.visible { display: block; }
    @keyframes fadeIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }

    .gauge-wrap { display: inline-block; position: relative; width: 260px; }
    .gauge-svg { width: 100%; }
    .gauge-score {
      font-size: 42px; font-weight: 900; letter-spacing: -2px; margin-top: 4px;
    }
    .gauge-label { font-size: 15px; color: #6b7280; margin-top: 4px; }

    /* ── field table ── */
    .breakdown-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 20px; }
    .breakdown-table th {
      text-align: left; padding: 8px 12px; background: #f9fafb;
      border-bottom: 2px solid #e5e7eb; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280;
    }
    .breakdown-table td { padding: 7px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
    .breakdown-table tr.diff td:first-child { color: #b45309; font-weight: 600; }
    .breakdown-table tr.diff { background: #fffbeb; }
    .breakdown-table tr.group-header td { background: #f9fafb; font-weight: 700; font-size: 12px; padding: 6px 12px; }
    .bar-wrap { display: inline-block; width: 80px; height: 6px; background: #e5e7eb; border-radius: 3px; vertical-align: middle; margin-right: 6px; }
    .bar { height: 6px; border-radius: 3px; }
    .score-num { font-size: 12px; font-weight: 600; vertical-align: middle; }
    .null { color:#d1d5db; font-style:italic; font-size:12px; }

    /* ── extracted data card ── */
    .data-card {
      background: white; border: 1px solid #e5e7eb; border-radius: 12px;
      padding: 24px; display: none;
    }
    .data-card.visible { display: block; animation: fadeIn 0.5s ease; }
    .data-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 14px; margin-top: 16px;
    }
    .data-field .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #9ca3af; margin-bottom: 3px; }
    .data-field .value { font-size: 14px; font-weight: 500; word-break: break-word; }
    .value.null { color: #d1d5db; font-style: italic; }

    /* ── warnings ── */
    .warnings { background:#fffbeb; border:1px solid #fcd34d; border-radius:8px; padding:12px 16px; margin-top:16px; }
    .warnings-title { font-size:13px; font-weight:600; color:#92400e; margin-bottom:6px; }
    .warnings ul { padding-left:18px; }
    .warnings li { font-size:13px; color:#78350f; margin-bottom:3px; }

    /* ── back link ── */
    .back { display: inline-flex; align-items: center; gap: 6px; color: #6b7280; font-size: 13px; text-decoration: none; margin-bottom: 20px; }
    .back:hover { color: #1f2937; }
    code { font-family: monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }

    /* ── run selector ── */
    .run-selector { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
    .run-btn {
      padding: 6px 14px; border-radius: 8px; border: 1px solid #e5e7eb;
      background: white; font-size: 13px; font-weight: 500; cursor: pointer;
      transition: all 0.15s;
    }
    .run-btn:hover { border-color: #3b82f6; color: #3b82f6; }
    .run-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }
    .live-indicator {
      display: inline-flex; align-items: center; gap: 6px;
      background: #d1fae5; color: #065f46; border-radius: 999px;
      padding: 4px 12px; font-size: 12px; font-weight: 600;
    }
    .live-dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; animation: pulse 1s infinite; }
    .waiting-overlay {
      text-align: center; padding: 48px; color: #9ca3af; font-size: 15px;
    }
  </style>
</head>
<body>

<div class="page-header">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
    <div>
      <h1>Live Processing View</h1>
      <div style="font-size:13px;opacity:0.75;margin-top:4px;font-family:monospace">${documentId}</div>
    </div>
    <div class="live-indicator"><div class="live-dot"></div> LIVE</div>
  </div>
</div>

<div class="container">
  <a href="/" class="back">← All Documents</a>

  <!-- Run selector -->
  <div style="margin-bottom:20px">
    <div style="font-size:13px;color:#6b7280;margin-bottom:10px">Previous runs — click to review, or parse the email again to see a new run live</div>
    <div class="run-selector" id="runSelector"></div>
  </div>

  <!-- Two-column layout -->
  <div style="display:grid;grid-template-columns:340px 1fr;gap:24px;align-items:start">

    <!-- Pipeline -->
    <div>
      <div class="section-title">Processing Pipeline</div>
      <div class="pipeline" id="pipeline">
        ${pipelineStepsHTML()}
      </div>
    </div>

    <!-- Right side: waiting / extracted data / confidence -->
    <div>
      <div id="waitingMsg" class="waiting-overlay">
        <div style="font-size:32px;margin-bottom:12px">⏳</div>
        Parse the email to see live results here
      </div>

      <div id="dataCard" class="data-card">
        <div class="section-title">Extracted Data</div>
        <div id="dataGrid"></div>
      </div>

      <div id="confidenceSection" class="confidence-section" style="margin-top:20px">
        <div class="section-title" style="text-align:left">Confidence vs Ground Truth</div>
        <div style="display:flex;gap:32px;align-items:flex-start;flex-wrap:wrap">
          <div class="gauge-wrap">
            <svg id="gaugeSvg" viewBox="0 0 220 120" class="gauge-svg">
              <path d="M 30 100 A 80 80 0 0 1 190 100" fill="none" stroke="#e5e7eb" stroke-width="16" stroke-linecap="round"/>
              <path id="gaugeArc" d="M 30 100 A 80 80 0 0 1 190 100" fill="none" stroke="#10b981"
                stroke-width="16" stroke-linecap="round" stroke-dasharray="0 251.2" style="transition:stroke-dasharray 1s ease"/>
              <line id="gaugeNeedle" x1="110" y1="100" x2="30" y2="100"
                stroke="#1f2937" stroke-width="3" stroke-linecap="round" style="transform-origin:110px 100px;transition:transform 1s ease"/>
              <circle cx="110" cy="100" r="5" fill="#1f2937"/>
              <text x="24" y="118" font-size="10" fill="#9ca3af">0%</text>
              <text x="100" y="18" font-size="10" fill="#9ca3af" text-anchor="middle">50%</text>
              <text x="186" y="118" font-size="10" fill="#9ca3af">100%</text>
            </svg>
            <div id="gaugeScore" class="gauge-score">—</div>
            <div id="gaugeLabel" class="gauge-label">Waiting…</div>
          </div>
          <div style="flex:1;min-width:0;overflow-x:auto">
            <div id="breakdownTable"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
const DOC_ID = '${documentId}';
let currentRunData = null;

// ── step state management ──────────────────────────────────────────────────
const steps = {
  email_received:      document.getElementById('step-email'),
  extracting:          document.getElementById('step-extract'),
  orientation:         document.getElementById('step-orient'),
  cloudinary:          document.getElementById('step-cloud'),
  openai:              document.getElementById('step-openai'),
  complete:            document.getElementById('step-complete'),
};

function setStep(id, status, detail) {
  const el = steps[id];
  if (!el) return;
  el.className = 'step ' + status;
  const badge = el.querySelector('.step-badge');
  const detailEl = el.querySelector('.step-detail');
  badge.className = 'step-badge badge-' + status;
  const labels = { waiting:'Waiting', active:'Processing…', done:'Done', skipped:'Skipped', error:'Error' };
  badge.innerHTML = status === 'active'
    ? '<span class="spinner"></span>' + (labels[status] || status)
    : (labels[status] || status);
  if (detail !== undefined) detailEl.innerHTML = detail;
}

function resetPipeline() {
  Object.keys(steps).forEach(id => setStep(id, 'waiting', ''));
  document.getElementById('dataCard').classList.remove('visible');
  document.getElementById('confidenceSection').classList.remove('visible');
  document.getElementById('waitingMsg').style.display = 'block';
  // Clear run selector — a fresh live run is starting
  document.querySelectorAll('.run-btn').forEach(b => b.classList.remove('active'));
}

// ── SSE ───────────────────────────────────────────────────────────────────
function connectSSE() {
  const es = new EventSource('/events/' + DOC_ID);
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    handleEvent(ev);
  };
  es.onerror = () => {
    es.close();
    // Reconnect after 3 seconds — handles dropped connections during long OpenAI calls
    setTimeout(connectSSE, 3000);
  };
}

function handleEvent(ev) {
  document.getElementById('waitingMsg').style.display = 'none';

  switch (ev.type) {
    case 'email_received':
      resetPipeline();
      // Show "New run in progress" label in the selector area
      const liveTag = document.createElement('div');
      liveTag.id = 'liveRunTag';
      liveTag.innerHTML = '<span class="live-indicator"><div class="live-dot"></div> New run in progress…</span>';
      const sel = document.getElementById('runSelector');
      document.getElementById('liveRunTag')?.remove();
      sel.prepend(liveTag);
      setStep('email_received', 'done',
        \`From: <strong>\${ev.from || '—'}</strong><br>Subject: \${ev.subject || '—'}\`);
      setStep('extracting', 'active', 'Reading attachments…');
      break;

    case 'extracting':
      setStep('extracting', 'active', 'Extracting text from attachments…');
      break;

    case 'extracted': {
      const parts = [];
      if (ev.attachments?.length) parts.push(ev.attachments.map(f => \`<span class="file-badge">📎 \${f}</span>\`).join(''));
      if (ev.images?.length)      parts.push(ev.images.map(f => \`<span class="file-badge">🖼 \${f}</span>\`).join(''));
      setStep('extracting', 'done', parts.join(' ') || 'Content extracted');

      if (ev.faxCount > 0) {
        setStep('orientation', 'active', 'Scanned PDF detected — checking rotation…');
      } else {
        setStep('orientation', 'skipped', 'No scanned PDF — skipped');
        setStep('cloudinary', 'skipped', 'Not required');
      }
      break;
    }

    case 'cloudinary_uploading':
      setStep('orientation', 'done', 'Orientation corrected');
      setStep('cloudinary', 'active',
        'Uploading to Cloudinary…<br>' +
        (ev.files || []).map(f => \`<span class="file-badge">📎 \${f}</span>\`).join(''));
      break;

    case 'cloudinary_uploaded':
      setStep('cloudinary', 'done',
        (ev.files || []).map(f =>
          \`<span class="file-badge">📎 \${f.filename}</span>\` +
          (f.url ? \`<br><a class="url-link" href="\${f.url}" target="_blank">🔗 \${f.url}</a>\` : '')
        ).join('<br>'));
      setStep('openai', 'active', 'Sending to OpenAI…');
      break;

    case 'openai_processing':
      setStep('openai', 'active', \`Model: <code>\${ev.model}</code> &nbsp; Analyzing document…\`);
      // Fallback: poll every 5s in case SSE drops before the complete event arrives
      startCompletionPoller();
      break;

    case 'complete':
      setStep('openai', 'done', \`Model finished — classified as <strong>\${ev.type}</strong>\`);
      setStep('complete', 'done', \`Extraction complete\`);
      document.getElementById('liveRunTag')?.remove();
      // Fetch full data from API — avoids large SSE payload issues
      reloadRunSelector().then(() => {
        const data = window._testCaseData;
        if (data?.runs?.length) {
          const latest = data.runs.at(-1);
          showExtractedData(latest.result);
          if (latest.comparison) showConfidence(latest.comparison);
          const btns = document.querySelectorAll('.run-btn');
          btns[btns.length - 1]?.classList.add('active');
        }
      });
      break;

    case 'error':
      setStep('openai', 'error', ev.message);
      setStep('complete', 'error', 'Processing failed');
      break;
  }
}

// ── extracted data display ────────────────────────────────────────────────
function showExtractedData(data) {
  if (!data) return;
  const card = document.getElementById('dataCard');
  const grid = document.getElementById('dataGrid');
  card.classList.add('visible');

  const p = data.patient;
  const s = data.shipments?.[0];

  if (p) {
    const fields = [
      ['First Name', p.patient_first_name],
      ['Last Name', p.patient_last_name],
      ['Date of Birth', p.patient_date_of_birth],
      ['Gender', p.patient_gender],
      ['Address', p.patient_address],
      ['Email', p.patient_email_address],
      ['Product Ordered', p.product_ordered],
      ['Primary Insurance', p.primary_insurance?.name],
      ['Insurance ID', p.primary_insurance?.id_number],
      ['Therapist', [p.therapist?.first_name, p.therapist?.last_name].filter(Boolean).join(' ') || null],
      ['Physician', [p.primary_care_physician?.first_name, p.primary_care_physician?.last_name].filter(Boolean).join(' ') || null],
    ];
    grid.innerHTML = '<div class="data-grid">' +
      fields.map(([label, v]) => \`
        <div class="data-field">
          <div class="label">\${label}</div>
          <div class="value \${!v ? 'null' : ''}">\${v || '—'}</div>
        </div>
      \`).join('') + '</div>';
    if (p.extraction_warnings?.length) {
      grid.innerHTML += '<div class="warnings"><div class="warnings-title">⚠️ Extraction Warnings</div><ul>' +
        p.extraction_warnings.map(w => \`<li>\${w}</li>\`).join('') + '</ul></div>';
    }
  } else if (s) {
    const fields = [
      ['Shipper', s.shipper],
      ['Ship Date', s.ship_date],
      ['Tracking #', s.tracking_number],
      ['Order #', s.order_number],
      ['Status', s.referral_status],
    ];
    grid.innerHTML = '<div class="data-grid">' +
      fields.map(([label, v]) => \`
        <div class="data-field">
          <div class="label">\${label}</div>
          <div class="value \${!v ? 'null' : ''}">\${v || '—'}</div>
        </div>
      \`).join('') + '</div>';
  }
}

// ── confidence gauge ──────────────────────────────────────────────────────
function scoreColor(s) {
  if (s >= 0.95) return '#10b981';
  if (s >= 0.80) return '#f59e0b';
  if (s >= 0.60) return '#f97316';
  return '#ef4444';
}

function showConfidence(comparison) {
  if (!comparison) return;
  const sec = document.getElementById('confidenceSection');
  sec.classList.add('visible');

  const score = comparison.confidenceScore;
  const color = scoreColor(score);

  // Animate arc
  document.getElementById('gaugeArc').style.stroke = color;
  document.getElementById('gaugeArc').setAttribute('stroke-dasharray', \`\${score * 251.2} 251.2\`);

  // Animate needle: -90deg (0%) to +90deg (100%)
  const angle = -90 + score * 180;
  document.getElementById('gaugeNeedle').style.transform = \`rotate(\${angle}deg)\`;
  // Needle endpoint calculation
  const rad = angle * Math.PI / 180;
  const nx = 110 + 80 * Math.cos(rad);
  const ny = 100 + 80 * Math.sin(rad);
  document.getElementById('gaugeNeedle').setAttribute('x2', nx);
  document.getElementById('gaugeNeedle').setAttribute('y2', ny);

  const scoreEl = document.getElementById('gaugeScore');
  scoreEl.style.color = color;
  scoreEl.textContent = (score * 100).toFixed(1) + '%';
  document.getElementById('gaugeLabel').textContent = comparison.label;

  // Breakdown table
  document.getElementById('breakdownTable').innerHTML = buildBreakdownTable(comparison.breakdown, comparison);
}

function buildBreakdownTable(breakdown, comparison) {
  if (!breakdown) return '';
  let rows = '';
  for (const [key, value] of Object.entries(breakdown)) {
    if (typeof value === 'number') {
      const c = scoreColor(value);
      const pct = (value * 100).toFixed(1) + '%';
      rows += \`<tr class="\${value < 1 ? 'diff' : ''}">
        <td>\${key}</td>
        <td><div class="bar-wrap"><div class="bar" style="width:\${pct};background:\${c}"></div></div>
        <span class="score-num" style="color:\${c}">\${pct}</span></td>
      </tr>\`;
    } else if (value && typeof value === 'object' && 'score' in value) {
      const c = scoreColor(value.score);
      rows += \`<tr class="group-header"><td colspan="2" style="padding:6px 12px;font-weight:700;font-size:12px;background:#f9fafb">\${key} <span style="color:\${c}">\${(value.score*100).toFixed(1)}%</span></td></tr>\`;
      for (const [sk, sv] of Object.entries(value.fieldScores || {})) {
        const sc = scoreColor(sv);
        const sp = (sv * 100).toFixed(1) + '%';
        rows += \`<tr class="\${sv < 1 ? 'diff' : ''}">
          <td style="padding-left:24px">\${sk}</td>
          <td><div class="bar-wrap"><div class="bar" style="width:\${sp};background:\${sc}"></div></div>
          <span class="score-num" style="color:\${sc}">\${sp}</span></td>
        </tr>\`;
      }
    }
  }
  return \`<table class="breakdown-table">
    <thead><tr><th>Field</th><th>Match Score</th></tr></thead>
    <tbody>\${rows}</tbody>
  </table>\`;
}

// ── run selector ──────────────────────────────────────────────────────────
async function reloadRunSelector() {
  const res = await fetch('/data/' + DOC_ID + '?t=' + Date.now());
  if (!res.ok) return;
  const data = await res.json();
  renderRunSelector(data);
}

function renderRunSelector(data) {
  const sel = document.getElementById('runSelector');
  sel.innerHTML = data.runs.map(r => {
    const score = r.comparison ? (r.comparison.confidenceScore * 100).toFixed(1) + '%' : 'No GT';
    return \`<button class="run-btn" onclick="showRun(\${r.runNumber})" data-run="\${r.runNumber}">
      Run #\${r.runNumber} &nbsp;<span style="opacity:0.65">\${score}</span>
    </button>\`;
  }).join('');
  window._testCaseData = data;
}

function showRun(n) {
  if (!window._testCaseData) return;
  const run = window._testCaseData.runs.find(r => r.runNumber === n);
  if (!run) return;

  // Highlight active button
  document.querySelectorAll('.run-btn').forEach(b => b.classList.toggle('active', +b.dataset.run === n));

  // Show data + confidence for this run
  showExtractedData(run.result);
  if (run.comparison) showConfidence(run.comparison);

  // Simulate step completion from recorded data
  const src = run.result?.patient?.source || run.result?.shipments?.[0]?.source || '';
  const hasFax = src.toLowerCase().includes('.pdf');
  setStep('email_received', 'done', '');
  setStep('extracting', 'done', src ? \`<span class="file-badge">📎 \${src.replace('attachment: ','')}</span>\` : 'Content extracted');
  if (hasFax) {
    setStep('orientation', 'done', 'Orientation corrected');
    setStep('cloudinary', 'done', \`<span class="file-badge">📎 \${src.replace('attachment: ','')}</span>\`);
  } else {
    setStep('orientation', 'skipped', 'No scanned PDF — skipped');
    setStep('cloudinary', 'skipped', 'Not required');
  }
  setStep('openai', 'done', \`Classified as <strong>\${run.result?.type}</strong>\`);
  setStep('complete', 'done', 'Extraction complete');
  document.getElementById('waitingMsg').style.display = 'none';
  document.getElementById('dataCard').classList.add('visible');
  if (run.comparison) document.getElementById('confidenceSection').classList.add('visible');
}

// ── completion poller — always running as a safety net in case SSE drops ─────
let _pollerTimer = null;
let _lastKnownRunCount = 0;

async function pollForNewRun() {
  try {
    // Cache-bust to ensure browser doesn't return stale data
    const res = await fetch('/data/' + DOC_ID + '?t=' + Date.now());
    if (!res.ok) return;
    const data = await res.json();
    if (data.runs?.length > _lastKnownRunCount) {
      _lastKnownRunCount = data.runs.length;
      const latest = data.runs.at(-1);
      // SSE may have missed the complete event — force the UI into the done state
      setStep('openai', 'done', \`Classified as <strong>\${latest.result?.type}</strong>\`);
      setStep('complete', 'done', 'Extraction complete');
      document.getElementById('liveRunTag')?.remove();
      renderRunSelector(data);
      showExtractedData(latest.result);
      if (latest.comparison) showConfidence(latest.comparison);
      document.querySelectorAll('.run-btn').forEach((b, i, arr) => {
        b.classList.toggle('active', i === arr.length - 1);
      });
    }
  } catch {}
}

function startCompletionPoller() {
  if (_pollerTimer) return;
  _pollerTimer = setInterval(pollForNewRun, 3000);
}

function stopCompletionPoller() {
  if (_pollerTimer) { clearInterval(_pollerTimer); _pollerTimer = null; }
}

// ── init ──────────────────────────────────────────────────────────────────
connectSSE();
reloadRunSelector().then(() => {
  if (window._testCaseData?.runs?.length) {
    _lastKnownRunCount = window._testCaseData.runs.length;
    const last = window._testCaseData.runs.at(-1);
    showRun(last.runNumber);
  }
  // Always poll as a safety net — runs continuously regardless of SSE state
  startCompletionPoller();
});
</script>

</body>
</html>`;
}

function pipelineStepsHTML() {
  const steps = [
    { id: "email",   icon: "📧", title: "Email Received",      detail: "Waiting for email…" },
    { id: "extract", icon: "📄", title: "Content Extraction",  detail: "Will extract text from attachments" },
    { id: "orient",  icon: "🔄", title: "Orientation Check",   detail: "Will check PDF rotation" },
    { id: "cloud",   icon: "☁️", title: "Cloudinary Upload",   detail: "Will upload scanned PDFs if needed" },
    { id: "openai",  icon: "🤖", title: "OpenAI Processing",   detail: "Will classify and extract data" },
    { id: "complete",icon: "✅", title: "Extraction Complete", detail: "Waiting…" },
  ];
  return steps.map(s => `
    <div class="step waiting" id="step-${s.id}">
      <div class="step-icon">${s.icon}</div>
      <div class="step-body">
        <div class="step-title">${s.title}</div>
        <div class="step-detail">${s.detail}</div>
      </div>
      <div class="step-badge badge-waiting">Waiting</div>
    </div>
  `).join("");
}

function commonCSS() {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1f2937; }
    .page-header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 28px 40px; }
    .page-header h1 { font-size: 22px; font-weight: 700; }
    .container { max-width: 1140px; margin: 0 auto; padding: 28px 24px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7280; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .section-title::after { content: ""; flex: 1; height: 1px; background: #e5e7eb; }
    code { font-family: monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  `;
}

export default app;
