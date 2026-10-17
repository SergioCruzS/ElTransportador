/**
 * Acciones de Portapapeles, Guardado de Archivos y Ejecución de Solicitud Activa — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/handlers/file-clipboard-actions.js
 */
import { translate } from "../../lang/i18n.js";
import {
  buildFullResolvedUrlWithParams,
  executeSingleRequestObject,
  recordInHistory
} from "../../services/http-client.js";
import {
  showToast,
  openInputDialog,
  getActiveRequest,
  syncActiveRequestToCollection,
  renderResponsePanel,
  renderSidebar
} from "../ui-renderers.js";

export function copyTextWithToast(text, msg) {
  showToast(msg);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  } catch {}
}

export async function saveFileWithPickerAndToast(state, contentStr, suggestedName) {
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "JSON / Text",
            accept: { "application/json": [".json", ".etp.json"], "text/plain": [".txt", ".sh"] }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(contentStr);
      await writable.close();
      showToast(translate(state.lang, "toasts.fileSaved", { name: handle.name }));
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }

  openInputDialog({
    title: translate(state.lang, "modals.btnSaveFileAs"),
    label: translate(state.lang, "request.nameLabel"),
    initialValue: suggestedName,
    onConfirm: (chosenFileName) => {
      const blob = new Blob([contentStr], { type: "application/json;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = chosenFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast(translate(state.lang, "toasts.fileSaved", { name: chosenFileName }));
    }
  });
}

export async function executeActiveRequest(state, renderAll) {
  const req = getActiveRequest(state);
  if (!req) return;
  syncActiveRequestToCollection(state);
  state.inFlightReqId = req.id;
  document.getElementById("btn-cancel-req").style.display = "inline-flex";

  const { text: finalUrl } = buildFullResolvedUrlWithParams(req, state);
  const resp = await executeSingleRequestObject(req, state);

  state.responsesByReqId[req.id] = resp;
  recordInHistory(req, resp, finalUrl, state);
  state.inFlightReqId = null;
  document.getElementById("btn-cancel-req").style.display = "none";
  renderResponsePanel(state);
  if (state.sideTab === "history") renderSidebar(state, renderAll);
}
