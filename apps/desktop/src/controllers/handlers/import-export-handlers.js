/**
 * Manejadores de Importación/Exportación, cURL, Bóveda, Configuración, Tema e Idioma — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/handlers/import-export-handlers.js
 */
import { translate } from "../../lang/i18n.js";
import {
  persistWorkspaceToLocalStorage,
  sanitizeCollectionForExport,
  sanitizeImportedCollection,
  isCollectionNameDuplicate
} from "../../services/storage-sync.js";
import {
  generateCompleteCurlCommand,
  localizeResponseForLang
} from "../../services/http-client.js";
import {
  escapeHtml,
  showToast,
  getActiveCollection,
  getActiveRequest,
  renderSettingsModalContent
} from "../ui-renderers.js";
import { copyTextWithToast, saveFileWithPickerAndToast } from "./file-clipboard-actions.js";

export function bindTopbarAndModalHandlers(state, renderAll) {
  document.getElementById("btn-open-vault")?.addEventListener("click", () => {
    state.activeMainView = "workspace";
    state.sidebarVisible = true;
    state.sideTab = "environments";
    persistWorkspaceToLocalStorage(state);
    renderAll();
  });

  document.getElementById("btn-toggle-theme")?.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", state.theme);
    persistWorkspaceToLocalStorage(state);
    renderAll();
  });

  document.getElementById("btn-toggle-lang")?.addEventListener("click", () => {
    state.lang = state.lang === "es" ? "en" : "es";
    persistWorkspaceToLocalStorage(state);
    renderAll();
  });

  document.getElementById("btn-copy-resp")?.addEventListener("click", () => {
    const req = getActiveRequest(state);
    const rawResp = req ? state.responsesByReqId[req.id] : null;
    const resp = rawResp ? localizeResponseForLang(rawResp, state.lang) : null;
    if (!resp || !resp.body) {
      showToast(translate(state.lang, "toasts.noRespToCopy"), "warning");
      return;
    }
    copyTextWithToast(resp.body, translate(state.lang, "toasts.copiedResp"));
  });

  document.getElementById("btn-download-resp")?.addEventListener("click", () => {
    const req = getActiveRequest(state);
    const rawResp = req ? state.responsesByReqId[req.id] : null;
    const resp = rawResp ? localizeResponseForLang(rawResp, state.lang) : null;
    if (!resp) {
      showToast(translate(state.lang, "toasts.noRespToDownload"), "warning");
      return;
    }
    const suggested = `${(req.name || "response").replace(/[^a-z0-9_-]/gi, "_")}.json`;
    saveFileWithPickerAndToast(state, resp.body || "", suggested);
  });

  document.getElementById("btn-open-import")?.addEventListener("click", () => {
    document.getElementById("modal-import-title").textContent = translate(state.lang, "modals.importExportTitle");
    const sanitizedCol = sanitizeCollectionForExport(getActiveCollection(state));
    document.getElementById("import-textarea").value = JSON.stringify(sanitizedCol, null, 2);
    document.getElementById("import-report-box").innerHTML = "";
    document.getElementById("modal-import").classList.add("open");
  });

  document.getElementById("btn-close-import-modal")?.addEventListener("click", () => {
    document.getElementById("modal-import").classList.remove("open");
  });

  document.getElementById("btn-export-etp")?.addEventListener("click", () => {
    const sanitizedCol = sanitizeCollectionForExport(getActiveCollection(state));
    document.getElementById("import-textarea").value = JSON.stringify(sanitizedCol, null, 2);
  });

  document.getElementById("btn-copy-modal-code")?.addEventListener("click", () => {
    const val = document.getElementById("import-textarea").value;
    copyTextWithToast(val, translate(state.lang, "toasts.copiedContent"));
  });

  document.getElementById("btn-save-modal-file")?.addEventListener("click", () => {
    const val = document.getElementById("import-textarea").value;
    const isCurl = val.trim().startsWith("curl ");
    const suggested = isCurl
      ? "request-curl.sh"
      : `${(getActiveCollection(state).metadata.name || "collection").replace(/[^a-z0-9_-]/gi, "_")}.etp.json`;
    saveFileWithPickerAndToast(state, val, suggested);
  });

  document.getElementById("btn-execute-import")?.addEventListener("click", () => {
    const raw = document.getElementById("import-textarea").value;
    try {
      const parsed = JSON.parse(raw);
      const discarded = Object.keys(parsed).filter((k) => k.startsWith("x-") || k.toLowerCase().includes("script"));
      if (parsed.kind === "eltransportador.collection" || Array.isArray(parsed.requests)) {
        const cleanCol = sanitizeImportedCollection(parsed, state.lang);
        if (isCollectionNameDuplicate(state.collections, cleanCol.metadata.name)) {
          const dupMsg = translate(state.lang, "toasts.duplicateColName", { name: cleanCol.metadata.name });
          document.getElementById("import-report-box").innerHTML = `<span class="etp-fail">${escapeHtml(dupMsg)}</span>`;
          showToast(dupMsg, "warning");
          return;
        }
        state.collections.push(cleanCol);
        state.activeCollectionIdx = state.collections.length - 1;
        if (cleanCol.requests.length > 0) {
          state.openTabs.push(JSON.parse(JSON.stringify(cleanCol.requests[0])));
          state.activeTabId = cleanCol.requests[0].id;
        }
        persistWorkspaceToLocalStorage(state);
        renderAll();
      }
      document.getElementById("import-report-box").innerHTML = `
        <div style="padding:8px;background:var(--bg-elevated);border-radius:6px;">
          <span class="etp-pass">${escapeHtml(translate(state.lang, "toasts.importedOk"))}</span>
          ${discarded.length ? `<br/><small>Discarded untrusted fields: ${escapeHtml(discarded.join(", "))}</small>` : ""}
        </div>
      `;
      showToast(translate(state.lang, "toasts.importedOk"));
    } catch (e) {
      document.getElementById("import-report-box").innerHTML = `<span class="etp-fail">✗ JSON Error: ${escapeHtml(e.message)}</span>`;
    }
  });

  document.getElementById("btn-export-curl")?.addEventListener("click", () => {
    const req = getActiveRequest(state);
    const curlCmd = generateCompleteCurlCommand(req, state);
    document.getElementById("modal-import-title").textContent = `cURL — ${req.name}`;
    document.getElementById("import-textarea").value = curlCmd;
    document.getElementById("import-report-box").innerHTML = "";
    document.getElementById("modal-import").classList.add("open");
  });

  document.getElementById("btn-open-settings")?.addEventListener("click", () => {
    renderSettingsModalContent(state, renderAll);
    document.getElementById("modal-settings").classList.add("open");
  });

  document.getElementById("btn-close-settings-modal")?.addEventListener("click", () => {
    document.getElementById("modal-settings").classList.remove("open");
  });
}
