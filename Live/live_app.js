/* Live In-session Logger
   - Single page, always visible controls
   - State persists until user changes
   - Logs every change (event log) + derives intervals
   - Offline: load live_survey.json via file picker (works when opened as file://)

   Updates you requested:
   - Show/record UTC (not Europe/Zurich) in UI + payload
   - Replace mailto-only hint with Polybox upload option
   - Keep a (ghost) email fallback button
*/

const EMAIL_TO = "kim@arch.ethz.ch";
const POLYBOX_UPLOAD_URL = "https://polybox.ethz.ch/index.php/s/2HSKSHKn7i7QSTe";
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

  // Always present UTC in UI/payload; keep local timezone for diagnostics
  tz: "UTC",
  localTz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  userAgent: navigator.userAgent
};

const $card = document.getElementById("card");
const $meta = document.getElementById("meta");
const $liveChip = document.getElementById("liveChip");

const $btnStart = document.getElementById("btnStart");
const $btnEnd = document.getElementById("btnEnd");
const $btnDownload = document.getElementById("btnDownload");

function nowISO(){ return new Date().toISOString(); }

function setLiveChip(){
  if (state.running){
    $liveChip.dataset.live = "true";
    // show last in UTC
    $liveChip.innerHTML = `<span class="liveDot"></span> LIVE • last: ${formatTimeUTC(new Date())}`;
  } else {
    delete $liveChip.dataset.live;
    $liveChip.textContent = "NOT RUNNING";
  }
}

function formatTimeUTC(d){
  // UTC time hh:mm:ss
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
  // show UTC explicitly; keep localTz out of the header to avoid confusion
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
    events: state.events
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
  setLiveChip(); // updates last time
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
    // still allow download if they want
    downloadResults(true);
    return;
  }
  state.running = false;
  state.endedAtISO = nowISO();
  autosave();
  downloadResults(false);
  render();
}

function deriveIntervals(){
  // Produces intervals per question:
  // { qid, value, startISO, endISO }
  const intervals = [];
  const byQ = new Map();

  for (const ev of state.events){
    if (!byQ.has(ev.qid)) byQ.set(ev.qid, []);
    byQ.get(ev.qid).push(ev);
  }

  const endISO = state.running ? nowISO() : (state.endedAtISO || nowISO());

  for (const [qid, evs] of byQ.entries()){
    // ensure chronological
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

function openUploadPage(){
  // Opening in new tab; some browsers might block if not triggered by a user click,
  // so we always also show a clickable button in the UI.
  try{
    window.open(POLYBOX_UPLOAD_URL, "_blank", "noopener");
  }catch{
    // ignore
  }
}

function downloadResults(includeUploadHint){
  const p = safeName(state.fields.participant_number);
  const s = safeName(state.fields.session_number);
  const tISO = nowISO();                // UTC ISO
  const tSafe = tISO.replace(/[:]/g, "-");
  const filename = `live_P${p}_S${s}_${tSafe}.json`;

  const payload = {
    surveyId: state.cfg.surveyId,
    title: state.cfg.title,
    version: state.cfg.version,

    timezone: state.tz,           // "UTC"
    localTimezone: state.localTz, // e.g. "Europe/Zurich"
    userAgent: state.userAgent,

    runningAtDownload: state.running,
    startedAtISO: state.startedAtISO,
    endedAtISO: state.endedAtISO,

    fields: state.fields,
    currentAtDownload: state.current,

    events: state.events,
    intervals: deriveIntervals()
  };

  downloadJSON(filename, payload);

  if (includeUploadHint){
    // Optional: try to open Polybox right away (browser may block popups)
    openUploadPage();

    // Also show an on-page panel so it's always possible without popups
    const subject = encodeURIComponent(`Solskin LIVE logger — P${p} S${s}`);
    const body = encodeURIComponent(
`Hello,

I used the live in-session comfort logger.

Please find the attached results JSON file:
${filename}

Participant: ${state.fields.participant_number}
Session: ${state.fields.session_number}
Downloaded at (UTC): ${tISO}

Thank you.`
    );
    const mailto = `mailto:${EMAIL_TO}?subject=${subject}&body=${body}`;

    // Append an upload helper panel at the top of the card (non-destructive)
    const helper = document.createElement("div");
    helper.className = "summaryBox";
    helper.style.marginTop = "12px";
    helper.innerHTML = `
      <p class="summaryTitle">Upload your downloaded file</p>
      <p class="summaryLine">
        A results file was downloaded: <code>${escapeHTML(filename)}</code><br>
        Preferred: upload it to Polybox. If that does not work, email it to the researcher.
      </p>
      <div class="kv" style="gap:10px">
        <a class="btn" style="text-decoration:none; display:inline-block"
           href="${POLYBOX_UPLOAD_URL}" target="_blank" rel="noopener">
          Upload to Polybox
        </a>
        <a class="btn ghost" style="text-decoration:none; display:inline-block"
           href="${mailto}">
          Email results to ${escapeHTML(EMAIL_TO)}
        </a>
      </div>
    `;

    // Insert right after the "Live status" box if it exists, otherwise top of card
    const grid = $card.querySelector(".summaryGrid");
    if (grid){
      grid.appendChild(helper);
    } else {
      $card.prepend(helper);
    }
  }
}

function render(){
  updateMeta();
  setLiveChip();

  if (!state.cfg){
    $card.innerHTML = `
      <h1 class="h1">Load Live Survey</h1>
      <p class="sub">Select <code>live_survey.json</code>. Keep this tab open during the session.</p>
      <div class="pill"><input id="cfgFile" type="file" accept="application/json" /></div>
      <p class="sub" style="margin-top:12px">If you previously started on this device, it can restore progress.</p>
    `;
    $btnStart.disabled = true;
    $btnEnd.disabled = true;
    $btnDownload.disabled = true;

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
  $btnDownload.disabled = false;

  // Render fields + controls
  const summaryThermal = state.current.thermal_sensation ?? (getQ("thermal_sensation")?.default ?? "—");
  const summaryGlare = state.current.glare_discomfort ?? (getQ("glare_discomfort")?.default ?? "—");
  const glareEnabled = getEnabled(getQ("glare_amount"));
  const summaryGlareAmt = glareEnabled ? (state.current.glare_amount ?? (getQ("glare_amount")?.default ?? "—")) : "—";

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

      // If glare changed to No, disable amount but keep last value (or set to default)
      if (qid === "glare_discomfort" && value === "No"){
        // optional: still log setting to default 1 (comment out if you prefer keeping last)
        // setCurrent("glare_amount", getQ("glare_amount").default ?? 1);
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

// “Download” button now shows upload helper panel (Polybox + email fallback)
$btnDownload.addEventListener("click", () => downloadResults(true));

/* Boot: start with "load config" */
render();

/* utils */
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"
  }[c]));
}
function escapeAttr(s){ return escapeHTML(s).replace(/`/g, "&#96;"); }
