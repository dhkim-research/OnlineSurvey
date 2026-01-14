/* Offline Baseline Survey Runner (no fetch)
   - Load survey.json via file picker (offline friendly)
   - Page-by-page
   - Supports:
       number, text, singleChoice, multiChoice, slider, likert, matrixSingle
   - Timing per question
   - End: download JSON + show Polybox upload link (optional)
*/

const POLYBOX_UPLOAD_URL = "https://polybox.ethz.ch/index.php/s/69JSKYj75Yn86Bc";
const EMAIL_TO = "kim@arch.ethz.ch";

const state = {
  survey: null,
  pageIndex: 0,
  answers: {},
  timing: {},
  perfShownAt: {},
  perfFirstChangedAt: {},
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

function isAnswered(a){
  if (a === undefined || a === null) return false;
  if (Array.isArray(a)) return a.length > 0;
  if (typeof a === "object") return Object.keys(a).length > 0;
  if (a === "") return false;
  if (typeof a === "number" && Number.isNaN(a)) return false;
  return true;
}

function finalizeQuestionTime(qid){
  const a = state.answers[qid];
  if (!isAnswered(a)) return;

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

/* --- visibility logic: supports showIf.equals OR showIf.includes --- */
function isVisible(q){
  if (!q.showIf) return true;
  const depVal = state.answers[q.showIf.questionId];

  if ("equals" in q.showIf){
    return depVal === q.showIf.equals;
  }
  if ("includes" in q.showIf){
    return Array.isArray(depVal) && depVal.includes(q.showIf.includes);
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
  $meta.textContent = `Timezone: ${state.tz}`;
  updateProgress();

  $card.innerHTML = `
    <h1 class="h1">Load Baseline Survey</h1>
    <p class="sub">Select the <code>survey.json</code> file provided by the researcher.</p>

    <div class="pill">
      <input id="surveyFile" type="file" accept="application/json" />
    </div>

    ${errMsg ? `<div class="err" style="margin-top:12px">${escapeHTML(errMsg)}</div>` : ""}

    <div class="small">
      This survey does not upload anything automatically.
      It downloads a results file at the end.
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

function render(){
  const s = state.survey;
  const page = s.pages[state.pageIndex];
  const vq = visibleQuestionsOnPage();

  const p = state.answers["participant_number"];
  const ps = p ? ` • P${p}` : "";

  $meta.textContent = `${s.title || "Survey"} • Page ${state.pageIndex + 1}/${s.pages.length}${ps} • ${state.tz}`;
  updateProgress();

  for (const q of vq) ensureTimingShown(q.id);

  $card.innerHTML = `
    <h1 class="h1">${escapeHTML(page.title || s.title || "Survey")}</h1>
    ${page.subtitle ? `<p class="sub">${escapeHTML(page.subtitle)}</p>` : (s.intro ? `<p class="sub">${escapeHTML(s.intro)}</p>` : `<p class="sub"></p>`)}
    <div id="qWrap">
      ${vq.map(renderQuestion).join("")}
    </div>
    <div id="err" class="err" style="display:none"></div>
  `;

  $btnBack.disabled = state.pageIndex === 0;
  $btnNext.disabled = false;
  $btnNext.textContent = (state.pageIndex === s.pages.length - 1) ? "Finish & Download" : "Next";
}

function normalizeOption(opt){
  // allow: "string" OR { value, label, iconSvg }
  if (typeof opt === "string") return { value: opt, label: opt, iconSvg: null };
  if (opt && typeof opt === "object"){
    return {
      value: opt.value ?? opt.label ?? "",
      label: opt.label ?? opt.value ?? "",
      iconSvg: (typeof opt.iconSvg === "string" && opt.iconSvg.trim().startsWith("<svg")) ? opt.iconSvg : null
    };
  }
  return { value: String(opt), label: String(opt), iconSvg: null };
}

function renderQuestion(q){
  const required = q.required ? `<span class="req">*</span>` : "";
  const val = state.answers[q.id];

  if (q.type === "singleChoice"){
    const opts = (q.options || []).map(normalizeOption);
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
        <div class="choices">
          ${opts.map((opt, idx) => {
            const checked = (val === opt.value) ? "checked" : "";
            const rid = `${q.id}__${idx}`;
            return `
              <label class="choice" for="${escapeAttr(rid)}">
                <input id="${escapeAttr(rid)}" type="radio" name="${escapeAttr(q.id)}"
                  value="${escapeAttr(String(opt.value))}" ${checked}
                  onchange="onSingleChoice('${escapeJS(q.id)}', this.value)">
                <span>${escapeHTML(String(opt.label))}</span>
              </label>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  if (q.type === "multiChoice"){
    const opts = (q.options || []).map(normalizeOption);
    const arr = Array.isArray(val) ? val : [];
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
        <div class="mchoices">
          ${opts.map((opt, idx) => {
            const checked = arr.includes(opt.value) ? "checked" : "";
            const cid = `${q.id}__${idx}`;
            const icon = opt.iconSvg ? `<span class="optIcon" aria-hidden="true">${opt.iconSvg}</span>` : "";
            return `
              <label class="mchoice" for="${escapeAttr(cid)}">
                <input id="${escapeAttr(cid)}" type="checkbox"
                  value="${escapeAttr(String(opt.value))}" ${checked}
                  onchange="onMultiChoice('${escapeJS(q.id)}', this.value, this.checked)">
                ${icon}
                <span>${escapeHTML(String(opt.label))}</span>
              </label>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  if (q.type === "matrixSingle"){
    // answer stored as object: { rowValue: colValue }
    const rows = (q.rows || []).map(normalizeOption);
    const cols = (q.columns || []).map(normalizeOption);
    const ans = (val && typeof val === "object" && !Array.isArray(val)) ? val : {};
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
        <div class="matrixWrap">
          <table class="matrixTable" role="table">
            <thead>
              <tr>
                <th style="text-align:left"> </th>
                ${cols.map(c => `<th>${escapeHTML(String(c.label))}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${rows.map((r, rIdx) => `
                <tr>
                  <td class="matrixRowLabel">${escapeHTML(String(r.label))}</td>
                  ${cols.map((c, cIdx) => {
                    const rid = `${q.id}__${rIdx}__${cIdx}`;
                    const checked = ans[r.value] === c.value ? "checked" : "";
                    return `
                      <td>
                        <input class="matrixRadio" id="${escapeAttr(rid)}" type="radio"
                          name="${escapeAttr(`${q.id}__${r.value}`)}"
                          ${checked}
                          onchange="onMatrixSingle('${escapeJS(q.id)}', '${escapeJS(String(r.value))}', '${escapeJS(String(c.value))}')">
                      </td>
                    `;
                  }).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (q.type === "likert"){
    const points = clampInt(q.points ?? 7, 2, 11);
    const labels = (q.labels && Array.isArray(q.labels) && q.labels.length === points)
      ? q.labels
      : Array.from({length: points}, (_, i) => String(i + 1));

    const values = (q.values && Array.isArray(q.values) && q.values.length === points)
      ? q.values
      : labels;

    const gridClass = points === 5 ? "n5" : (points === 7 ? "n7" : "");

    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}

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
    const cur = val ?? "";
    if (multiline){
      return `
        <div class="q" data-qid="${escapeAttr(q.id)}">
          <label class="title">${escapeHTML(q.prompt)} ${required}</label>
          ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
          <textarea class="input" placeholder="${escapeAttr(placeholder)}"
            oninput="onText('${escapeJS(q.id)}', this.value)">${escapeHTML(cur)}</textarea>
        </div>
      `;
    }
    return `
      <div class="q" data-qid="${escapeAttr(q.id)}">
        <label class="title">${escapeHTML(q.prompt)} ${required}</label>
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
        <input class="input" type="text" placeholder="${escapeAttr(placeholder)}"
          value="${escapeAttr(cur)}"
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
        ${q.help ? `<div class="help">${escapeHTML(q.help)}</div>` : ""}
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

/* ---------- Answer handlers ---------- */

window.onSingleChoice = (qid, value) => {
  markFirstChanged(qid);
  state.answers[qid] = value;
  render();
};

window.onMultiChoice = (qid, value, checked) => {
  markFirstChanged(qid);
  const cur = Array.isArray(state.answers[qid]) ? state.answers[qid].slice() : [];
  const idx = cur.indexOf(value);
  if (checked && idx === -1) cur.push(value);
  if (!checked && idx !== -1) cur.splice(idx, 1);
  state.answers[qid] = cur;
  render();
};

window.onMatrixSingle = (qid, rowValue, colValue) => {
  markFirstChanged(qid);
  const cur = (state.answers[qid] && typeof state.answers[qid] === "object" && !Array.isArray(state.answers[qid]))
    ? { ...state.answers[qid] }
    : {};
  cur[rowValue] = colValue;
  state.answers[qid] = cur;
  render();
};

window.onLikert = (qid, valueJson) => {
  markFirstChanged(qid);
  let v;
  try { v = JSON.parse(valueJson); } catch { v = valueJson; }
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

/* ---------- Nav / Validation ---------- */

function validatePage(){
  const missing = [];
  for (const q of visibleQuestionsOnPage()){
    if (!q.required) continue;

    const a = state.answers[q.id];

    if (q.type === "matrixSingle"){
      const rows = (q.rows || []).map(normalizeOption);
      const ok = (a && typeof a === "object" && !Array.isArray(a))
        && rows.every(r => a[r.value] !== undefined && a[r.value] !== null && a[r.value] !== "");
      if (!ok) missing.push(q.id);
      continue;
    }

    if (!isAnswered(a)) missing.push(q.id);
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

  state.endedAtISO = nowISO();

  const participant = state.answers["participant_number"] ?? "NA";
  const safeParticipant = String(participant).replace(/[^a-zA-Z0-9_-]/g, "");
  const safeTime = state.endedAtISO.replace(/[:]/g, "-");
  const filename = `baseline_P${safeParticipant}_${safeTime}.json`;

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

  const subject = encodeURIComponent(`Solskin BASELINE survey — P${safeParticipant}`);
  const body = encodeURIComponent(
`Hello,

I completed the Solskin baseline survey.

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

/* ---------- Utilities ---------- */
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

/* ---------- Boot ---------- */
renderLoadScreen();
