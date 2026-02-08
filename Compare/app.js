/* Offline Survey Runner (no fetch) — COMPARE version
   - Participant selects survey JSON file (offline friendly)
   - Renders page-by-page
   - Progress bar
   - Supports: number, text, singleChoice, slider, likert, timer
   - Timing per question: shownAtISO, firstChangedAtISO, answeredAtISO, timeSpentMs

   Updates in this version:
   - Adds "timer" question type:
       * Start button runs multi-phase timer (e.g., 2 min Mode 1 → auto 2 min Mode 2)
       * Marks answer as "completed" when finished (so required validation can pass)
       * Reset clears completion
   - Download filename starts with participant number:
       results_P{p}_S{s}_{time}.json
   - End screen includes "Upload to Polybox" button:
       https://polybox.ethz.ch/index.php/s/PdGiTfy2nydpGo9
*/

const POLYBOX_UPLOAD_URL = "https://polybox.ethz.ch/index.php/s/PdGiTfy2nydpGo9";

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
  userAgent: navigator.userAgent,

  // Timer runtime (not exported)
  timerRuntime: {}  // { qid: { running, done, phaseIndex, phaseRemaining, totalRemaining, totalSeconds, totalElapsed, intervalId, t0ms } }
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
  // Support both showIf and enabledIf (some of your surveys use showIf)
  if (q.showIf){
    const { questionId, equals } = q.showIf;
    return state.answers[questionId] === equals;
  }
  if (q.enabledIf){
    const { questionId, equals } = q.enabledIf;
    return state.answers[questionId] === equals;
  }
  return true;
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
    <p class="sub">Select the <code>comparison.json</code> (or <code>survey.json</code>) file provided by the researcher.</p>

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
  state.timerRuntime = {};

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

  // page intro: show intro only on first page by default (same as your previous behavior)
  const introHtml = (state.pageIndex === 0 && s.intro)
    ? `<p class="sub">${escapeHTML(s.intro)}</p>`
    : (page.subtitle ? `<p class="sub">${escapeHTML(page.subtitle)}</p>` : `<p class="sub"></p>`);

  $card.innerHTML = `
    <h1 class="h1">${escapeHTML(page.title || s.title || "Survey")}</h1>
    ${introHtml}
    <div id="qWrap">
      ${vq.map(renderQuestion).join("")}
    </div>
    <div id="err" class="err" style="display:none"></div>
  `;

  $btnBack.disabled = state.pageIndex === 0;
  $btnNext.disabled = false;
  $btnNext.textContent = (state.pageIndex === s.pages.length - 1) ? "Finish & Download" : "Next";

  // After rendering, re-bind timer buttons and resume any active timer UI
  hookUpTimersOnPage(vq);
}

/* ----------------------------- Timer logic ---------------------------- */

function getTimerPhases(q){
  const phases = Array.isArray(q.phases) && q.phases.length ? q.phases : [
    { label: "Mode 1", seconds: 120 },
    { label: "Mode 2", seconds: 120 }
  ];
  // sanitize
  return phases.map(p => ({
    label: String(p.label ?? "Phase"),
    seconds: clampInt(p.seconds ?? 0, 0, 24 * 3600)
  }));
}

function totalSecondsForPhases(phases){
  return phases.reduce((acc, p) => acc + (p.seconds || 0), 0);
}

function formatMMSS(sec){
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function computePhaseFromElapsed(phases, elapsed){
  let acc = 0;
  for (let i = 0; i < phases.length; i++){
    const dur = phases[i].seconds || 0;
    if (elapsed < acc + dur){
      const phaseElapsed = elapsed - acc;
      const phaseRemaining = Math.max(0, dur - phaseElapsed);
      return { phaseIndex: i, phaseElapsed, phaseRemaining, acc };
    }
    acc += dur;
  }
  // beyond end
  const lastIdx = Math.max(0, phases.length - 1);
  return { phaseIndex: lastIdx, phaseElapsed: phases[lastIdx]?.seconds || 0, phaseRemaining: 0, acc: totalSecondsForPhases(phases) };
}

function ensureTimerRuntime(qid){
  if (!state.timerRuntime[qid]) state.timerRuntime[qid] = {
    running: false,
    done: false,
    phaseIndex: 0,
    phaseRemaining: 0,
    totalRemaining: 0,
    totalSeconds: 0,
    totalElapsed: 0,
    intervalId: null,
    t0ms: null
  };
  return state.timerRuntime[qid];
}

function stopTimer(qid){
  const rt = ensureTimerRuntime(qid);
  if (rt.intervalId){
    clearInterval(rt.intervalId);
  }
  rt.intervalId = null;
  rt.running = false;
  rt.t0ms = null;
}

function updateTimerUI(q, phases){
  const qid = q.id;
  const rt = ensureTimerRuntime(qid);

  const $root = document.querySelector(`.q[data-qid="${cssEscape(qid)}"]`);
  if (!$root) return;

  const $status = $root.querySelector(`[data-timer-status="${cssEscape(qid)}"]`);
  const $sub = $root.querySelector(`[data-timer-sub="${cssEscape(qid)}"]`);
  const $barInner = $root.querySelector(`[data-timer-bar="${cssEscape(qid)}"]`);
  const $start = $root.querySelector(`[data-timer-start="${cssEscape(qid)}"]`);
  const $reset = $root.querySelector(`[data-timer-reset="${cssEscape(qid)}"]`);

  const total = rt.totalSeconds || totalSecondsForPhases(phases);
  const elapsed = rt.totalElapsed || 0;

  const totalRemaining = Math.max(0, total - elapsed);
  const info = computePhaseFromElapsed(phases, elapsed);
  const phase = phases[Math.min(info.phaseIndex, phases.length - 1)];

  if (rt.done){
    if ($status) $status.textContent = "Completed ✓";
    if ($sub) $sub.textContent = "Now answer the questions below.";
    if ($barInner) $barInner.style.width = "100%";
    if ($start) $start.disabled = true;
    if ($reset) $reset.disabled = false;
    return;
  }

  if (!rt.running){
    if ($status) $status.textContent = "Ready";
    if ($sub) $sub.textContent = "Press Start when the researcher says to begin.";
    if ($barInner) $barInner.style.width = `${Math.min(100, Math.max(0, (elapsed / Math.max(1, total)) * 100)).toFixed(1)}%`;
    if ($start) $start.disabled = false;
    if ($reset) $reset.disabled = (elapsed === 0);
    return;
  }

  // running
  if ($status) $status.textContent = `Running: ${phase.label}`;
  if ($sub) $sub.textContent = `Time left in ${phase.label}: ${formatMMSS(info.phaseRemaining)}  •  Total left: ${formatMMSS(totalRemaining)}`;

  const pct = Math.min(100, Math.max(0, (elapsed / Math.max(1, total)) * 100));
  if ($barInner) $barInner.style.width = `${pct.toFixed(1)}%`;
  if ($start) $start.disabled = true;
  if ($reset) $reset.disabled = false;
}

function completeTimer(q){
  const qid = q.id;
  stopTimer(qid);

  const rt = ensureTimerRuntime(qid);
  rt.running = false;
  rt.done = true;

  markFirstChanged(qid);
  state.answers[qid] = "completed";

  // finalize timing for timer question now (so answeredAtISO is set)
  finalizeQuestionTime(qid);

  const phases = getTimerPhases(q);
  updateTimerUI(q, phases);

  // Re-render once so your required validation / styling is consistent
  render();
}

function startTimer(q){
  const qid = q.id;
  const phases = getTimerPhases(q);
  const total = totalSecondsForPhases(phases);

  const rt = ensureTimerRuntime(qid);

  // Reset any previous run
  stopTimer(qid);

  rt.running = true;
  rt.done = false;
  rt.totalSeconds = total;
  rt.totalElapsed = 0;
  rt.t0ms = performance.now();

  // clear completion answer if any
  if (state.answers[qid] === "completed") delete state.answers[qid];

  // mark shown/firstChanged when start is pressed (counts as interaction)
  ensureTimingShown(qid);
  markFirstChanged(qid);

  rt.intervalId = setInterval(() => {
    const elapsed = Math.floor((performance.now() - rt.t0ms) / 1000);
    rt.totalElapsed = Math.min(total, Math.max(0, elapsed));

    // Update UI live without full re-render
    updateTimerUI(q, phases);

    if (rt.totalElapsed >= total){
      completeTimer(q);
    }
  }, 250);

  updateTimerUI(q, phases);
}

function resetTimer(q){
  const qid = q.id;
  stopTimer(qid);

  const rt = ensureTimerRuntime(qid);
  rt.running = false;
  rt.done = false;
  rt.totalSeconds = 0;
  rt.totalElapsed = 0;

  // Clear answer so required logic blocks Next again
  delete state.answers[qid];

  // Reset timing fields for this qid (optional, but keeps things clean)
  // If you'd rather keep shownAtISO, comment these out.
  if (state.timing[qid]){
    delete state.timing[qid].firstChangedAtISO;
    delete state.timing[qid].answeredAtISO;
    delete state.timing[qid].timeSpentMs;
  }

  render();
}

function hookUpTimersOnPage(visibleQs){
  for (const q of visibleQs){
    if (q.type !== "timer") continue;
    const qid = q.id;
    const $root = document.querySelector(`.q[data-qid="${cssEscape(qid)}"]`);
    if (!$root) continue;

    const $start = $root.querySelector(`[data-timer-start="${cssEscape(qid)}"]`);
    const $reset = $root.querySelector(`[data-timer-reset="${cssEscape(qid)}"]`);

    if ($start){
      $start.onclick = () => startTimer(q);
    }
    if ($reset){
      $reset.onclick = () => resetTimer(q);
    }

    // If answer already completed (e.g., user navigated back), reflect it
    const rt = ensureTimerRuntime(qid);
    if (state.answers[qid] === "completed") rt.done = true;

    updateTimerUI(q, getTimerPhases(q));
  }
}

/* ---------------------------- Rendering ------------------------------ */

function renderQuestion(q){
  const required = q.required ? `<span class="req">*</span>` : "";
  const val = state.answers[q.id];

  if (q.type === "timer"){
    const phases = getTimerPhases(q);
    const total = totalSecondsForPhases(phases);
    const isDone = (val === "completed");

    const label = q.prompt || "Exposure timer";
    const help = q.help || "";
    const phaseLabels = phases.map(p => `${p.label} (${formatMMSS(p.seconds)})`).join(" → ");

    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(label)} ${required}</label>
        ${help ? `<div class="small" style="margin-top:6px">${escapeHTML(help)}</div>` : ""}
        <div class="pill" style="margin-top:10px">
          <div style="font-weight:600" data-timer-status="${escapeAttr(q.id)}">${isDone ? "Completed ✓" : "Ready"}</div>
          <div class="small" style="margin-top:6px" data-timer-sub="${escapeAttr(q.id)}">
            ${isDone ? "Now answer the questions below." : "Press Start when the researcher says to begin."}
          </div>
          <div class="small" style="margin-top:8px; opacity:.85">
            Sequence: ${escapeHTML(phaseLabels)} • Total: ${escapeHTML(formatMMSS(total))}
          </div>

          <div style="height:10px; border-radius:999px; background: rgba(0,0,0,0.08); overflow:hidden; margin-top:10px;">
            <div data-timer-bar="${escapeAttr(q.id)}" style="height:100%; width:${isDone ? "100" : "0"}%; background: rgba(0,0,0,0.35)"></div>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; align-items:center">
            <button type="button" class="btn" data-timer-start="${escapeAttr(q.id)}" ${isDone ? "disabled" : ""}>
              Start
            </button>
            <button type="button" class="btn ghost" data-timer-reset="${escapeAttr(q.id)}" ${isDone ? "" : "disabled"}>
              Reset
            </button>
          </div>
        </div>
      </div>
    `;
  }

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

    // keep original labels if provided
    const labels = (q.labels && Array.isArray(q.labels) && q.labels.length === points)
      ? q.labels
      : Array.from({length: points}, (_, i) => String(i + 1));

    // values can be strings or numbers
    const values = (q.values && Array.isArray(q.values) && q.values.length === points)
      ? q.values
      : labels;

    const gridClass = points === 5 ? "n5" : (points === 7 ? "n7" : "");

    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>

        <div class="likert">
          <div class="likertScale ${gridClass}" style="${gridClass ? "" : `grid-template-columns: repeat(${points}, minmax(0, 1fr));`}">
            ${labels.map((lab, idx) => {
              const v = values[idx];
              const isChecked = (val === v);
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

  let v;
  try { v = JSON.parse(valueJson); }
  catch { v = valueJson; }

  state.answers[qid] = v;
  render();
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
  // Stop any running timers on this page to avoid background intervals
  for (const q of visibleQuestionsOnPage()){
    if (q.type === "timer") stopTimer(q.id);
  }

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
    // Stop any running timers on this page to avoid background intervals
    for (const q of visibleQuestionsOnPage()){
      if (q.type === "timer") stopTimer(q.id);
    }

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

  $card.innerHTML = `
    <h1 class="h1">Done</h1>
    <p class="sub">
      A results file was downloaded: <code>${escapeHTML(filename)}</code><br>
      Please upload it using the button below.
    </p>

    <div class="choices" style="margin-top:12px">
      <a class="btn" style="text-decoration:none; display:inline-block"
         href="${POLYBOX_UPLOAD_URL}" target="_blank" rel="noopener">
        Upload results to Polybox
      </a>
    </div>

    <p class="sub" style="margin-top:12px">
      On the Polybox page, choose the downloaded JSON file (<code>${escapeHTML(filename)}</code>) and upload it.
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

// For querySelector attribute matching with arbitrary ids
function cssEscape(s){
  // Basic safe escape for attribute selectors
  return String(s).replace(/"/g, '\\"');
}

/* ------------------------------ Boot --------------------------------- */

function boot(){
  renderLoadScreen();
}
boot();
