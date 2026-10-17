/**
 * Renderizador del Panel de Respuesta HTTP con Coloreado JSON, Plegado de Llaves y Resaltado de Búsqueda — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/response-panel.js
 */
import { translate } from "../../lang/i18n.js";
import { localizeResponseForLang } from "../../services/http-client.js";
import { escapeHtml, escapeAttr } from "./dom-utils.js";
import { getActiveRequest } from "./workspace-helpers.js";
import { buildStructuredResponseCodeHtml } from "./json-viewer.js";

function countSubstringOccurrences(text, queryLower) {
  if (!queryLower || !text) return 0;
  const lower = text.toLowerCase();
  let count = 0;
  let pos = 0;
  while (pos < lower.length) {
    const idx = lower.indexOf(queryLower, pos);
    if (idx === -1) break;
    count++;
    pos = idx + queryLower.length;
  }
  return count;
}

export function renderResponsePanel(state) {
  const req = getActiveRequest(state);
  const rawResp = req ? state.responsesByReqId[req.id] : null;
  const resp = rawResp ? localizeResponseForLang(rawResp, state.lang) : null;

  const statusBadge = document.getElementById("resp-status-badge");
  const timeChip = document.getElementById("resp-time-chip");
  const sizeChip = document.getElementById("resp-size-chip");
  const testsChip = document.getElementById("resp-tests-chip");
  const linesInd = document.getElementById("resp-lines-indicator");
  const matchCountBadge = document.getElementById("resp-match-count");
  const clearRespBtn = document.getElementById("btn-clear-resp-search");
  const filterModeLbl = document.getElementById("lbl-resp-filter-mode");
  const container = document.getElementById("resp-body-container");

  const filterQ = (state.respFilterQuery || "").trim().toLowerCase();
  if (clearRespBtn) clearRespBtn.classList.toggle("visible", filterQ.length > 0);
  if (filterModeLbl) {
    filterModeLbl.textContent =
      state.respFilterMode === "all"
        ? translate(state.lang, "response.filterModeAll")
        : translate(state.lang, "response.filterModeLines");
  }

  if (!resp) {
    statusBadge.textContent = translate(state.lang, "response.statusReady");
    statusBadge.className = "etp-status-badge status-3xx";
    timeChip.textContent = "0 ms";
    sizeChip.textContent = "0 B";
    testsChip.textContent = translate(state.lang, "response.assertionsDash");
    linesInd.textContent = `0 ${translate(state.lang, "response.linesSuffix")}`;
    if (matchCountBadge) matchCountBadge.textContent = `0 ${translate(state.lang, "response.matchesSuffix")}`;
    container.innerHTML = `<div style="padding:36px;color:var(--text-muted);text-align:center;">${escapeHtml(translate(state.lang, "response.emptyState"))}</div>`;
    return;
  }

  const codeGroup = Math.floor((resp.status || 0) / 100);
  statusBadge.textContent =
    resp.status > 0
      ? `${resp.status} ${resp.statusText}`
      : `${resp.statusText || translate(state.lang, "errors.connectionErrorStatus")}`;
  statusBadge.className = `etp-status-badge status-${codeGroup}xx`;
  timeChip.textContent = `${resp.durationMs} ms`;
  sizeChip.textContent = `${resp.sizeBytes} B`;

  const passedCount = (resp.assertionResults || []).filter((a) => a.passed).length;
  const totalCount = (resp.assertionResults || []).length;
  testsChip.textContent = `${translate(state.lang, "response.assertionsPrefix")} ${passedCount}/${totalCount} OK`;

  const rawBodyStr = resp.body || "";
  const allLines = rawBodyStr.split(/\r\n|\r|\n/);

  let isJsonContent = Boolean(resp.isJson);
  if (!isJsonContent && rawBodyStr.trim().startsWith("{")) {
    try {
      JSON.parse(rawBodyStr);
      isJsonContent = true;
    } catch {}
  }

  const totalMatches = filterQ
    ? state.respFilterMode === "all"
      ? countSubstringOccurrences(rawBodyStr, filterQ)
      : allLines.filter((line) => line.toLowerCase().includes(filterQ)).length
    : 0;

  if (matchCountBadge) {
    matchCountBadge.textContent = `${totalMatches} ${translate(state.lang, "response.matchesSuffix")}`;
  }

  if (state.respSubTab === "pretty" || state.respSubTab === "raw") {
    state.foldedRespLines = state.foldedRespLines || {};
    const reqFoldMap = state.foldedRespLines[req.id] || {};
    const useJsonHighlighting = state.respSubTab === "pretty" && isJsonContent;

    const { html, visibleLinesCount, foldRanges } = buildStructuredResponseCodeHtml({
      allLines,
      isJsonMode: useJsonHighlighting,
      filterQ,
      filterMode: state.respFilterMode || "filter",
      foldedMap: reqFoldMap,
      foldedLinesSuffix: translate(state.lang, "response.foldedLinesSuffix")
    });

    linesInd.textContent = `${visibleLinesCount} ${translate(state.lang, "response.linesSuffix")}`;

    const foldToolbarHtml =
      useJsonHighlighting && foldRanges.size > 0
        ? `
          <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:6px;">
            <button type="button" class="etp-btn-xs" id="btn-expand-all-json">${escapeHtml(translate(state.lang, "response.expandAllJson"))}</button>
            <button type="button" class="etp-btn-xs" id="btn-collapse-all-json">${escapeHtml(translate(state.lang, "response.collapseAllJson"))}</button>
          </div>
        `
        : "";

    container.innerHTML = `${foldToolbarHtml}${html}`;

    container.querySelectorAll("[data-json-fold]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const lineIdx = Number(btn.getAttribute("data-json-fold"));
        state.foldedRespLines[req.id] = state.foldedRespLines[req.id] || {};
        state.foldedRespLines[req.id][lineIdx] = !state.foldedRespLines[req.id][lineIdx];
        renderResponsePanel(state);
      });
    });

    document.getElementById("btn-expand-all-json")?.addEventListener("click", () => {
      state.foldedRespLines[req.id] = {};
      renderResponsePanel(state);
    });

    document.getElementById("btn-collapse-all-json")?.addEventListener("click", () => {
      const nextMap = {};
      for (const [startIdx] of foldRanges.entries()) {
        if (startIdx > 0) nextMap[startIdx] = true;
      }
      if (Object.keys(nextMap).length === 0 && foldRanges.has(0)) {
        nextMap[0] = true;
      }
      state.foldedRespLines[req.id] = nextMap;
      renderResponsePanel(state);
    });
    return;
  }

  linesInd.textContent = `${allLines.length} ${translate(state.lang, "response.linesSuffix")}`;

  if (state.respSubTab === "headers") {
    const entries = Object.entries(resp.headers || {});
    const hRows = entries.length
      ? entries
          .map(
            ([k, v]) =>
              `<tr><td style="font-family:var(--font-mono);font-weight:600;">${escapeHtml(k)}</td><td style="font-family:var(--font-mono);">${escapeHtml(v)}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="2" style="color:var(--text-muted);text-align:center;">${escapeHtml(translate(state.lang, "response.emptyHeaders"))}</td></tr>`;

    container.innerHTML = `
      <div style="overflow:auto;flex:1;">
        <table class="etp-kv-table">
          <thead><tr><th>${escapeHtml(translate(state.lang, "response.colRespHeader"))}</th><th>${escapeHtml(translate(state.lang, "environments.colValue"))}</th></tr></thead>
          <tbody>
            ${hRows}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (state.respSubTab === "preview") {
    const safeSrcDoc = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"></head><body style="font-family:sans-serif;padding:12px;"><pre>${escapeHtml(rawBodyStr)}</pre></body></html>`;
    container.innerHTML = `
      <div style="margin-bottom:6px;font-size:11.5px;color:var(--status-success);">
        ${escapeHtml(translate(state.lang, "response.sandboxNotice"))}
      </div>
      <iframe class="etp-sandbox-preview" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeAttr(safeSrcDoc)}"></iframe>
    `;
    return;
  }

  if (state.respSubTab === "cookies") {
    const cookies = resp.cookies || [];
    const cRows = cookies.length
      ? cookies
          .map(
            (c) => `
              <tr>
                <td>${escapeHtml(c.name)}</td>
                <td>${escapeHtml(c.value)}</td>
                <td>${c.httpOnly ? "✓" : "—"}</td>
                <td>${c.secure ? "✓" : "—"}</td>
                <td>${escapeHtml(c.sameSite || "—")}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="5" style="color:var(--text-muted);text-align:center;">${escapeHtml(translate(state.lang, "response.emptyCookies"))}</td></tr>`;

    container.innerHTML = `
      <div style="overflow:auto;flex:1;">
        <table class="etp-kv-table">
          <thead><tr><th>Name</th><th>Value</th><th>HttpOnly</th><th>Secure</th><th>SameSite</th></tr></thead>
          <tbody>
            ${cRows}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (state.respSubTab === "assertions") {
    const results = resp.assertionResults || [];
    const resHtml = results.length
      ? results
          .map(
            (r) => `
              <div style="padding:8px 10px;border-radius:5px;border:1px solid var(--border-strong);background:var(--bg-input);display:flex;justify-content:space-between;">
                <span>${escapeHtml(r.message)}</span>
                <span class="${r.passed ? "etp-pass" : "etp-fail"}">${r.passed ? "PASS" : "FAIL"}</span>
              </div>
            `
          )
          .join("")
      : `<div style="color:var(--text-muted);padding:12px;">${escapeHtml(translate(state.lang, "response.emptyAssertions"))}</div>`;

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;overflow:auto;flex:1;">
        ${resHtml}
      </div>
    `;
  }
}
