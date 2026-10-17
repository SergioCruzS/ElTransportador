/**
 * Manejadores de Barra de Solicitud, Ubicación entre Colecciones, Búsqueda y Atajos — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/handlers/request-bar-handlers.js
 */
import { translate } from "../../lang/i18n.js";
import { persistWorkspaceToLocalStorage } from "../../services/storage-sync.js";
import {
  showToast,
  getActiveRequest,
  findCollectionIndexOfRequest,
  moveRequestBetweenLocations,
  syncActiveRequestToCollection,
  updateUrlPreviewAndInspectorOnly,
  renderSidebar,
  renderResponsePanel
} from "../ui-renderers.js";
import { executeActiveRequest } from "./file-clipboard-actions.js";

export function bindRequestBarAndSearchHandlers(state, renderAll) {
  document.getElementById("req-name-input")?.addEventListener("input", (e) => {
    const req = getActiveRequest(state);
    if (!req) return;
    req.name = e.target.value;
    syncActiveRequestToCollection(state);
    const tabTitle = document.querySelector(`[data-tab-id="${req.id}"] .etp-tab-title`);
    if (tabTitle) tabTitle.textContent = req.name || translate(state.lang, "request.untitled");
    renderSidebar(state, renderAll);
  });

  document.getElementById("req-folder-select")?.addEventListener("change", (e) => {
    const req = getActiveRequest(state);
    if (!req) return;
    const rawVal = e.target.value || "0::";
    const [targetColStr, targetFolderId] = rawVal.split("::");
    const targetColIdx = Number(targetColStr || 0);
    const sourceColIdx = findCollectionIndexOfRequest(state, req.id);
    const tCol = state.collections[targetColIdx];
    const moved = moveRequestBetweenLocations(
      state,
      req.id,
      sourceColIdx,
      targetColIdx,
      targetFolderId || null,
      null
    );
    renderAll();
    if (moved && tCol) {
      const destFolder = (tCol.folders || []).find((f) => f.id === targetFolderId);
      const destLabel = destFolder
        ? `📁 ${destFolder.name} (${tCol.metadata.name})`
        : `📦 ${tCol.metadata.name} ${translate(state.lang, "request.rootOptionSuffix")}`;
      showToast(translate(state.lang, "toasts.movedReq", { dest: destLabel }));
    }
  });

  document.getElementById("req-method")?.addEventListener("change", (e) => {
    const req = getActiveRequest(state);
    if (req) {
      req.method = e.target.value;
      syncActiveRequestToCollection(state);
      renderSidebar(state, renderAll);
      const badge = document.querySelector(`[data-tab-id="${req.id}"] .etp-method-badge`);
      if (badge) {
        badge.textContent = req.method;
        badge.className = `etp-method-badge etp-method-${req.method.toLowerCase()}`;
      }
    }
  });

  document.getElementById("req-url")?.addEventListener("input", (e) => {
    const req = getActiveRequest(state);
    if (req) {
      req.url = e.target.value;
      syncActiveRequestToCollection(state);
    }
  });

  document.getElementById("env-select")?.addEventListener("change", (e) => {
    state.activeEnvId = e.target.value;
    persistWorkspaceToLocalStorage(state);
    renderSidebar(state, renderAll);
    updateUrlPreviewAndInspectorOnly(state);
  });

  document.getElementById("global-search-scope")?.addEventListener("change", (e) => {
    state.globalSearchScope = e.target.value;
    persistWorkspaceToLocalStorage(state);
    renderSidebar(state, renderAll);
  });

  document.getElementById("global-search")?.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderSidebar(state, renderAll);
  });

  document.getElementById("btn-clear-global-search")?.addEventListener("click", () => {
    state.searchQuery = "";
    const inp = document.getElementById("global-search");
    if (inp) inp.value = "";
    renderSidebar(state, renderAll);
  });

  document.getElementById("resp-search-input")?.addEventListener("input", (e) => {
    state.respFilterQuery = e.target.value;
    renderResponsePanel(state);
  });

  document.getElementById("btn-clear-resp-search")?.addEventListener("click", () => {
    state.respFilterQuery = "";
    const inp = document.getElementById("resp-search-input");
    if (inp) inp.value = "";
    renderResponsePanel(state);
  });

  document.getElementById("btn-resp-filter-mode")?.addEventListener("click", () => {
    state.respFilterMode = state.respFilterMode === "all" ? "filter" : "all";
    persistWorkspaceToLocalStorage(state);
    renderResponsePanel(state);
  });

  document.getElementById("btn-send-req")?.addEventListener("click", () => executeActiveRequest(state, renderAll));

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      document.getElementById("global-search")?.focus();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      executeActiveRequest(state, renderAll);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      document.getElementById("btn-save-req")?.click();
    }
  });
}
