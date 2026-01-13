/* Offline Survey Runner (no fetch)
   - Participant selects survey JSON file (offline friendly)
   - Renders page-by-page
   - Progress bar
   - Supports: number, text, singleChoice, slider, likert
   - Timing per question: shownAtISO, firstChangedAtISO, answeredAtISO, timeSpentMs

   Updates in this version:
   - Download filename includes participant_number + session_number: results_P{p}_S{s}_{time}.json
   - End screen includes "Email results" (mailto) to kim@arch.ethz.ch
   - Likert keeps your original label/value strings (e.g., "Very satisfied") from survey.json
*/

const state = {
  survey: null,
  pageIndex: 0,
  answers: {},
  timing: {},       // { qid: { shownAtISO, firstChangedAtISO, answeredAtISO, timeSpentMs } }
  perfShownAt: {},  // { qid: perfNow }
  perfFirstChangedAt: {}, // { qid: perfNow }
  startedAtISO: null,
  endedAtISO: null,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  userAgent: navigator.userAgent
};

const $card = document.getElementById("card");
const $meta = document.getElementById("meta");
const $btnBack = document.getElementById("btnBack");
const $btnNext = document.getElementById("btnNext");
const $progressFill = document.getElementById("progressFill");
const $progressText = document.getElementById("progressText");

function nowISO(){ return new Date().toISOString(); }

function ensureTimingShown(qid){
  if (!state.timing[qid]) state.timing[qid] = {};
  if (!state.timing[qid].shownAtISO){
    state.timing[qid].shownAtISO = nowISO();
    state.perfShownAt[qid] = performance.now();
  }
}

function markFirstChanged(qid){
  if (!state.timing[qid]) state.timing[qid] = {};
  if (!state.timing[qid].firstChangedAtISO){
    state.timing[qid].firstChangedAtISO = nowISO();
    state.perfFirstChangedAt[qid] = performance.now();
  }
}

function finalizeQuestionTime(qid){
  const a = state.answers[qid];
  const hasAnswer = !(a === undefined || a === null || a === "" || (typeof a === "number" && Number.isNaN(a)));
  if (!hasAnswer) return;

  if (!state.timing[qid]) state.timing[qid] = {};
  if (!state.timing[qid].shownAtISO) ensureTimingShown(qid);
  state.timing[qid].answeredAtISO = nowISO();

  const t0 = state.perfShownAt[qid];
  if (typeof t0 === "number"){
    state.timing[qid].timeSpentMs = Math.round(Math.max(0, performance.now() - t0));
  }
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

function isVisible(q){
  if (!q.showIf) return true;
  const { questionId, equals } = q.showIf;
  return state.answers[questionId] === equals;
}

function visibleQuestionsOnPage(){
  const page = state.survey.pages[state.pageIndex];
  return page.questions.filter(isVisible);
}

function updateProgress(){
  if (!state.survey) {
    $progressFill.style.width = "0%";
    $progressText.textContent = "0%";
    return;
  }
  const total = state.survey.pages.length;
  const pct = Math.round(((state.pageIndex + 1) / total) * 100);
  $progressFill.style.width = `${pct}%`;
  $progressText.textContent = `${pct}%`;
}

function renderLoadScreen(errMsg = null){
  $meta.textContent = `Timezone: ${state.tz || "unknown"}`;
  updateProgress();

  $card.innerHTML = `
    <h1 class="h1">Load Survey</h1>
    <p class="sub">Select the <code>survey.json</code> file provided by the researcher.</p>

    <div class="pill">
      <input id="surveyFile" type="file" accept="application/json" />
    </div>

    ${errMsg ? `<div class="err" style="margin-top:12px">${escapeHTML(errMsg)}</div>` : ""}

    <div class="small">
      Tip: If your browser warns about local files, that’s okay — this survey does not upload anything.
      It only downloads a results file at the end.
    </div>
  `;

  $btnBack.disabled = true;
  $btnNext.disabled = true;

  const fileInput = document.getElementById("surveyFile");
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try{
      const text = await file.text();
      const json = JSON.parse(text);
      loadSurvey(json);
    }catch(e){
      renderLoadScreen(`Could not read this JSON file: ${e.message || String(e)}`);
    }
  });
}

function loadSurvey(survey){
  // basic validation
  if (!survey || !Array.isArray(survey.pages)) {
    renderLoadScreen("Invalid survey JSON: missing 'pages'.");
    return;
  }
  state.survey = survey;
  state.startedAtISO = nowISO();
  state.pageIndex = 0;
  state.answers = {};
  state.timing = {};
  state.perfShownAt = {};
  state.perfFirstChangedAt = {};

  render();
}

function render(){
  const s = state.survey;
  const page = s.pages[state.pageIndex];
  const vq = visibleQuestionsOnPage();

  // include participant/session in the header meta if already answered
  const p = state.answers["participant_number"];
  const sess = state.answers["session_number"];
  const ps = (p || sess) ? ` • P${p ?? "?"} / S${sess ?? "?"}` : "";

  $meta.textContent = `${s.title || "Survey"} • Page ${state.pageIndex + 1}/${s.pages.length}${ps} • ${state.tz || "TZ?"}`;
  updateProgress();

  // mark shown times
  for (const q of vq) ensureTimingShown(q.id);

  $card.innerHTML = `
    <h1 class="h1">${escapeHTML(page.title || s.title || "Survey")}</h1>
    ${s.intro ? `<p class="sub">${escapeHTML(s.intro)}</p>` : `<p class="sub"></p>`}
    <div id="qWrap">
      ${vq.map(renderQuestion).join("")}
    </div>
    <div id="err" class="err" style="display:none"></div>
  `;

  $btnBack.disabled = state.pageIndex === 0;
  $btnNext.disabled = false;
  $btnNext.textContent = (state.pageIndex === s.pages.length - 1) ? "Finish & Download" : "Next";
}

function renderQuestion(q){
  const required = q.required ? `<span class="req">*</span>` : "";
  const val = state.answers[q.id];

  if (q.type === "singleChoice"){
    const opts = q.options || [];
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        <div class="choices">
          ${opts.map((opt, idx) => {
            const checked = (val === opt) ? "checked" : "";
            const rid = `${q.id}__${idx}`;
            return `
              <label class="choice" for="${escapeAttr(rid)}">
                <input id="${escapeAttr(rid)}" type="radio" name="${escapeAttr(q.id)}"
                  value="${escapeAttr(opt)}" ${checked}
                  onchange="onSingleChoice('${escapeJS(q.id)}', this.value)">
                <span>${escapeHTML(opt)}</span>
              </label>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  if (q.type === "likert"){
    const points = clampInt(q.points ?? 7, 2, 11);

    // IMPORTANT: We keep your original labels (e.g., "Very satisfied") if provided
    const labels = (q.labels && Array.isArray(q.labels) && q.labels.length === points)
      ? q.labels
      : Array.from({length: points}, (_, i) => String(i + 1));

    // Values can be strings (e.g., "Very satisfied") or numbers (e.g., 0,10,...)
    const values = (q.values && Array.isArray(q.values) && q.values.length === points)
      ? q.values
      : labels;

    // For 7 or 5 we can use CSS helpers; otherwise fallback to inline grid
    const gridClass = points === 5 ? "n5" : (points === 7 ? "n7" : "");

    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>

        <div class="likert">
          <div class="likertScale ${gridClass}" style="${gridClass ? "" : `grid-template-columns: repeat(${points}, minmax(0, 1fr));`}">
            ${labels.map((lab, idx) => {
              const v = values[idx];
              const isChecked = (val === v);
              // We pass the value through JSON so numbers stay numbers and strings stay strings.
              const vJson = JSON.stringify(v);
              return `
                <label class="likertBtn" data-checked="${isChecked ? "true" : "false"}">
                  <input type="radio" name="${escapeAttr(q.id)}" value="${escapeAttr(vJson)}"
                    ${isChecked ? "checked" : ""}
                    onchange="onLikert('${escapeJS(q.id)}', this.value)">
                  <div>${escapeHTML(String(lab))}</div>
                </label>
              `;
            }).join("")}
          </div>

          <div class="likertLegend">
            <span>${escapeHTML(q.minLabel || "")}</span>
            <span>${escapeHTML(q.maxLabel || "")}</span>
          </div>
        </div>
      </div>
    `;
  }

  if (q.type === "slider"){
    const min = q.min ?? 0;
    const max = q.max ?? 100;
    const step = q.step ?? 1;
    const cur = (typeof val === "number") ? val : (q.default ?? Math.round((min + max) / 2));
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        <div class="sliderRow">
          <input type="range" min="${min}" max="${max}" step="${step}" value="${cur}"
            oninput="onSlider('${escapeJS(q.id)}', Number(this.value), this.nextElementSibling)">
          <span class="sliderValue">${escapeHTML(String(cur))}</span>
        </div>
        <div class="sliderLabels">
          <span>${escapeHTML(q.minLabel || String(min))}</span>
          <span>${escapeHTML(q.maxLabel || String(max))}</span>
        </div>
      </div>
    `;
  }

  if (q.type === "text"){
    const multiline = !!q.multiline;
    const placeholder = q.placeholder || "";
    if (multiline){
      return `
        <div class="q" data-qid="${escapeAttr(q.id)}">
          <label class="title">${escapeHTML(q.prompt)} ${required}</label>
          <textarea class="input" placeholder="${escapeAttr(placeholder)}"
            oninput="onText('${escapeJS(q.id)}', this.value)">${escapeHTML(val ?? "")}</textarea>
        </div>
      `;
    }
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        <input class="input" type="text" placeholder="${escapeAttr(placeholder)}"
          value="${escapeAttr(val ?? "")}"
          oninput="onText('${escapeJS(q.id)}', this.value)">
      </div>
    `;
  }

  if (q.type === "number"){
    const min = q.min ?? "";
    const step = q.step ?? "any";
    const placeholder = q.placeholder || "";
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        <input class="input" type="number" min="${min}" step="${step}"
          placeholder="${escapeAttr(placeholder)}"
          value="${escapeAttr(val ?? "")}"
          oninput="onNumber('${escapeJS(q.id)}', this.value)">
      </div>
    `;
  }

  return `
    <div class="q" data-qid="${escapeAttr(q.id)}">
      <label class="title">${escapeHTML(q.prompt)} ${q.required ? `<span class="req">*</span>` : ""}</label>
      <div class="err">Unsupported question type: ${escapeHTML(q.type)}</div>
    </div>
  `;
}

/* ---------- Answer handlers (global for inline HTML handlers) ---------- */

window.onSingleChoice = (qid, value) => {
  markFirstChanged(qid);
  state.answers[qid] = value;

  // Example: if glare_experience becomes "No", clear glare_level (optional)
  if (qid === "glare_experience" && value === "No"){
    delete state.answers["glare_level"];
  }
  render(); // re-render for showIf changes
};

window.onLikert = (qid, valueJson) => {
  markFirstChanged(qid);

  // Keep exact type from survey.json values:
  // - if values are strings: "Very satisfied"
  // - if values are numbers: 0, 10, 100, etc.
  let v;
  try { v = JSON.parse(valueJson); }
  catch { v = valueJson; }

  state.answers[qid] = v;

  render(); // update selected styling
};

window.onSlider = (qid, value, valueSpan) => {
  markFirstChanged(qid);
  state.answers[qid] = value;
  if (valueSpan) valueSpan.textContent = String(value);
};

window.onText = (qid, value) => {
  markFirstChanged(qid);
  state.answers[qid] = value;
};

window.onNumber = (qid, value) => {
  markFirstChanged(qid);
  state.answers[qid] = (value === "") ? "" : Number(value);
};

/* ------------------------------ Nav ---------------------------------- */

function validatePage(){
  const missing = [];
  for (const q of visibleQuestionsOnPage()){
    if (!q.required) continue;
    const a = state.answers[q.id];
    const empty = (a === undefined || a === null || a === "" || (typeof a === "number" && Number.isNaN(a)));
    if (empty) missing.push(q.id);
  }

  if (missing.length){
    const $err = document.getElementById("err");
    $err.style.display = "block";
    $err.textContent = "Please answer all required questions (*) before continuing.";
    return false;
  }
  return true;
}

function finalizeVisibleTimingsOnPage(){
  for (const q of visibleQuestionsOnPage()){
    finalizeQuestionTime(q.id);
  }
}

$btnBack.addEventListener("click", () => {
  finalizeVisibleTimingsOnPage();
  state.pageIndex = Math.max(0, state.pageIndex - 1);
  render();
});

$btnNext.addEventListener("click", () => {
  if (!state.survey) return;

  if (!validatePage()) return;
  finalizeVisibleTimingsOnPage();

  const last = state.pageIndex === state.survey.pages.length - 1;
  if (!last){
    state.pageIndex += 1;
    render();
    return;
  }

  // finish
  state.endedAtISO = nowISO();

  const participant = state.answers["participant_number"] ?? "NA";
  const session = state.answers["session_number"] ?? "NA";

  // sanitize for filename safety
  const safeParticipant = String(participant).replace(/[^a-zA-Z0-9_-]/g, "");
  const safeSession = String(session).replace(/[^a-zA-Z0-9_-]/g, "");

  const safeTime = state.endedAtISO.replace(/[:]/g, "-");
  const filename = `results_P${safeParticipant}_S${safeSession}_${safeTime}.json`;

  const payload = {
    surveyId: state.survey.surveyId,
    title: state.survey.title,
    version: state.survey.version,
    startedAtISO: state.startedAtISO,
    endedAtISO: state.endedAtISO,
    timezone: state.tz,
    userAgent: state.userAgent,
    answers: state.answers,
    timing: state.timing
  };

  downloadJSON(filename, payload);

  // Mailto helper (cannot auto-attach; user attaches the downloaded JSON)
  const to = "kim@arch.ethz.ch";
  const subject = encodeURIComponent(`Solskin survey results — P${safeParticipant} S${safeSession}`);
  const body = encodeURIComponent(
`Hello,

I completed the Solskin post-session survey.

Please find the attached results JSON file:
${filename}

Participant: ${participant}
Session: ${session}
Completed at (UTC): ${state.endedAtISO}

Thank you.`
  );
  const mailto = `mailto:${to}?subject=${subject}&body=${body}`;

  $card.innerHTML = `
    <h1 class="h1">Done</h1>
    <p class="sub">
      A results file was downloaded: <code>${escapeHTML(filename)}</code><br>
      Please send it back to the researcher.
    </p>

    <div class="choices" style="margin-top:12px">
      <a class="btn" style="text-decoration:none; display:inline-block" href="${mailto}">
        Email results to kim@arch.ethz.ch
      </a>
    </div>

    <p class="sub" style="margin-top:12px">
      In the email, attach the downloaded JSON file and send.
    </p>
  `;
  $btnBack.disabled = true;
  $btnNext.disabled = true;
  updateProgress();
});

/* ---------------------------- Utilities ------------------------------ */

function clampInt(x, lo, hi){
  const n = Math.round(Number(x));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"
  }[c]));
}
function escapeAttr(s){ return escapeHTML(s).replace(/`/g, "&#96;"); }
function escapeJS(s){ return String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'"); }

/* ------------------------------ Boot --------------------------------- */

function boot(){
  renderLoadScreen();
}
boot();