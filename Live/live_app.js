/* Live In-session Logger
   - Single page, always visible controls
   - State persists until user changes
   - Logs every change (event log) + derives intervals
   - Offline: load live_survey.json via file picker (works when opened as file://)

   Update in this version (your request):
   - The button that used to be "Download now" is now "Upload to Polybox"
   - Clicking it will:
       (1) download the results JSON locally (browser requirement)
       (2) open your Polybox upload-only link in a new tab
       (3) show an on-page instruction panel with the exact filename to upload
   - UI/payload timezone set to UTC (timestamps already UTC via toISOString)
*/

const POLYBOX_UPLOAD_URL = "https://polybox.ethz.ch/index.php/s/kT7RjaB3wnCWmwJ";
const STORAGE_KEY = "solskin_live_autosave_v1";

const state = {
  cfg: null,
  running: false,
  startedAtISO: null,
  endedAtISO: null,

  fields: {},   // participant_number, session_number
  current: {},  // current answers for questions

  // Event log: every change is appended
  // { qid, from, to, changedAtISO }
  events: [],

  // For showing the filename the user must upload
  lastDownloadedFilename: null,
  lastDownloadedAtISO: null,

  // Show UTC in UI/payload; keep localTz optionally
  tz: "UTC",
  localTz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  userAgent: navigator.userAgent
};

const $card = document.getElementById("card");
const $meta = document.getElementById("meta");
const $liveChip = document.getElementById("liveChip");

const $btnStart = document.getElementById("btnStart");
const $btnEnd = document.getElementById("btnEnd");
const $btnUpload = document.getElementById("btnDownload"); // same DOM id, different meaning

function nowISO(){ return new Date().toISOString(); } // UTC ISO (ends with Z)

function setLiveChip(){
  if (state.running){
    $liveChip.dataset.live = "true";
    $liveChip.innerHTML = `<span class="liveDot"></span> LIVE • last: ${formatTimeUTC(new Date())}`;
  } else {
    delete $liveChip.dataset.live;
    $liveChip.textContent = "NOT RUNNING";
  }
}

function formatTimeUTC(d){
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC"
  });
}

function updateMeta(){
  const p = state.fields.participant_number ?? "?";
  const s = state.fields.session_number ?? "?";
  const run = state.running ? `RUNNING since ${state.startedAtISO}` : "Not running";
  $meta.textContent = `P${p} • S${s} • ${run} • ${state.tz}`;
}

function safeName(x){
  return String(x ?? "NA").replace(/[^a-zA-Z0-9_-]/g, "");
}

function autosave(){
  if (!state.cfg) return;
  const payload = {
    cfgId: state.cfg.surveyId,
    cfgVersion: state.cfg.version,
    savedAtISO: nowISO(),
    running: state.running,
    startedAtISO: state.startedAtISO,
    endedAtISO: state.endedAtISO ?? null,
    fields: state.fields,
    current: state.current,
    events: state.events,
    lastDownloadedFilename: state.lastDownloadedFilename,
    lastDownloadedAtISO: state.lastDownloadedAtISO
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreAutosave(cfg){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try{
    const saved = JSON.parse(raw);
    if (saved.cfgId !== cfg.surveyId) return false;
    if (saved.cfgVersion !== cfg.version) return false;

    state.running = !!saved.running;
    state.startedAtISO = saved.startedAtISO || null;
    state.endedAtISO = saved.endedAtISO || null;
    state.fields = saved.fields || {};
    state.current = saved.current || {};
    state.events = saved.events || [];
    state.lastDownloadedFilename = saved.lastDownloadedFilename || null;
    state.lastDownloadedAtISO = saved.lastDownloadedAtISO || null;
    return true;
  }catch{
    return false;
  }
}

function clearAutosave(){
  localStorage.removeItem(STORAGE_KEY);
}

function getEnabled(q){
  if (!q.enabledIf) return true;
  const dep = q.enabledIf.questionId;
  return state.current[dep] === q.enabledIf.equals;
}

function logChange(qid, from, to){
  const changedAtISO = nowISO();
  state.events.push({ qid, from, to, changedAtISO });
  autosave();
  setLiveChip();
}

function setCurrent(qid, value){
  const prev = state.current[qid];
  if (prev === value) return;

  state.current[qid] = value;

  if (state.running){
    logChange(qid, prev ?? null, value);
  }
}

function validateFields(){
  for (const f of state.cfg.fields){
    if (f.required){
      const v = state.fields[f.id];
      if (v === undefined || v === null || v === "" || Number.isNaN(v)) return false;
    }
  }
  return true;
}

function startSession(){
  if (!validateFields()){
    alert("Please fill Participant Number and Session Number first.");
    return;
  }
  if (state.running) return;

  state.running = true;
  state.startedAtISO = nowISO();
  state.endedAtISO = null;

  // log initial state for each question (so intervals have a start)
  for (const q of state.cfg.questions){
    if (state.current[q.id] === undefined){
      state.current[q.id] = q.default ?? null;
    }
    logChange(q.id, null, state.current[q.id]);
  }

  autosave();
  render();
}

function endSessionAndDownload(){
  if (!state.running){
    // still allow upload flow
    uploadToPolyboxFlow();
    return;
  }
  state.running = false;
  state.endedAtISO = nowISO();
  autosave();

  // after ending, go directly to upload flow
  uploadToPolyboxFlow();
  render();
}

function deriveIntervals(){
  const intervals = [];
  const byQ = new Map();

  for (const ev of state.events){
    if (!byQ.has(ev.qid)) byQ.set(ev.qid, []);
    byQ.get(ev.qid).push(ev);
  }

  const endISO = state.running ? nowISO() : (state.endedAtISO || nowISO());

  for (const [qid, evs] of byQ.entries()){
    evs.sort((a,b) => a.changedAtISO.localeCompare(b.changedAtISO));

    for (let i=0; i<evs.length; i++){
      const cur = evs[i];
      const next = evs[i+1];
      intervals.push({
        qid,
        value: cur.to,
        startISO: cur.changedAtISO,
        endISO: next ? next.changedAtISO : endISO
      });
    }
  }
  return intervals;
}

function downloadJSON(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openPolyboxUpload(){
  // Usually allowed if called from a user click; may still be blocked in some cases.
  try{
    window.open(POLYBOX_UPLOAD_URL, "_blank", "noopener");
  }catch{
    // ignore; we still show the clickable link in the UI
  }
}

function buildResultsPayload(downloadedAtISO){
  return {
    surveyId: state.cfg.surveyId,
    title: state.cfg.title,
    version: state.cfg.version,

    timezone: state.tz,            // "UTC"
    localTimezone: state.localTz,  // for diagnostics
    userAgent: state.userAgent,

    runningAtDownload: state.running,
    startedAtISO: state.startedAtISO,
    endedAtISO: state.endedAtISO,

    downloadedAtISO,

    fields: state.fields,
    currentAtDownload: state.current,

    events: state.events,
    intervals: deriveIntervals()
  };
}

function uploadToPolyboxFlow(){
  if (!state.cfg){
    alert("Please load live_survey.json first.");
    return;
  }
  if (!validateFields()){
    alert("Please fill Participant Number and Session Number first.");
    return;
  }

  const p = safeName(state.fields.participant_number);
  const s = safeName(state.fields.session_number);
  const downloadedAtISO = nowISO();
  const tSafe = downloadedAtISO.replace(/[:]/g, "-");
  const filename = `live_P${p}_S${s}_${tSafe}.json`;

  const payload = buildResultsPayload(downloadedAtISO);

  // 1) download locally (browser requirement)
  downloadJSON(filename, payload);

  // 2) remember filename and show helper panel
  state.lastDownloadedFilename = filename;
  state.lastDownloadedAtISO = downloadedAtISO;
  autosave();

  // 3) open Polybox upload-only page
  openPolyboxUpload();

  // 4) render so the user sees instructions even if popup is blocked
  render();
}

function render(){
  updateMeta();
  setLiveChip();

  if (!$btnUpload) return; // safety

  if (!state.cfg){
    $card.innerHTML = `
      <h1 class="h1">Load Live Survey</h1>
      <p class="sub">Select <code>live_survey.json</code>. Keep this tab open during the session.</p>
      <div class="pill"><input id="cfgFile" type="file" accept="application/json" /></div>
      <p class="sub" style="margin-top:12px">If you previously started on this device, it can restore progress.</p>
    `;
    $btnStart.disabled = true;
    $btnEnd.disabled = true;
    $btnUpload.disabled = true;
    $btnUpload.textContent = "Upload to Polybox";

    document.getElementById("cfgFile").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try{
        const cfg = JSON.parse(await file.text());
        loadCfg(cfg);
      }catch(err){
        alert(`Could not read JSON: ${err.message || err}`);
      }
    });
    return;
  }

  // Buttons
  $btnStart.disabled = state.running;
  $btnEnd.disabled = !state.running;
  $btnUpload.disabled = false;
  $btnUpload.textContent = "Upload to Polybox";

  // Render fields + controls
  const summaryThermal = state.current.thermal_sensation ?? (getQ("thermal_sensation")?.default ?? "—");
  const summaryGlare = state.current.glare_discomfort ?? (getQ("glare_discomfort")?.default ?? "—");
  const glareEnabled = getEnabled(getQ("glare_amount"));
  const summaryGlareAmt = glareEnabled ? (state.current.glare_amount ?? (getQ("glare_amount")?.default ?? "—")) : "—";

  const uploadPanel = state.lastDownloadedFilename ? `
    <div class="summaryGrid" style="margin-top:12px">
      <div class="summaryBox">
        <p class="summaryTitle">Upload results</p>
        <p class="summaryLine">
          A results file was downloaded: <span class="code">${escapeHTML(state.lastDownloadedFilename)}</span><br>
          Please upload it to Polybox (no login required).
        </p>
        <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
          <a class="btn" style="text-decoration:none; display:inline-block"
             href="${POLYBOX_UPLOAD_URL}" target="_blank" rel="noopener">
            Open Polybox upload page
          </a>
        </div>
        <p class="summaryLine" style="margin-top:10px">
          On the Polybox page, choose the downloaded JSON file and upload it.
        </p>
      </div>
    </div>
  ` : "";

  $card.innerHTML = `
    <div class="summaryGrid">
      <div class="summaryBox">
        <p class="summaryTitle">Live status</p>
        <p class="summaryLine">
          Keep this tab open. Your selection stays active until you change it.
          Every change is recorded with timestamps (UTC).
        </p>
        <div class="kv">
          <span>Thermal: <strong>${escapeHTML(String(summaryThermal))}</strong></span>
          <span>Glare: <strong>${escapeHTML(String(summaryGlare))}</strong></span>
          <span>Glare amount: <strong>${escapeHTML(String(summaryGlareAmt))}</strong></span>
        </div>
      </div>
    </div>

    ${renderFields()}
    ${renderControls()}
    ${uploadPanel}
  `;

  wireFieldHandlers();
  wireControlHandlers();
}

function getQ(id){
  return state.cfg.questions.find(q => q.id === id);
}

function renderFields(){
  const lock = state.running ? `disabled` : ``;

  const p = state.fields.participant_number ?? "";
  const s = state.fields.session_number ?? "";

  return `
    <div class="q">
      <label class="title">Participant & Session <span class="req">*</span></label>
      <div class="help">Fill these once before starting. They will lock when the session starts.</div>

      <div class="choices" style="grid-template-columns: 1fr 1fr; gap:12px;">
        <div>
          <label class="help">Participant Number</label>
          <input class="input" id="f_participant_number" type="number" min="1" step="1" value="${escapeAttr(String(p))}" ${lock}>
        </div>
        <div>
          <label class="help">Session Number</label>
          <input class="input" id="f_session_number" type="number" min="1" step="1" value="${escapeAttr(String(s))}" ${lock}>
        </div>
      </div>
    </div>
  `;
}

function renderControls(){
  const qTherm = getQ("thermal_sensation");
  const qGlare = getQ("glare_discomfort");
  const qAmt = getQ("glare_amount");

  // ensure defaults in UI
  if (state.current[qTherm.id] === undefined) state.current[qTherm.id] = qTherm.default ?? null;
  if (state.current[qGlare.id] === undefined) state.current[qGlare.id] = qGlare.default ?? null;
  if (state.current[qAmt.id] === undefined) state.current[qAmt.id] = qAmt.default ?? null;

  const glareEnabled = getEnabled(qAmt);
  const amtDisabledClass = glareEnabled ? "" : "isDisabled";
  const amtVal = state.current[qAmt.id];

  return `
    <div class="q">
      <label class="title">${escapeHTML(qTherm.label)} <span class="req">*</span></label>
      <div class="help">${escapeHTML(qTherm.help || "")}</div>
      <div class="segRow" id="seg_thermal">
        ${qTherm.options.map(opt => `
          <button type="button" class="segBtn" data-qid="${escapeAttr(qTherm.id)}" data-value="${escapeAttr(opt)}" data-on="${state.current[qTherm.id] === opt}">
            ${escapeHTML(opt)}
          </button>
        `).join("")}
      </div>
    </div>

    <div class="q">
      <label class="title">${escapeHTML(qGlare.label)} <span class="req">*</span></label>
      <div class="help">${escapeHTML(qGlare.help || "")}</div>
      <div class="segRow" id="seg_glare">
        ${qGlare.options.map(opt => `
          <button type="button" class="segBtn" data-qid="${escapeAttr(qGlare.id)}" data-value="${escapeAttr(opt)}" data-on="${state.current[qGlare.id] === opt}">
            ${escapeHTML(opt)}
          </button>
        `).join("")}
      </div>
    </div>

    <div class="q ${amtDisabledClass}">
      <label class="title">${escapeHTML(qAmt.label)}</label>
      <div class="help">${escapeHTML(qAmt.help || "")}</div>

      <div class="sliderRow">
        <input id="glare_amount_slider" type="range" min="${qAmt.min}" max="${qAmt.max}" step="${qAmt.step}" value="${amtVal}">
        <span class="sliderValue" id="glare_amount_value">${escapeHTML(String(amtVal))}</span>
      </div>
      <div class="sliderLabels">
        <span>${escapeHTML(qAmt.minLabel || String(qAmt.min))}</span>
        <span>${escapeHTML(qAmt.maxLabel || String(qAmt.max))}</span>
      </div>
    </div>
  `;
}

function wireFieldHandlers(){
  const pEl = document.getElementById("f_participant_number");
  const sEl = document.getElementById("f_session_number");

  const onChange = () => {
    state.fields.participant_number = pEl.value === "" ? "" : Number(pEl.value);
    state.fields.session_number = sEl.value === "" ? "" : Number(sEl.value);
    autosave();
    updateMeta();
  };

  pEl.addEventListener("input", onChange);
  sEl.addEventListener("input", onChange);
}

function wireControlHandlers(){
  // Seg buttons
  document.querySelectorAll(".segBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const qid = btn.dataset.qid;
      const value = btn.dataset.value;

      setCurrent(qid, value);

      // If glare changed to No, disable amount but keep last value
      if (qid === "glare_discomfort" && value === "No"){
        // optional: setCurrent("glare_amount", getQ("glare_amount").default ?? 1);
      }

      render();
    });
  });

  // Slider
  const slider = document.getElementById("glare_amount_slider");
  const valueEl = document.getElementById("glare_amount_value");
  const qAmt = getQ("glare_amount");

  if (slider && valueEl){
    slider.addEventListener("input", () => {
      valueEl.textContent = String(slider.value);
    });

    slider.addEventListener("change", () => {
      if (!getEnabled(qAmt)) return;
      setCurrent("glare_amount", Number(slider.value));
      render();
    });
  }
}

function loadCfg(cfg){
  if (!cfg || !Array.isArray(cfg.questions) || !Array.isArray(cfg.fields)){
    alert("Invalid live survey JSON.");
    return;
  }
  state.cfg = cfg;

  const restored = restoreAutosave(cfg);
  if (restored){
    const ok = confirm("Restore your previous live logger state on this device?");
    if (!ok){
      clearAutosave();
      state.running = false;
      state.startedAtISO = null;
      state.endedAtISO = null;
      state.fields = {};
      state.current = {};
      state.events = [];
      state.lastDownloadedFilename = null;
      state.lastDownloadedAtISO = null;
    }
  } else {
    // init defaults
    for (const q of cfg.questions){
      state.current[q.id] = q.default ?? null;
    }
  }

  render();
}

/* Buttons */
$btnStart.addEventListener("click", startSession);
$btnEnd.addEventListener("click", endSessionAndDownload);

// This button is now "Upload to Polybox"
$btnUpload.addEventListener("click", uploadToPolyboxFlow);

/* Boot */
render();

/* utils */
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"
  }[c]));
}
function escapeAttr(s){ return escapeHTML(s).replace(/`/g, "&#96;"); }
