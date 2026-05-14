/**
 * Generates a static HTML report from a test-case data.json.
 *
 * Usage:
 *   node src/scripts/generate-report.js <documentId>
 *   node src/scripts/generate-report.js 19cb2fee11fdc5d2
 *
 * Output: test-cases/{documentId}/report.html
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_CASES_DIR = path.resolve(__dirname, "../../test-cases");

const [, , documentId] = process.argv;
if (!documentId) {
  console.error("Usage: node src/scripts/generate-report.js <documentId>");
  process.exit(1);
}

const dataPath = path.join(TEST_CASES_DIR, documentId, "data.json");
const raw = await fs.readFile(dataPath, "utf-8").catch(() => {
  console.error(`No test case found for "${documentId}"`);
  process.exit(1);
});

const data = JSON.parse(raw);

// ── helpers ────────────────────────────────────────────────────────────────

function pct(score) {
  return (score * 100).toFixed(1) + "%";
}

function scoreColor(score) {
  if (score >= 0.95) return "#10b981"; // green
  if (score >= 0.80) return "#f59e0b"; // amber
  if (score >= 0.60) return "#f97316"; // orange
  return "#ef4444";                    // red
}

function scoreLabel(score) {
  if (score >= 0.95) return "Very Stable";
  if (score >= 0.80) return "Minor Differences";
  if (score >= 0.60) return "Moderate Drift";
  return "High Variance";
}

function val(v) {
  if (v === null || v === undefined) return '<span class="null">null</span>';
  if (typeof v === "object") return `<pre class="obj">${JSON.stringify(v, null, 2)}</pre>`;
  return `<span class="str">${v}</span>`;
}

// Detect if this document had a Cloudinary upload (fax attachment) from source field
function detectSteps(data) {
  const firstRun = data.runs[0];
  const source = firstRun?.result?.patient?.source ||
    firstRun?.result?.shipments?.[0]?.source || "";
  const hasCloudinary = source.toLowerCase().includes(".pdf");
  return { hasCloudinary };
}

// ── pipeline steps HTML ────────────────────────────────────────────────────

function buildPipelineSteps(data) {
  const { hasCloudinary } = detectSteps(data);
  const type = data.runs[0]?.result?.type ?? "unknown";
  const source = data.runs[0]?.result?.patient?.source ||
    data.runs[0]?.result?.shipments?.[0]?.source || "";

  const steps = [
    {
      icon: "📧",
      title: "Email Received",
      detail: `Document ID: <code>${data.documentId}</code>`,
      status: "done",
    },
    {
      icon: "📄",
      title: "Content Extraction",
      detail: source
        ? `Attachment detected: <code>${source.replace("attachment: ", "")}</code>`
        : "Email body parsed",
      status: "done",
    },
    {
      icon: "🔄",
      title: "Orientation Check",
      detail: hasCloudinary
        ? "Scanned PDF detected — orientation corrected before upload"
        : "No orientation correction needed",
      status: "done",
      conditional: true,
    },
    {
      icon: "☁️",
      title: "Cloudinary Upload",
      detail: hasCloudinary
        ? buildCloudinaryDetail(data)
        : "Not required — document processed locally",
      status: hasCloudinary ? "done" : "skipped",
    },
    {
      icon: "🤖",
      title: "OpenAI Processing",
      detail: hasCloudinary
        ? "GPT-5 Response API used (file-based PDF input)"
        : "GPT-4.1-mini Chat Completions API used",
      status: "done",
    },
    {
      icon: "✅",
      title: "Extraction Complete",
      detail: `Classified as <strong>${type}</strong> — ${data.runs.length} parse run(s) recorded`,
      status: "done",
    },
  ];

  return steps.map((step, i) => `
    <div class="step ${step.status}" style="animation-delay: ${i * 0.12}s">
      <div class="step-icon">${step.icon}</div>
      <div class="step-body">
        <div class="step-title">${step.title}</div>
        <div class="step-detail">${step.detail}</div>
      </div>
      <div class="step-badge ${step.status}">${step.status === "skipped" ? "Skipped" : "Done"}</div>
      ${i < steps.length - 1 ? '<div class="step-connector"></div>' : ""}
    </div>
  `).join("");
}

function buildCloudinaryDetail(data) {
  const source = data.runs[0]?.result?.patient?.source ||
    data.runs[0]?.result?.shipments?.[0]?.source || "";
  const filename = source.replace("attachment: ", "");
  return `
    PDF uploaded to Cloudinary for OpenAI file API access<br>
    <span class="file-badge">📎 ${filename}</span>
  `;
}

// ── confidence gauge SVG ───────────────────────────────────────────────────

function buildGauge(score) {
  const color = scoreColor(score);
  const angle = -90 + score * 180; // -90 (left) to +90 (right)
  const rad = (angle * Math.PI) / 180;
  const cx = 110, cy = 100, r = 80;
  const nx = cx + r * Math.cos(rad);
  const ny = cy + r * Math.sin(rad);

  return `
    <svg viewBox="0 0 220 120" class="gauge-svg">
      <!-- Background arc -->
      <path d="M 30 100 A 80 80 0 0 1 190 100" fill="none" stroke="#e5e7eb" stroke-width="16" stroke-linecap="round"/>
      <!-- Colored arc (score portion) -->
      <path d="M 30 100 A 80 80 0 0 1 190 100" fill="none" stroke="${color}"
        stroke-width="16" stroke-linecap="round"
        stroke-dasharray="${score * 251.2} 251.2"/>
      <!-- Needle -->
      <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}"
        stroke="#1f2937" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="5" fill="#1f2937"/>
      <!-- Labels -->
      <text x="24" y="118" font-size="10" fill="#9ca3af">0%</text>
      <text x="100" y="18" font-size="10" fill="#9ca3af" text-anchor="middle">50%</text>
      <text x="186" y="118" font-size="10" fill="#9ca3af">100%</text>
    </svg>
  `;
}

// ── field comparison table ─────────────────────────────────────────────────

function buildBreakdownTable(breakdown, groundTruth, runResult) {
  if (!breakdown || typeof breakdown !== "object") return "";

  const rows = [];

  function renderField(key, score, gtVal, runVal) {
    const color = scoreColor(score);
    const pctVal = pct(score);
    const isMatch = score === 1;
    return `
      <tr class="${isMatch ? "match" : "diff"}">
        <td class="field-name">${key}</td>
        <td>${val(gtVal)}</td>
        <td>${val(runVal)}</td>
        <td>
          <div class="bar-wrap">
            <div class="bar" style="width:${pctVal}; background:${color}"></div>
          </div>
          <span class="score-num" style="color:${color}">${pctVal}</span>
        </td>
      </tr>
    `;
  }

  const patient = groundTruth?.patient || groundTruth?.shipments?.[0];
  const runPatient = runResult?.patient || runResult?.shipments?.[0];

  for (const [key, value] of Object.entries(breakdown)) {
    if (typeof value === "number") {
      rows.push(renderField(key, value, patient?.[key], runPatient?.[key]));
    } else if (value && typeof value === "object" && "score" in value) {
      // Nested object (insurance, therapist, etc.)
      rows.push(`
        <tr class="group-header">
          <td colspan="4">
            <span class="group-icon">▾</span> ${key}
            <span class="group-score" style="color:${scoreColor(value.score)}">${pct(value.score)}</span>
          </td>
        </tr>
      `);
      for (const [subKey, subScore] of Object.entries(value.fieldScores || {})) {
        rows.push(renderField(
          `&nbsp;&nbsp;&nbsp;${subKey}`,
          subScore,
          patient?.[key]?.[subKey],
          runPatient?.[key]?.[subKey],
        ));
      }
    }
  }

  return `
    <table class="breakdown-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Ground Truth</th>
          <th>AI Result</th>
          <th>Match Score</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}

// ── runs section ───────────────────────────────────────────────────────────

function buildRunsSection(data) {
  return data.runs.map((run) => {
    const score = run.comparison?.confidenceScore ?? null;
    const label = run.comparison?.label ?? "No ground truth";
    const color = score !== null ? scoreColor(score) : "#9ca3af";

    return `
      <div class="run-card">
        <div class="run-header">
          <div class="run-title">
            <span class="run-number">Run #${run.runNumber}</span>
            <span class="run-time">${new Date(run.timestamp).toLocaleString()}</span>
          </div>
          ${score !== null ? `
            <div class="run-score-pill" style="background:${color}20; border-color:${color}; color:${color}">
              ${pct(score)} &mdash; ${label}
            </div>
          ` : `<div class="run-score-pill no-gt">No ground truth set</div>`}
        </div>

        ${score !== null ? `
          <div class="gauge-row">
            <div class="gauge-wrap">
              ${buildGauge(score)}
              <div class="gauge-label" style="color:${color}">${pct(score)}</div>
              <div class="gauge-sublabel">${label}</div>
            </div>
            <div class="breakdown-wrap">
              ${buildBreakdownTable(run.comparison?.breakdown, data.groundTruth, run.result)}
            </div>
          </div>
        ` : ""}

        ${run.result?.patient?.extraction_warnings?.length ? `
          <div class="warnings">
            <div class="warnings-title">⚠️ Extraction Warnings</div>
            <ul>${run.result.patient.extraction_warnings.map(w => `<li>${w}</li>`).join("")}</ul>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

// ── ground truth section ───────────────────────────────────────────────────

function buildGroundTruthSection(data) {
  if (!data.groundTruth) return `<div class="no-gt-notice">No ground truth set yet. Use <code>npm run test-cases promote ${data.documentId} 1</code> to set one.</div>`;

  const p = data.groundTruth.patient;
  if (!p) return `<pre>${JSON.stringify(data.groundTruth, null, 2)}</pre>`;

  const fields = [
    ["First Name", p.patient_first_name],
    ["Last Name", p.patient_last_name],
    ["Date of Birth", p.patient_date_of_birth],
    ["Gender", p.patient_gender],
    ["Address", p.patient_address],
    ["Email", p.patient_email_address],
    ["Product Ordered", p.product_ordered],
    ["Primary Insurance", p.primary_insurance?.name],
    ["Insurance ID", p.primary_insurance?.id_number],
    ["Therapist", [p.therapist?.first_name, p.therapist?.last_name].filter(Boolean).join(" ") || null],
    ["Physician", [p.primary_care_physician?.first_name, p.primary_care_physician?.last_name].filter(Boolean).join(" ") || null],
  ];

  return `
    <div class="gt-grid">
      ${fields.map(([label, value]) => `
        <div class="gt-field">
          <div class="gt-label">${label}</div>
          <div class="gt-value">${value ?? '<span class="null">—</span>'}</div>
        </div>
      `).join("")}
    </div>
    ${p.extraction_warnings?.length ? `
      <div class="warnings" style="margin-top:16px">
        <div class="warnings-title">⚠️ Ground Truth Warnings</div>
        <ul>${p.extraction_warnings.map(w => `<li>${w}</li>`).join("")}</ul>
      </div>
    ` : ""}
  `;
}

// ── overall summary bar ────────────────────────────────────────────────────

function buildSummaryBar(data) {
  const scores = data.runs.filter(r => r.comparison).map(r => r.comparison.confidenceScore);
  if (!scores.length) return "";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const color = scoreColor(avg);

  return `
    <div class="summary-bar">
      <div class="summary-stat">
        <div class="summary-num" style="color:${color}">${pct(avg)}</div>
        <div class="summary-lbl">Average Confidence</div>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <div class="summary-num" style="color:${scoreColor(min)}">${pct(min)}</div>
        <div class="summary-lbl">Lowest Run</div>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <div class="summary-num" style="color:${scoreColor(max)}">${pct(max)}</div>
        <div class="summary-lbl">Highest Run</div>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <div class="summary-num">${data.runs.length}</div>
        <div class="summary-lbl">Total Runs</div>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <div class="summary-num" style="color:${color}">${scoreLabel(avg)}</div>
        <div class="summary-lbl">Overall Stability</div>
      </div>
    </div>
  `;
}

// ── full HTML ──────────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Compression Care — Parse Report: ${documentId}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f8fafc;
      color: #1f2937;
      min-height: 100vh;
    }

    /* ── header ── */
    .page-header {
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      color: white;
      padding: 36px 48px 28px;
    }
    .page-header h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.3px; }
    .page-header .doc-id {
      font-size: 13px; opacity: 0.75; margin-top: 6px; font-family: monospace;
    }
    .page-header .meta { font-size: 13px; opacity: 0.85; margin-top: 4px; }

    /* ── layout ── */
    .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
    .section { margin-bottom: 40px; }
    .section-title {
      font-size: 15px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.8px; color: #6b7280; margin-bottom: 16px;
      display: flex; align-items: center; gap: 8px;
    }
    .section-title::after {
      content: ""; flex: 1; height: 1px; background: #e5e7eb;
    }

    /* ── pipeline steps ── */
    .pipeline { display: flex; flex-direction: column; gap: 0; }
    .step {
      display: flex; align-items: flex-start; gap: 16px;
      background: white; border: 1px solid #e5e7eb; border-radius: 12px;
      padding: 18px 20px; margin-bottom: 4px; position: relative;
      animation: fadeIn 0.4s ease both;
    }
    .step.skipped { opacity: 0.55; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .step-icon { font-size: 22px; flex-shrink: 0; margin-top: 1px; }
    .step-body { flex: 1; }
    .step-title { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
    .step-detail { font-size: 13px; color: #6b7280; line-height: 1.5; }
    .step-badge {
      font-size: 11px; font-weight: 600; padding: 3px 10px;
      border-radius: 999px; flex-shrink: 0;
    }
    .step-badge.done { background: #d1fae5; color: #065f46; }
    .step-badge.skipped { background: #f3f4f6; color: #9ca3af; }
    .file-badge {
      display: inline-block; background: #eff6ff; color: #1d4ed8;
      font-size: 12px; padding: 2px 8px; border-radius: 6px;
      font-family: monospace; margin-top: 4px; border: 1px solid #bfdbfe;
    }

    /* ── summary bar ── */
    .summary-bar {
      background: white; border: 1px solid #e5e7eb; border-radius: 12px;
      padding: 20px 32px; display: flex; align-items: center; gap: 0;
    }
    .summary-stat { flex: 1; text-align: center; }
    .summary-num { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
    .summary-lbl { font-size: 12px; color: #9ca3af; margin-top: 3px; }
    .summary-divider { width: 1px; height: 40px; background: #e5e7eb; }

    /* ── ground truth grid ── */
    .gt-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px; background: white; border: 1px solid #e5e7eb;
      border-radius: 12px; padding: 20px;
    }
    .gt-field { }
    .gt-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #9ca3af; margin-bottom: 3px; }
    .gt-value { font-size: 14px; font-weight: 500; color: #1f2937; word-break: break-word; }

    /* ── run cards ── */
    .run-card {
      background: white; border: 1px solid #e5e7eb; border-radius: 12px;
      padding: 24px; margin-bottom: 20px;
    }
    .run-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
    .run-title { display: flex; align-items: center; gap: 12px; }
    .run-number { font-size: 16px; font-weight: 700; }
    .run-time { font-size: 12px; color: #9ca3af; }
    .run-score-pill {
      font-size: 13px; font-weight: 600; padding: 5px 14px;
      border-radius: 999px; border: 1px solid;
    }
    .run-score-pill.no-gt { background: #f3f4f6; border-color: #e5e7eb; color: #9ca3af; }

    /* ── gauge ── */
    .gauge-row { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
    .gauge-wrap { width: 220px; flex-shrink: 0; text-align: center; }
    .gauge-svg { width: 100%; }
    .gauge-label { font-size: 28px; font-weight: 800; letter-spacing: -1px; margin-top: 4px; }
    .gauge-sublabel { font-size: 13px; color: #6b7280; margin-top: 2px; }
    .breakdown-wrap { flex: 1; min-width: 0; overflow-x: auto; }

    /* ── breakdown table ── */
    .breakdown-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .breakdown-table th {
      text-align: left; padding: 8px 12px; background: #f9fafb;
      border-bottom: 2px solid #e5e7eb; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280;
    }
    .breakdown-table td { padding: 7px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
    .breakdown-table tr.match td:first-child { color: #1f2937; }
    .breakdown-table tr.diff { background: #fffbeb; }
    .breakdown-table tr.diff td:first-child { color: #b45309; font-weight: 600; }
    .breakdown-table tr.group-header td {
      background: #f9fafb; font-weight: 700; font-size: 12px;
      padding: 6px 12px; color: #374151;
    }
    .group-score { margin-left: 8px; font-size: 12px; }
    .bar-wrap { display: inline-block; width: 80px; height: 6px; background: #e5e7eb; border-radius: 3px; vertical-align: middle; margin-right: 6px; }
    .bar { height: 6px; border-radius: 3px; }
    .score-num { font-size: 12px; font-weight: 600; vertical-align: middle; }
    .null { color: #d1d5db; font-style: italic; font-size: 12px; }
    .str { color: #1f2937; }
    pre.obj { font-size: 11px; color: #6b7280; white-space: pre-wrap; word-break: break-all; }
    code { font-family: monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }

    /* ── warnings ── */
    .warnings {
      background: #fffbeb; border: 1px solid #fcd34d;
      border-radius: 8px; padding: 12px 16px; margin-top: 16px;
    }
    .warnings-title { font-size: 13px; font-weight: 600; color: #92400e; margin-bottom: 6px; }
    .warnings ul { padding-left: 18px; }
    .warnings li { font-size: 13px; color: #78350f; margin-bottom: 3px; }

    /* ── no gt notice ── */
    .no-gt-notice {
      background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px;
      padding: 16px 20px; font-size: 14px; color: #0369a1;
    }

    /* ── footer ── */
    .footer { text-align: center; padding: 24px; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; margin-top: 16px; }
  </style>
</head>
<body>

<div class="page-header">
  <h1>Compression Care — Document Parse Report</h1>
  <div class="doc-id">Document ID: ${data.documentId}</div>
  <div class="meta">
    Created: ${new Date(data.createdAt).toLocaleString()} &nbsp;·&nbsp;
    Type: <strong>${data.runs[0]?.result?.type ?? "unknown"}</strong> &nbsp;·&nbsp;
    Runs: <strong>${data.runs.length}</strong> &nbsp;·&nbsp;
    Ground Truth: <strong>${data.groundTruth ? "Set" : "Not set"}</strong>
  </div>
</div>

<div class="container">

  <!-- PROCESSING PIPELINE -->
  <div class="section">
    <div class="section-title">Processing Pipeline</div>
    <div class="pipeline">
      ${buildPipelineSteps(data)}
    </div>
  </div>

  <!-- OVERALL SUMMARY -->
  ${data.runs.some(r => r.comparison) ? `
  <div class="section">
    <div class="section-title">Overall Confidence Summary</div>
    ${buildSummaryBar(data)}
  </div>
  ` : ""}

  <!-- GROUND TRUTH -->
  <div class="section">
    <div class="section-title">Ground Truth (Your Verified Result)</div>
    ${buildGroundTruthSection(data)}
  </div>

  <!-- RUNS -->
  <div class="section">
    <div class="section-title">Parse Runs vs Ground Truth</div>
    ${buildRunsSection(data)}
  </div>

</div>

<div class="footer">
  Generated ${new Date().toLocaleString()} &nbsp;·&nbsp; Compression Care Worker
</div>

</body>
</html>`;

// ── write output ───────────────────────────────────────────────────────────

const outPath = path.join(TEST_CASES_DIR, documentId, "report.html");
await fs.writeFile(outPath, html, "utf-8");
console.log(`✅ Report generated: ${outPath}`);
