/* Offline Survey Runner (Wrap-up)
   - Offline: participant loads survey.json via file picker
   - Page-by-page, progress bar, local download at end
   - Supported types:
       number, text, singleChoice, slider, likert, rank (drag-and-drop)
   - Timing per question:
       shownAtISO, firstChangedAtISO, answeredAtISO, timeSpentMs

   Wrap-up specifics:
   - Only participant_number (no session_number)
   - Finish screen: Polybox upload button + email fallback
*/

const POLYBOX_UPLOAD_URL = "https://polybox.ethz.ch/index.php/s/2GFCaRHZmgLe6P6";
const EMAIL_TO = "kim@arch.ethz.ch";

const state = {
  survey: null,
  pageIndex: 0,
  answers: {},
  timing: {},            // { qid: { shownAtISO, firstChangedAtISO, answeredAtISO, timeSpentMs } }
  perfShownAt: {},       // { qid: perfNow }
  perfFirstChangedAt: {},// { qid: perfNow }
  startedAtISO: null,
  endedAtISO: null,

  tz: "UTC",
  localTz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  userAgent: navigator.userAgent
};

const $card = document.getElementById("card");
const $meta = document.getElementById("meta");
const $btnBack = document.getElementById("btnBack");
const $btnNext = document.getElementById("btnNext");
const $progressFill = document.getElementById("progressFill");
const $progressText = document.getElementById("progressText");

function nowISO(){ return new Date().toISOString(); }

// ---------- timing ----------
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

function isAnsweredValue(a){
  if (a === undefined || a === null) return false;
  if (Array.isArray(a)) return a.length > 0;
  if (a === "") return false;
  if (typeof a === "number" && Number.isNaN(a)) return false;
  return true;
}

function finalizeQuestionTime(qid){
  const a = state.answers[qid];
  if (!isAnsweredValue(a)) return;

  if (!state.timing[qid]) state.timing[qid] = {};
  if (!state.timing[qid].shownAtISO) ensureTimingShown(qid);
  state.timing[qid].answeredAtISO = nowISO();

  const t0 = state.perfShownAt[qid];
  if (typeof t0 === "number"){
    state.timing[qid].timeSpentMs = Math.round(Math.max(0, performance.now() - t0));
  }
}

// ---------- helpers ----------
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

// ---------- load screen ----------
function renderLoadScreen(errMsg = null){
  $meta.textContent = `Timezone: ${state.tz}`;
  updateProgress();

  $card.innerHTML = `
    <h1 class="h1">Load Wrap-up Survey</h1>
    <p class="sub">Select the <code>survey.json</code> file provided by the researcher.</p>

    <div class="pill">
      <input id="surveyFile" type="file" accept="application/json" />
    </div>

    ${errMsg ? `<div class="err" style="margin-top:12px">${escapeHTML(errMsg)}</div>` : ""}

    <div class="small">
      Tip: This survey does not upload anything automatically.
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

// ---------- main render ----------
function render(){
  const s = state.survey;
  const page = s.pages[state.pageIndex];
  const vq = visibleQuestionsOnPage();

  const p = state.answers["participant_number"];
  const ps = p ? ` • P${p}` : "";

  $meta.textContent = `${s.title || "Survey"} • Page ${state.pageIndex + 1}/${s.pages.length}${ps} • ${state.tz}`;
  updateProgress();

  // mark shown times + initialize rank answers when first shown
  for (const q of vq) {
    ensureTimingShown(q.id);
    if (q.type === "rank") ensureRankInit(q);
  }

  $card.innerHTML = `
    <h1 class="h1">${escapeHTML(page.title || s.title || "Survey")}</h1>
    ${page.subtitle ? `<p class="sub">${escapeHTML(page.subtitle)}</p>` : (s.intro ? `<p class="sub">${escapeHTML(s.intro)}</p>` : `<p class="sub"></p>`)}
    <div id="qWrap">
      ${vq.map(renderQuestion).join("")}
    </div>
    <div id="err" class="err" style="display:none"></div>
  `;

  // wire DnD after HTML is in DOM
  wireRankDnD();

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
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
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

  if (q.type === "rank"){
    const order = Array.isArray(val) ? val : (q.items || []);
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
        <div class="rankWrap">
          <div class="rankHint">Drag to reorder • Top = most important</div>
          <ul class="rankList" data-qid="${escapeAttr(q.id)}" aria-label="Ranking list">
            ${order.map((item, idx) => `
              <li class="rankItem"
                  draggable="true"
                  data-qid="${escapeAttr(q.id)}"
                  data-index="${idx}">
                <span class="rankHandle" aria-hidden="true">⠿</span>
                <span class="rankNum">${idx + 1}</span>
                <span class="rankText">${escapeHTML(String(item))}</span>
              </li>
            `).join("")}
          </ul>
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
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
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
          ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
          <textarea class="input" placeholder="${escapeAttr(placeholder)}"
            oninput="onText('${escapeJS(q.id)}', this.value)">${escapeHTML(val ?? "")}</textarea>
        </div>
      `;
    }
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
        <input class="input" type="text" placeholder="${escapeAttr(placeholder)}"
          value="${escapeAttr(val ?? "")}"
          oninput="onText('${escapeJS(q.id)}', this.value)">
      </div>
    `;
  }

  if (q.type === "number"){
    const min = q.min ?? "";
    const max = q.max ?? "";
    const step = q.step ?? "any";
    const placeholder = q.placeholder || "";
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
        <input class="input" type="number" min="${min}" max="${max}" step="${step}"
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

// ---------- rank helpers ----------
function ensureRankInit(q){
  if (state.answers[q.id] !== undefined) return;
  const items = Array.isArray(q.items) ? q.items : [];
  state.answers[q.id] = items.slice(); // default order = given order
}

function reorderArray(arr, fromIdx, toIdx){
  const a = arr.slice();
  const [moved] = a.splice(fromIdx, 1);
  a.splice(toIdx, 0, moved);
  return a;
}

function wireRankDnD(){
  const lists = document.querySelectorAll(".rankList");

  lists.forEach(list => {
    const qid = list.dataset.qid;
    let dragFrom = null;

    list.querySelectorAll(".rankItem").forEach(li => {
      li.addEventListener("dragstart", (e) => {
        dragFrom = Number(li.dataset.index);
        li.classList.add("isDragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragFrom));
      });

      li.addEventListener("dragend", () => {
        li.classList.remove("isDragging");
        list.querySelectorAll(".rankItem").forEach(x => x.classList.remove("dropAbove", "dropBelow"));
      });

      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        const rect = li.getBoundingClientRect();
        const isTopHalf = (e.clientY - rect.top) < rect.height / 2;

        list.querySelectorAll(".rankItem").forEach(x => x.classList.remove("dropAbove", "dropBelow"));
        li.classList.add(isTopHalf ? "dropAbove" : "dropBelow");
      });

      li.addEventListener("dragleave", () => {
        li.classList.remove("dropAbove", "dropBelow");
      });

      li.addEventListener("drop", (e) => {
        e.preventDefault();

        const fromIdx = dragFrom ?? Number(e.dataTransfer.getData("text/plain"));
        const toIdxRaw = Number(li.dataset.index);

        const rect = li.getBoundingClientRect();
        const isTopHalf = (e.clientY - rect.top) < rect.height / 2;
        const toIdx = isTopHalf ? toIdxRaw : (toIdxRaw + 1);

        const order = Array.isArray(state.answers[qid]) ? state.answers[qid] : [];
        const clampedTo = Math.max(0, Math.min(order.length, toIdx));
        const fromClamped = Math.max(0, Math.min(order.length - 1, fromIdx));

        // dropping to same position -> ignore
        if (fromClamped === clampedTo || fromClamped + 1 === clampedTo) {
          render();
          return;
        }

        markFirstChanged(qid);

        // adjust target if moving downward because removing shifts indices
        const adjustedTo = (clampedTo > fromClamped) ? (clampedTo - 1) : clampedTo;
        state.answers[qid] = reorderArray(order, fromClamped, adjustedTo);
        render();
      });
    });
  });
}

// ---------- answer handlers ----------
window.onSingleChoice = (qid, value) => { markFirstChanged(qid); state.answers[qid] = value; render(); };
window.onSlider       = (qid, value, valueSpan) => { markFirstChanged(qid); state.answers[qid] = value; if (valueSpan) valueSpan.textContent = String(value); };
window.onText         = (qid, value) => { markFirstChanged(qid); state.answers[qid] = value; };
window.onNumber       = (qid, value) => { markFirstChanged(qid); state.answers[qid] = (value === "") ? "" : Number(value); };

// ---------- nav + validation ----------
function validatePage(){
  const missing = [];

  for (const q of visibleQuestionsOnPage()){
    if (!q.required) continue;

    const a = state.answers[q.id];

    // rank must have all items present
    if (q.type === "rank"){
      const n = Array.isArray(q.items) ? q.items.length : 0;
      if (!Array.isArray(a) || a.length !== n) missing.push(q.id);
      continue;
    }

    if (!isAnsweredValue(a)) missing.push(q.id);
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
  const safeParticipant = String(participant).replace(/[^a-zA-Z0-9_-]/g, "");
  const safeTime = state.endedAtISO.replace(/[:]/g, "-");
  const filename = `wrapup_P${safeParticipant}_${safeTime}.json`;

  const payload = {
    surveyId: state.survey.surveyId,
    title: state.survey.title,
    version: state.survey.version,
    startedAtISO: state.startedAtISO,
    endedAtISO: state.endedAtISO,
    timezone: state.tz,
    localTimezone: state.localTz,
    userAgent: state.userAgent,
    answers: state.answers,
    timing: state.timing
  };

  downloadJSON(filename, payload);

  const subject = encodeURIComponent(`Solskin WRAP-UP survey — P${safeParticipant}`);
  const body = encodeURIComponent(
`Hello,

I completed the Solskin wrap-up survey.

Please find the attached results JSON file:
${filename}

Participant: ${participant}
Completed at (UTC): ${state.endedAtISO}

Thank you.`
  );
  const mailto = `mailto:${EMAIL_TO}?subject=${subject}&body=${body}`;

  $card.innerHTML = `
    <h1 class="h1">Done</h1>
    <p class="sub">
      A results file was downloaded: <code>${escapeHTML(filename)}</code><br>
      Please upload it using the button below (preferred).
    </p>

    <div class="choices" style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap">
      <a class="btn" style="text-decoration:none; display:inline-block"
         href="${POLYBOX_UPLOAD_URL}" target="_blank" rel="noopener">
        Upload results to Polybox
      </a>

      <a class="btn ghost" style="text-decoration:none; display:inline-block"
         href="${mailto}">
        Email results to ${escapeHTML(EMAIL_TO)}
      </a>
    </div>

    <p class="sub" style="margin-top:12px">
      On Polybox, choose the downloaded JSON file (<code>${escapeHTML(filename)}</code>) and upload it.
    </p>
  `;

  $btnBack.disabled = true;
  $btnNext.disabled = true;
  updateProgress();
});

// ---------- utilities ----------
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"
  }[c]));
}
function escapeAttr(s){ return escapeHTML(s).replace(/`/g, "&#96;"); }
function escapeJS(s){ return String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'"); }

// ---------- boot ----------
renderLoadScreen();
