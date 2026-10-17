/**
 * Renderizador Principal del Editor Central de Solicitudes HTTP — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/center-editor.js
 */
import { translate } from "../../lang/i18n.js";
import {
  persistWorkspaceToLocalStorage,
  createCleanStarterRequest
} from "../../services/storage-sync.js";
import { buildLiveHttpWirePreview } from "../../services/http-client.js";
import { escapeHtml, escapeAttr } from "./dom-utils.js";
import {
  getActiveRequest,
  findCollectionIndexOfRequest,
  updateUrlPreviewAndInspectorOnly
} from "./workspace-helpers.js";
import { buildCenterEditorSubTabHtml } from "./center-editor-tabs.js";
import { bindCenterEditorSubTabEvents } from "./center-editor-events.js";

export function renderCenterEditor(state, renderAll) {
  const tabsBar = document.getElementById("open-tabs-bar");
  tabsBar.innerHTML =
    state.openTabs
      .map((t) => {
        const safeId = escapeAttr(t.id);
        const safeMethod = escapeHtml((t.method || "GET").toUpperCase());
        return `
          <div class="etp-req-tab ${t.id === state.activeTabId ? "active" : ""}" data-tab-id="${safeId}">
            <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
            <span class="etp-tab-title">${escapeHtml(t.name)}</span>
            <button type="button" class="etp-tab-close" data-close-tab="${safeId}" title="${escapeAttr(translate(state.lang, "request.closeTabTooltip"))}">×</button>
          </div>
        `;
      })
      .join("") +
    `<button type="button" class="etp-btn-xs" id="btn-add-tab-inline" title="${escapeAttr(translate(state.lang, "request.newTabTooltip"))}" style="margin-left:4px;flex-shrink:0;">+</button>`;

  tabsBar.querySelectorAll("[data-tab-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-tab]")) return;
      const tabId = el.getAttribute("data-tab-id");
      state.activeTabId = tabId;
      state.activeCollectionIdx = findCollectionIndexOfRequest(state, tabId);
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });

  tabsBar.querySelectorAll("[data-close-tab]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const closeId = btn.getAttribute("data-close-tab");
      const idx = state.openTabs.findIndex((t) => t.id === closeId);
      if (idx < 0) return;
      state.openTabs.splice(idx, 1);

      if (state.openTabs.length === 0) {
        const activeCol = state.collections[state.activeCollectionIdx] || state.collections[0];
        let fallbackReq = activeCol?.requests?.[0];
        if (!fallbackReq) {
          fallbackReq = createCleanStarterRequest(state.lang, null);
          if (activeCol && Array.isArray(activeCol.requests)) {
            activeCol.requests.push(fallbackReq);
          }
        }
        state.openTabs.push(JSON.parse(JSON.stringify(fallbackReq)));
      }
      if (state.activeTabId === closeId) {
        const nextTab = state.openTabs[Math.min(idx, state.openTabs.length - 1)];
        state.activeTabId = nextTab.id;
        state.activeCollectionIdx = findCollectionIndexOfRequest(state, nextTab.id);
      }
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });

  document.getElementById("btn-add-tab-inline").addEventListener("click", () => {
    document.getElementById("btn-new-request").click();
  });

  const req = getActiveRequest(state);
  if (!req) return;

  document.getElementById("req-name-input").value = req.name || "";

  const folderSelect = document.getElementById("req-folder-select");
  const currentOwnerColIdx = findCollectionIndexOfRequest(state, req.id);
  const optGroups = [];
  state.collections.forEach((col, cIdx) => {
    const isThisCol = cIdx === currentOwnerColIdx;
    const rootSelected = isThisCol && !req.folderId ? "selected" : "";
    const safeColName = escapeHtml(col.metadata?.name || "Collection");
    let groupHtml = `<optgroup label="📦 ${safeColName}">`;
    groupHtml += `<option value="${cIdx}::" ${rootSelected}>📦 ${safeColName} — ${escapeHtml(translate(state.lang, "request.rootOptionSuffix"))}</option>`;
    for (const f of col.folders || []) {
      const fSelected = isThisCol && req.folderId === f.id ? "selected" : "";
      groupHtml += `<option value="${cIdx}::${escapeAttr(f.id)}" ${fSelected}>📁 ${safeColName} / ${escapeHtml(f.name)}</option>`;
    }
    groupHtml += `</optgroup>`;
    optGroups.push(groupHtml);
  });
  folderSelect.innerHTML = optGroups.join("");

  document.getElementById("req-method").value = req.method;
  document.getElementById("req-url").value = req.url;

  updateUrlPreviewAndInspectorOnly(state);

  const pane = document.getElementById("req-editor-pane");
  let subContentHtml = buildCenterEditorSubTabHtml(state, req);

  subContentHtml += `
    <div class="etp-live-request-inspector">
      <div class="etp-inspector-header">
        <span>${escapeHtml(translate(state.lang, "request.wirePreviewTitle"))}</span>
        <span>${escapeHtml(translate(state.lang, "request.wireStatsPrefix"))} ${(req.params || []).filter((p) => p.enabled && p.key).length} • Headers: ${(req.headers || []).filter((h) => h.enabled && h.key).length} • Auth: ${escapeHtml(req.auth?.type || "none")}</span>
      </div>
      <pre class="etp-inspector-pre" id="live-wire-preview-pre">${escapeHtml(buildLiveHttpWirePreview(req, state))}</pre>
    </div>
  `;

  pane.innerHTML = subContentHtml;

  bindCenterEditorSubTabEvents(state, req, pane, renderCenterEditor, renderAll);
}
