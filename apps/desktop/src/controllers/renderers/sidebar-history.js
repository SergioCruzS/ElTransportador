/**
 * Renderizador de la Pestaña de Historial del Panel Lateral — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/sidebar-history.js
 */
import { translate } from "../../lang/i18n.js";
import { persistWorkspaceToLocalStorage } from "../../services/storage-sync.js";
import { escapeHtml, escapeAttr } from "./dom-utils.js";
import { findCollectionIndexOfRequest, matchesGlobalQuery } from "./workspace-helpers.js";

export function renderSidebarHistoryTab(state, container, q, scope, renderSidebarFn, renderAll) {
  const filteredHist = state.history.filter((h) => matchesGlobalQuery(h, q, scope));
  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">${escapeHtml(translate(state.lang, "history.title"))} (${filteredHist.length})</span>
      <button type="button" class="etp-btn-xs" id="btn-clear-history">${escapeHtml(translate(state.lang, "history.btnClear"))}</button>
    </div>
    <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">${escapeHtml(translate(state.lang, "history.hint"))}</p>
  `;

  if (filteredHist.length === 0) {
    html += `<p style="font-size:12px;color:var(--text-muted);padding:8px;">${escapeHtml(translate(state.lang, "history.empty"))}</p>`;
  } else {
    for (const h of filteredHist) {
      const isErr = !h.status || h.status >= 400;
      const safeMethod = escapeHtml((h.method || "GET").toUpperCase());
      const safeHId = escapeAttr(h.id);
      html += `
        <div class="etp-tree-item" data-hist-id="${safeHId}">
          <div class="etp-tree-item-left" style="flex-direction:column;align-items:flex-start;gap:2px;">
            <div style="display:flex;align-items:center;gap:6px;width:100%;">
              <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
              <span class="etp-tree-item-name" style="font-weight:600;">${escapeHtml(h.name || h.url)}</span>
            </div>
            <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">${escapeHtml(h.url)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="font-size:11px;font-family:var(--font-mono);font-weight:600;color:${isErr ? "var(--status-danger)" : "var(--status-success)"};">${escapeHtml(h.status || "ERR")}</span>
            <button type="button" class="etp-icon-btn danger" data-del-hist="${safeHId}" title="${escapeAttr(translate(state.lang, "history.deleteEntry"))}">×</button>
          </div>
        </div>
      `;
    }
  }
  container.innerHTML = html;

  container.querySelectorAll("[data-hist-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const hId = el.getAttribute("data-hist-id");
      const entry = state.history.find((x) => x.id === hId);
      if (!entry || !entry.requestSnapshot) return;
      let origReq = null;
      let foundColIdx = state.activeCollectionIdx;
      for (let cIdx = 0; cIdx < state.collections.length; cIdx++) {
        const col = state.collections[cIdx];
        const found = (col.requests || []).find((r) => r.id === entry.requestId);
        if (found) {
          origReq = JSON.parse(JSON.stringify(found));
          foundColIdx = cIdx;
          break;
        }
      }
      const restoredReq = origReq || JSON.parse(JSON.stringify(entry.requestSnapshot));
      const existingTabIdx = state.openTabs.findIndex((t) => t.id === restoredReq.id);
      if (existingTabIdx >= 0) {
        state.openTabs[existingTabIdx] = restoredReq;
      } else {
        state.openTabs.push(restoredReq);
      }
      state.activeTabId = restoredReq.id;
      state.activeCollectionIdx = origReq ? foundColIdx : findCollectionIndexOfRequest(state, restoredReq.id);
      if (entry.responseSnapshot) {
        state.responsesByReqId[restoredReq.id] = JSON.parse(JSON.stringify(entry.responseSnapshot));
      }
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });

  container.querySelectorAll("[data-del-hist]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const hId = btn.getAttribute("data-del-hist");
      state.history = state.history.filter((x) => x.id !== hId);
      persistWorkspaceToLocalStorage(state);
      renderSidebarFn(state, renderAll);
    });
  });

  const btnClear = document.getElementById("btn-clear-history");
  if (btnClear) {
    btnClear.addEventListener("click", async () => {
      state.history = [];
      persistWorkspaceToLocalStorage(state);
      try {
        await fetch("/__etp_ipc__/clear_history", { method: "POST", body: "{}" });
      } catch {}
      renderSidebarFn(state, renderAll);
    });
  }
}
