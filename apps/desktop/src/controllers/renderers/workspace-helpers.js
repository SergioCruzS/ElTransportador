/**
 * Helpers de Navegación, Selección Única y Reubicación entre Colecciones — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/workspace-helpers.js
 */
import { translate } from "../../lang/i18n.js";
import { persistWorkspaceToLocalStorage } from "../../services/storage-sync.js";
import {
  buildFullResolvedUrlWithParams,
  maskSecretsInString,
  buildLiveHttpWirePreview
} from "../../services/http-client.js";

export function getActiveCollection(state) {
  return state.collections[state.activeCollectionIdx] || state.collections[0];
}

export function getActiveRequest(state) {
  return state.openTabs.find((r) => r.id === state.activeTabId) || state.openTabs[0];
}

/**
 * Encuentra el índice de la colección propietaria de una solicitud `reqId`.
 * Prioriza `state.activeCollectionIdx` si dicha colección contiene `reqId`.
 */
export function findCollectionIndexOfRequest(state, reqId) {
  if (!reqId || !Array.isArray(state.collections)) return state.activeCollectionIdx || 0;
  const activeIdx = Number(state.activeCollectionIdx || 0);
  if (
    state.collections[activeIdx] &&
    (state.collections[activeIdx].requests || []).some((r) => r.id === reqId)
  ) {
    return activeIdx;
  }
  for (let i = 0; i < state.collections.length; i++) {
    if ((state.collections[i].requests || []).some((r) => r.id === reqId)) {
      return i;
    }
  }
  return activeIdx;
}

/**
 * Mueve una solicitud entre colecciones, carpetas o posiciones dentro de una colección,
 * garantizando que se elimine de cualquier colección origen y no queden duplicados.
 */
export function moveRequestBetweenLocations(
  state,
  reqId,
  sourceColIdx,
  targetColIdx,
  targetFolderId = null,
  targetIndex = null
) {
  const tCol = state.collections[targetColIdx];
  if (!tCol || !reqId) return false;

  let reqObj = null;
  const sCol = state.collections[sourceColIdx];
  if (sCol && Array.isArray(sCol.requests)) {
    const sIdx = sCol.requests.findIndex((r) => r.id === reqId);
    if (sIdx >= 0) {
      reqObj = sCol.requests.splice(sIdx, 1)[0];
    }
  }

  // Asegurar que la solicitud se retire de cualquier otra colección donde pudiera existir
  for (let cIdx = 0; cIdx < state.collections.length; cIdx++) {
    const col = state.collections[cIdx];
    if (!col || !Array.isArray(col.requests)) continue;
    const foundIdx = col.requests.findIndex((r) => r.id === reqId);
    if (foundIdx >= 0) {
      const removed = col.requests.splice(foundIdx, 1)[0];
      if (!reqObj) reqObj = removed;
    }
  }

  if (!reqObj) {
    const fromTab = state.openTabs.find((t) => t.id === reqId);
    if (fromTab) {
      reqObj = JSON.parse(JSON.stringify(fromTab));
    }
  }
  if (!reqObj) return false;

  // Validar que targetFolderId exista en la colección destino; si no, colocar en raíz (null)
  const validFolderId =
    targetFolderId && (tCol.folders || []).some((f) => f.id === targetFolderId)
      ? targetFolderId
      : null;
  reqObj.folderId = validFolderId;

  tCol.requests = Array.isArray(tCol.requests) ? tCol.requests : [];
  if (typeof targetIndex === "number" && targetIndex >= 0 && targetIndex <= tCol.requests.length) {
    tCol.requests.splice(targetIndex, 0, reqObj);
  } else {
    tCol.requests.push(reqObj);
  }

  const tab = state.openTabs.find((t) => t.id === reqId);
  if (tab) {
    tab.folderId = reqObj.folderId;
  }
  state.activeCollectionIdx = targetColIdx;
  state.activeTabId = reqObj.id;
  persistWorkspaceToLocalStorage(state);
  return true;
}

export function syncActiveRequestToCollection(state) {
  const req = getActiveRequest(state);
  if (!req) return;
  const ownerIdx = findCollectionIndexOfRequest(state, req.id);
  const ownerCol = state.collections[ownerIdx];
  if (ownerCol && Array.isArray(ownerCol.requests)) {
    const idx = ownerCol.requests.findIndex((r) => r.id === req.id);
    if (idx >= 0) {
      ownerCol.requests[idx] = JSON.parse(JSON.stringify(req));
    }
  }
  persistWorkspaceToLocalStorage(state);
  updateUrlPreviewAndInspectorOnly(state);
}

export function updateUrlPreviewAndInspectorOnly(state) {
  const req = getActiveRequest(state);
  if (!req) return;
  const { text: resolvedUrl, unresolved } = buildFullResolvedUrlWithParams(req, state);
  const urlPrev = document.getElementById("resolved-url-preview");
  if (urlPrev) {
    urlPrev.textContent = `${translate(state.lang, "request.resolvedUrl")} ${maskSecretsInString(resolvedUrl || "—", state)}`;
  }
  const warnEl = document.getElementById("unresolved-warning");
  if (warnEl) {
    const tlsInsecure = req.settings && req.settings.verifyTls === false;
    const varMsg =
      unresolved.length > 0
        ? `${translate(state.lang, "request.unresolvedVarsPrefix")} ${unresolved.join(", ")}`
        : translate(state.lang, "request.varsVerified");
    if (tlsInsecure) {
      warnEl.style.color = "var(--status-danger)";
      warnEl.textContent = `${translate(state.lang, "request.tlsInsecurePreviewWarn")} • ${varMsg}`;
    } else {
      warnEl.style.color = unresolved.length > 0 ? "var(--status-warning)" : "var(--status-success)";
      warnEl.textContent = varMsg;
    }
  }
  const wireEl = document.getElementById("live-wire-preview-pre");
  if (wireEl) {
    wireEl.textContent = buildLiveHttpWirePreview(req, state);
  }
}

export function matchesGlobalQuery(req, q, scope) {
  if (!q) return true;
  const name = (req.name || "").toLowerCase();
  const url = (req.url || "").toLowerCase();
  const method = (req.method || "").toLowerCase();
  if (scope === "name") return name.includes(q);
  if (scope === "url") return url.includes(q);
  if (scope === "method") return method.includes(q);
  return name.includes(q) || url.includes(q) || method.includes(q);
}
