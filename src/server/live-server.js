/**
 * Live demo server.
 * Serves a dashboard at http://localhost:3030 that passively monitors the worker:
 * jobs arrive via Redis (e.g. enqueued from Postman), and this dashboard streams
 * each job's logs, cost, and final API response to the browser via SSE.
 *
 * It also exposes selectors for the extraction engine (gpt-5.5 ⇄ Mistral OCR) and
 * the file-input model — both switch what the worker uses for subsequent jobs,
 * with no restart.
 *
 * Start alongside the worker:  npm run demo
 */
import express from 'express';
import cors from 'cors';
import bus from '../utils/processing-events.js';
import { startRecorder, listRecords } from '../utils/test-recorder.js';
import {
  listEngines, getEngineName, setEngine,
  listFileInputModels, getFileInputModel, setFileInputModel,
} from '../services/extraction-engine.js';

const PORT = process.env.LIVE_PORT || 3030;
const app = express();
app.use(cors());
app.use(express.json());

// Persist every job to test/<id>.json so history survives refresh and restart.
startRecorder();

// ── SSE — browser subscribes to ALL processing events ────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: 'hello', ts: Date.now() });

  const handler = (event) => send(event);
  bus.on('event', handler);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    bus.off('event', handler);
  });
});

// ── Job history (persisted to disk, oldest → newest) ─────────────────────────
app.get('/history', async (req, res) => {
  res.json(await listRecords());
});

// ── Settings (engine + file-input model) ─────────────────────────────────────
app.get('/settings', (req, res) => {
  res.json({
    engine: { current: getEngineName(), options: listEngines() },
    model: { current: getFileInputModel(), options: listFileInputModels() },
  });
});

app.post('/engine', (req, res) => {
  const { id } = req.body || {};
  if (!setEngine(id)) return res.status(400).json({ error: `Unknown engine: ${id}` });
  console.log(`🔀 Demo switched extraction engine → ${id}`);
  bus.emit('event', { type: 'engine', current: id, ts: Date.now() });
  res.json({ current: getEngineName() });
});

app.post('/model', (req, res) => {
  const { id } = req.body || {};
  if (!setFileInputModel(id)) return res.status(400).json({ error: `Unknown model: ${id}` });
  console.log(`🔀 Demo switched file-input model → ${id}`);
  bus.emit('event', { type: 'model', current: id, ts: Date.now() });
  res.json({ current: getFileInputModel() });
});

// ── Dashboard ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send(dashboardHTML()));

app.listen(PORT, () => {
  console.log(`\n🚀 Live demo dashboard running at http://localhost:${PORT}\n`);
});

function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Compression Care — Live Demo</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:#0f172a; color:#e2e8f0; }
  .topbar { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;
            padding:14px 20px; background:#1e293b; border-bottom:1px solid #334155; position:sticky; top:0; z-index:10; }
  .topbar h1 { font-size:17px; margin:0; }
  .topbar .sub { font-size:12px; color:#94a3b8; margin-top:2px; }
  .controls { display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap; }
  .field { display:flex; flex-direction:column; gap:4px; }
  .field label { font-size:11px; color:#94a3b8; text-transform:uppercase; letter-spacing:.04em; }
  select { background:#0f172a; color:#e2e8f0; border:1px solid #475569; border-radius:8px; padding:8px 10px; font-size:13px; max-width:340px; }
  .btn { background:#0f172a; color:#e2e8f0; border:1px solid #475569; border-radius:8px; padding:8px 12px; font-size:13px; cursor:pointer; }
  .btn:hover { background:#243349; border-color:#64748b; }
  .status-dot { width:8px; height:8px; border-radius:50%; background:#64748b; display:inline-block; }
  .status-dot.live { background:#22c55e; box-shadow:0 0 6px #22c55e; }
  .container { padding:20px; max-width:1100px; margin:0 auto; }
  .empty { text-align:center; color:#64748b; padding:64px 16px; }
  .job { background:#1e293b; border:1px solid #334155; border-radius:12px; margin-bottom:20px; overflow:hidden; }
  .job-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
              padding:14px 18px; border-bottom:1px solid #334155; cursor:pointer; user-select:none; }
  .job-head:hover { background:#243349; }
  .job-head-right { display:flex; align-items:center; gap:10px; flex-shrink:0; }
  .caret { color:#94a3b8; font-size:12px; transition:transform .15s ease; }
  .job.collapsed .caret { transform:rotate(-90deg); }
  .job.collapsed .job-head { border-bottom:none; }
  .job.collapsed .pane { display:none; }
  .job-id { font-family:monospace; font-weight:600; font-size:14px; }
  .job-meta { font-size:12px; color:#94a3b8; margin-top:3px; word-break:break-all; }
  .badge { font-size:11px; font-weight:700; padding:4px 10px; border-radius:999px; text-transform:uppercase; letter-spacing:.04em; white-space:nowrap; }
  .badge.running { background:#1d4ed8; color:#dbeafe; }
  .badge.done { background:#166534; color:#dcfce7; }
  .badge.error { background:#991b1b; color:#fee2e2; }
  .pane { padding:14px 18px; border-top:1px solid #334155; }
  .pane:first-child { border-top:none; }
  .pane h3 { margin:0 0 10px; font-size:12px; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; }
  .logbox { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; line-height:1.5;
            max-height:300px; overflow:auto; white-space:pre-wrap; word-break:break-word;
            background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; }
  .log-info { color:#cbd5e1; } .log-warn { color:#fde047; } .log-error { color:#fca5a5; }
  .cost table { width:100%; border-collapse:collapse; font-size:12px; }
  .cost td, .cost th { padding:4px 6px; border-bottom:1px solid #334155; text-align:left; }
  .cost th { color:#94a3b8; font-weight:600; }
  .cost td.num, .cost th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .cost .total { font-weight:700; font-size:14px; color:#86efac; margin-top:8px; }
  pre.json { background:#0f172a; border:1px solid #334155; border-radius:8px; padding:12px; font-size:12px;
             line-height:1.5; max-height:460px; overflow:auto; margin:0; }
</style>
</head>
<body>
<div class="topbar">
  <div>
    <h1>Compression Care — Live Demo</h1>
    <div class="sub"><span id="dot" class="status-dot"></span> <span id="conn">connecting…</span> · jobs arrive from the queue</div>
  </div>
  <div class="controls">
    <div class="field"><label for="engine">Extraction engine</label><select id="engine"></select></div>
    <div class="field"><label for="model">File-input model</label><select id="model"></select></div>
    <div class="field"><label>&nbsp;</label><button id="collapseAll" class="btn">Collapse all</button></div>
    <div class="field"><label>&nbsp;</label><button id="expandAll" class="btn">Expand all</button></div>
  </div>
</div>
<div class="container"><div id="jobs"><div class="empty">Waiting for jobs… enqueue one (e.g. via Postman) to watch it process here.</div></div></div>

<script>
const jobsEl = document.getElementById('jobs');
const jobs = {};
let hasJob = false;

// ── Settings dropdowns ───────────────────────────────────────────────────────
const engineSel = document.getElementById('engine');
const modelSel = document.getElementById('model');
fetch('/settings').then(r => r.json()).then(d => {
  engineSel.innerHTML = d.engine.options.map(e => '<option value="'+e.id+'">'+e.label+'</option>').join('');
  engineSel.value = d.engine.current;
  modelSel.innerHTML = d.model.options.map(m => '<option value="'+m+'">'+m+'</option>').join('');
  modelSel.value = d.model.current;
});
engineSel.addEventListener('change', () =>
  fetch('/engine', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: engineSel.value }) }));
modelSel.addEventListener('change', () =>
  fetch('/model', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: modelSel.value }) }));

// ── Collapse / expand all job cards ──────────────────────────────────────────
document.getElementById('collapseAll').addEventListener('click', () =>
  jobsEl.querySelectorAll('.job').forEach((el) => el.classList.add('collapsed')));
document.getElementById('expandAll').addEventListener('click', () =>
  jobsEl.querySelectorAll('.job').forEach((el) => el.classList.remove('collapsed')));

// ── History replay (from saved test/*.json) then live SSE ────────────────────
const dot = document.getElementById('dot'), conn = document.getElementById('conn');

function connectSSE() {
  const es = new EventSource('/events');
  es.onopen = () => { dot.classList.add('live'); conn.textContent = 'live'; };
  es.onerror = () => { dot.classList.remove('live'); conn.textContent = 'reconnecting…'; };
  es.onmessage = (m) => handle(JSON.parse(m.data));
}

function renderHistoryJob(rec) {
  const job = ensureJob(rec.documentId, { jobId: rec.jobId, source: rec.source, sourceUrl: rec.sourceUrl });
  (rec.logs || []).forEach((l) => appendLog(job, l));
  (rec.costs || []).forEach((c) => addCost(job, c));
  if (rec.result) showResult(job, { response: rec.result });
  if (rec.status && rec.status !== 'running') setStatus(job, rec.status);
}

// Replay saved jobs (oldest → newest; ensureJob prepends so newest ends on top),
// then connect for live updates.
fetch('/history').then((r) => r.json())
  .then((list) => list.forEach(renderHistoryJob))
  .catch(() => {})
  .finally(connectSSE);

function handle(ev) {
  if (ev.type === 'engine') { engineSel.value = ev.current; return; }
  if (ev.type === 'model') { modelSel.value = ev.current; return; }
  if (ev.type === 'hello') return;
  const id = ev.documentId;
  if (!id) return;
  if (ev.type === 'job:start') return ensureJob(id, ev);
  const job = jobs[id] || ensureJob(id, {});
  if (ev.type === 'log') appendLog(job, ev);
  else if (ev.type === 'cost') addCost(job, ev);
  else if (ev.type === 'result') showResult(job, ev);
  else if (ev.type === 'job:done') setStatus(job, 'done');
  else if (ev.type === 'job:error') { setStatus(job, 'error'); appendLog(job, { level:'error', message:'JOB FAILED: '+(ev.message||'') }); }
}

function ensureJob(id, ev) {
  if (jobs[id]) return jobs[id];
  if (!hasJob) { jobsEl.innerHTML = ''; hasJob = true; }
  const el = document.createElement('div');
  el.className = 'job';
  el.innerHTML = \`
    <div class="job-head">
      <div>
        <div class="job-id">\${ev.jobId ? 'Job '+ev.jobId+' · ' : ''}\${id}</div>
        <div class="job-meta">\${ev.source ? ev.source+' · ' : ''}\${ev.sourceUrl || ''}</div>
      </div>
      <div class="job-head-right">
        <span class="badge running">running</span>
        <span class="caret">▾</span>
      </div>
    </div>
    <div class="pane"><h3>Logs</h3><div class="logbox"></div></div>
    <div class="pane"><h3>Cost</h3><div class="cost"><em style="color:#64748b">awaiting model calls…</em></div></div>
    <div class="pane"><h3>API response</h3><pre class="json"><em style="color:#64748b">pending…</em></pre></div>\`;
  el.querySelector('.job-head').addEventListener('click', () => el.classList.toggle('collapsed'));
  jobsEl.prepend(el);
  const job = {
    el,
    badge: el.querySelector('.badge'),
    logsEl: el.querySelector('.logbox'),
    costEl: el.querySelector('.cost'),
    jsonEl: el.querySelector('.json'),
    costRows: [], costTotal: 0,
  };
  jobs[id] = job;
  return job;
}

function appendLog(job, ev) {
  const line = document.createElement('div');
  line.className = 'log-' + (ev.level || 'info');
  line.textContent = ev.message || '';
  job.logsEl.appendChild(line);
  job.logsEl.scrollTop = job.logsEl.scrollHeight;
}

function addCost(job, ev) {
  if (typeof ev.cost === 'number') job.costTotal += ev.cost;
  job.costRows.push(ev);
  const rows = job.costRows.map(c =>
    '<tr><td>'+(c.label||c.model)+'</td><td>'+(c.model||'')+'</td>'+
    '<td class="num">'+(c.inTokens||0)+' / '+(c.outTokens||0)+'</td>'+
    '<td class="num">'+(typeof c.cost==='number' ? '$'+c.cost.toFixed(5) : '—')+'</td></tr>'
  ).join('');
  job.costEl.innerHTML =
    '<table><thead><tr><th>call</th><th>model</th><th class="num">in / out tok</th><th class="num">cost</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table>'+
    '<div class="total">Total: $'+job.costTotal.toFixed(5)+'</div>';
}

function showResult(job, ev) {
  job.jsonEl.textContent = JSON.stringify(ev.response, null, 2);
}

function setStatus(job, status) {
  job.badge.className = 'badge ' + status;
  job.badge.textContent = status;
}
</script>
</body>
</html>`;
}

export default app;
