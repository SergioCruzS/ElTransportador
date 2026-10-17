/**
 * Controlador Principal de la Aplicación — ElTransportador v1.0.0
 * Archivo: apps/desktop/src/controllers/app-controller.js
 */
import { translate } from '../lang/i18n.js';
import {
  APP_VERSION,
  createInitialApplicationState,
  restoreWorkspaceFromLocalStorage,
  persistWorkspaceToLocalStorage,
  createCleanStarterRequest,
  sanitizeCollectionForExport,
  sanitizeImportedCollection
} from '../services/storage-sync.js';
import {
  buildFullResolvedUrlWithParams,
  generateCompleteCurlCommand,
  executeSingleRequestObject,
  recordInHistory
} from '../services/http-client.js';
import {
  escapeHtml,
  showToast,
  openInputDialog,
  closeInputDialog,
  confirmInputDialog,
  closeConfirmMoveModal,
  acceptConfirmMoveModal,
  getActiveCollection,
  getActiveRequest,
  findCollectionIndexOfRequest,
  moveRequestBetweenLocations,
  syncActiveRequestToCollection,
  updateUrlPreviewAndInspectorOnly,
  renderViewLayoutPreferences,
  renderSettingsModalContent,
  renderSidebar,
  renderCenterEditor,
  renderResponsePanel,
  renderFlowsStudioView,
  renderAllViews
} from './ui-renderers.js';

const state = createInitialApplicationState();
restoreWorkspaceFromLocalStorage(state);
document.documentElement.setAttribute('data-theme', state.theme);

const renderAll = () => renderAllViews(state);

function copyTextWithToast(text, msg) {
  showToast(msg);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  } catch {}
}

async function saveFileWithPickerAndToast(contentStr, suggestedName) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'JSON / Text',
            accept: { 'application/json': ['.json', '.etp.json'], 'text/plain': ['.txt', '.sh'] }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(contentStr);
      await writable.close();
      showToast(translate(state.lang, 'toasts.fileSaved', { name: handle.name }));
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  openInputDialog({
    title: translate(state.lang, 'modals.btnSaveFileAs'),
    label: translate(state.lang, 'request.nameLabel'),
    initialValue: suggestedName,
    onConfirm: (chosenFileName) => {
      const blob = new Blob([contentStr], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = chosenFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast(translate(state.lang, 'toasts.fileSaved', { name: chosenFileName }));
    }
  });
}

async function executeActiveRequest() {
  const req = getActiveRequest(state);
  if (!req) return;
  syncActiveRequestToCollection(state);
  state.inFlightReqId = req.id;
  document.getElementById('btn-cancel-req').style.display = 'inline-flex';

  const { text: finalUrl } = buildFullResolvedUrlWithParams(req, state);
  const resp = await executeSingleRequestObject(req, state);

  state.responsesByReqId[req.id] = resp;
  recordInHistory(req, resp, finalUrl, state);
  state.inFlightReqId = null;
  document.getElementById('btn-cancel-req').style.display = 'none';
  renderResponsePanel(state);
  if (state.sideTab === 'history') renderSidebar(state, renderAll);
}

document.getElementById('btn-close-input-dialog')?.addEventListener('click', closeInputDialog);
document.getElementById('btn-cancel-input-dialog')?.addEventListener('click', closeInputDialog);
document.getElementById('btn-confirm-input-dialog')?.addEventListener('click', confirmInputDialog);
document.getElementById('input-dialog-field')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    confirmInputDialog();
  } else if (e.key === 'Escape') {
    closeInputDialog();
  }
});

document.getElementById('btn-close-confirm-move')?.addEventListener('click', closeConfirmMoveModal);
document.getElementById('btn-cancel-confirm-move')?.addEventListener('click', closeConfirmMoveModal);
document.getElementById('btn-accept-confirm-move')?.addEventListener('click', acceptConfirmMoveModal);

let floatingHideTimer = null;
const sidebarEl = document.getElementById('main-sidebar');

function clearFloatingTimer() {
  if (floatingHideTimer) {
    clearTimeout(floatingHideTimer);
    floatingHideTimer = null;
  }
}
function scheduleFloatingAutoHide() {
  clearFloatingTimer();
  if (!state.sidebarPinned && state.sidebarVisible) {
    floatingHideTimer = setTimeout(() => {
      const activeEl = document.activeElement;
      if (activeEl && sidebarEl.contains(activeEl) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeEl.tagName)) {
        return;
      }
      state.sidebarVisible = false;
      persistWorkspaceToLocalStorage(state);
      renderViewLayoutPreferences(state);
    }, 2200);
  }
}

sidebarEl?.addEventListener('mouseenter', clearFloatingTimer);
sidebarEl?.addEventListener('focusin', clearFloatingTimer);
sidebarEl?.addEventListener('mouseleave', scheduleFloatingAutoHide);
sidebarEl?.addEventListener('focusout', scheduleFloatingAutoHide);

document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
  state.sidebarVisible = !state.sidebarVisible;
  persistWorkspaceToLocalStorage(state);
  renderViewLayoutPreferences(state);
  if (state.sidebarVisible && !state.sidebarPinned) {
    scheduleFloatingAutoHide();
  }
});
document.getElementById('btn-hide-sidebar-inline')?.addEventListener('click', () => {
  state.sidebarVisible = false;
  persistWorkspaceToLocalStorage(state);
  renderViewLayoutPreferences(state);
});
document.getElementById('btn-pin-sidebar')?.addEventListener('click', () => {
  state.sidebarPinned = !state.sidebarPinned;
  if (state.sidebarPinned) clearFloatingTimer();
  else scheduleFloatingAutoHide();
  persistWorkspaceToLocalStorage(state);
  renderViewLayoutPreferences(state);
});

const sidebarResizer = document.getElementById('sidebar-resizer');
const splitResizer = document.getElementById('split-resizer');
let isResizingSidebar = false;
let isResizingSplit = false;

sidebarResizer?.addEventListener('mousedown', () => {
  isResizingSidebar = true;
  sidebarResizer.classList.add('dragging');
});
splitResizer?.addEventListener('mousedown', () => {
  isResizingSplit = true;
  splitResizer.classList.add('dragging');
});

window.addEventListener('mousemove', (e) => {
  if (isResizingSidebar) {
    state.sidebarWidth = Math.min(560, Math.max(230, e.clientX));
    renderViewLayoutPreferences(state);
    return;
  }
  if (isResizingSplit) {
    const splitContainer = document.getElementById('main-split-container');
    const rect = splitContainer.getBoundingClientRect();
    if (state.splitVertical) {
      state.splitRatio = Math.min(72, Math.max(28, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
    } else {
      state.splitRatio = Math.min(72, Math.max(28, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    }
    renderViewLayoutPreferences(state);
  }
});

window.addEventListener('mouseup', () => {
  if (isResizingSidebar) {
    isResizingSidebar = false;
    sidebarResizer?.classList.remove('dragging');
    persistWorkspaceToLocalStorage(state);
  }
  if (isResizingSplit) {
    isResizingSplit = false;
    splitResizer?.classList.remove('dragging');
    persistWorkspaceToLocalStorage(state);
  }
});

document.getElementById('btn-toggle-split-dir')?.addEventListener('click', () => {
  state.splitVertical = !state.splitVertical;
  persistWorkspaceToLocalStorage(state);
  renderViewLayoutPreferences(state);
});
document.getElementById('btn-maximize-resp')?.addEventListener('click', () => {
  state.responseMaximized = !state.responseMaximized;
  persistWorkspaceToLocalStorage(state);
  renderViewLayoutPreferences(state);
});

document.querySelectorAll('[data-side-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.sideTab = btn.getAttribute('data-side-tab');
    persistWorkspaceToLocalStorage(state);
    renderSidebar(state, renderAll);
  });
});

document.querySelectorAll('[data-req-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.reqSubTab = btn.getAttribute('data-req-tab');
    persistWorkspaceToLocalStorage(state);
    renderViewLayoutPreferences(state);
    renderCenterEditor(state, renderAll);
  });
});

document.querySelectorAll('[data-resp-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.respSubTab = btn.getAttribute('data-resp-tab');
    persistWorkspaceToLocalStorage(state);
    renderViewLayoutPreferences(state);
    renderResponsePanel(state);
  });
});

document.getElementById('req-name-input')?.addEventListener('input', (e) => {
  const req = getActiveRequest(state);
  if (!req) return;
  req.name = e.target.value;
  syncActiveRequestToCollection(state);
  const tabTitle = document.querySelector(`[data-tab-id="${req.id}"] .etp-tab-title`);
  if (tabTitle) tabTitle.textContent = req.name || 'Sin nombre';
  renderSidebar(state, renderAll);
});

document.getElementById('req-folder-select')?.addEventListener('change', (e) => {
  const req = getActiveRequest(state);
  if (!req) return;
  const rawVal = e.target.value || '0::';
  const [targetColStr, targetFolderId] = rawVal.split('::');
  const targetColIdx = Number(targetColStr || 0);
  const sourceColIdx = findCollectionIndexOfRequest(state, req.id);
  moveRequestBetweenLocations(state, req.id, sourceColIdx, targetColIdx, targetFolderId || null, null);
  renderAll();
});

document.getElementById('req-method')?.addEventListener('change', (e) => {
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

document.getElementById('req-url')?.addEventListener('input', (e) => {
  const req = getActiveRequest(state);
  if (req) {
    req.url = e.target.value;
    syncActiveRequestToCollection(state);
  }
});

document.getElementById('env-select')?.addEventListener('change', (e) => {
  state.activeEnvId = e.target.value;
  persistWorkspaceToLocalStorage(state);
  renderSidebar(state, renderAll);
  updateUrlPreviewAndInspectorOnly(state);
});

document.getElementById('global-search-scope')?.addEventListener('change', (e) => {
  state.globalSearchScope = e.target.value;
  persistWorkspaceToLocalStorage(state);
  renderSidebar(state, renderAll);
});
document.getElementById('global-search')?.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  renderSidebar(state, renderAll);
});
document.getElementById('btn-clear-global-search')?.addEventListener('click', () => {
  state.searchQuery = '';
  const inp = document.getElementById('global-search');
  if (inp) inp.value = '';
  renderSidebar(state, renderAll);
});

document.getElementById('resp-search-input')?.addEventListener('input', (e) => {
  state.respFilterQuery = e.target.value;
  renderResponsePanel(state);
});
document.getElementById('btn-clear-resp-search')?.addEventListener('click', () => {
  state.respFilterQuery = '';
  const inp = document.getElementById('resp-search-input');
  if (inp) inp.value = '';
  renderResponsePanel(state);
});
document.getElementById('btn-resp-filter-mode')?.addEventListener('click', () => {
  state.respFilterMode = state.respFilterMode === 'all' ? 'filter' : 'all';
  persistWorkspaceToLocalStorage(state);
  renderResponsePanel(state);
});

document.getElementById('btn-run-flow')?.addEventListener('click', () => {
  state.activeMainView = state.activeMainView === 'flows' ? 'workspace' : 'flows';
  persistWorkspaceToLocalStorage(state);
  renderAll();
});

document.getElementById('flows-search-input')?.addEventListener('input', (e) => {
  state.flowsSearchQuery = e.target.value;
  renderFlowsStudioView(state, renderAll);
});

document.getElementById('btn-create-custom-flow')?.addEventListener('click', () => {
  openInputDialog({
    title: translate(state.lang, 'flows.btnNewFlow'),
    label: translate(state.lang, 'request.nameLabel'),
    initialValue: `Flow ${state.customFlows.length + 1}`,
    onConfirm: (name) => {
      const nf = {
        id: 'flw_' + Date.now(),
        name,
        selectedRequestIds: [],
        lastReport: null
      };
      state.customFlows.push(nf);
      state.activeFlowId = nf.id;
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
      showToast(translate(state.lang, 'toasts.createdFlow', { name }));
    }
  });
});

document.getElementById('btn-send-req')?.addEventListener('click', executeActiveRequest);

document.getElementById('btn-open-vault')?.addEventListener('click', () => {
  state.activeMainView = 'workspace';
  state.sidebarVisible = true;
  state.sideTab = 'environments';
  persistWorkspaceToLocalStorage(state);
  renderAll();
});

document.getElementById('btn-toggle-theme')?.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  persistWorkspaceToLocalStorage(state);
  renderAll();
});

document.getElementById('btn-toggle-lang')?.addEventListener('click', () => {
  state.lang = state.lang === 'es' ? 'en' : 'es';
  persistWorkspaceToLocalStorage(state);
  renderAll();
});

document.getElementById('btn-new-collection')?.addEventListener('click', () => {
  openInputDialog({
    title: translate(state.lang, 'sidebar.newCollection'),
    label: translate(state.lang, 'request.nameLabel'),
    initialValue: `Collection ${state.collections.length + 1}`,
    onConfirm: (name) => {
      const newCol = {
        $schema: 'https://eltransportador.dev/schemas/collection-v1.json',
        schemaVersion: 1,
        kind: 'eltransportador.collection',
        metadata: {
          id: 'col_' + Date.now(),
          name,
          description: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          appVersion: APP_VERSION
        },
        defaults: { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, verifyTls: true, headers: [] },
        variables: [],
        folders: [],
        requests: []
      };
      state.collections.push(newCol);
      state.activeCollectionIdx = state.collections.length - 1;
      persistWorkspaceToLocalStorage(state);
      renderAll();
      showToast(translate(state.lang, 'toasts.createdCol', { name }));
    }
  });
});

document.getElementById('btn-new-folder')?.addEventListener('click', () => {
  const col = getActiveCollection(state);
  openInputDialog({
    title: translate(state.lang, 'sidebar.newFolder'),
    label: translate(state.lang, 'request.nameLabel'),
    initialValue: `Folder ${(col.folders || []).length + 1}`,
    onConfirm: (name) => {
      col.folders.push({
        id: 'fld_' + Date.now(),
        name,
        parentId: null
      });
      persistWorkspaceToLocalStorage(state);
      renderAll();
      showToast(translate(state.lang, 'toasts.createdFolder', { name }));
    }
  });
});

document.getElementById('btn-new-request')?.addEventListener('click', () => {
  const col = getActiveCollection(state);
  const newReq = createCleanStarterRequest(state.lang, col.folders[0]?.id || null);
  col.requests.push(newReq);
  state.openTabs.push(JSON.parse(JSON.stringify(newReq)));
  state.activeTabId = newReq.id;
  persistWorkspaceToLocalStorage(state);
  renderAll();
});

document.getElementById('btn-duplicate-req')?.addEventListener('click', () => {
  const cur = getActiveRequest(state);
  if (!cur) return;
  const col = getActiveCollection(state);
  const copy = JSON.parse(JSON.stringify(cur));
  copy.id = 'req_copy_' + Date.now();
  copy.name = cur.name + ' (Copy)';
  col.requests.push(copy);
  state.openTabs.push(JSON.parse(JSON.stringify(copy)));
  state.activeTabId = copy.id;
  persistWorkspaceToLocalStorage(state);
  renderAll();
  showToast(translate(state.lang, 'toasts.duplicatedReq'));
});

document.getElementById('btn-save-req')?.addEventListener('click', async () => {
  const cur = getActiveRequest(state);
  if (!cur) return;
  const ownerIdx = findCollectionIndexOfRequest(state, cur.id);
  const col = state.collections[ownerIdx] || getActiveCollection(state);
  const idx = col.requests.findIndex((r) => r.id === cur.id);
  if (idx >= 0) {
    col.requests[idx] = JSON.parse(JSON.stringify(cur));
  } else {
    col.requests.push(JSON.parse(JSON.stringify(cur)));
  }
  persistWorkspaceToLocalStorage(state);
  showToast(translate(state.lang, 'toasts.savedReq'));
  renderSidebar(state, renderAll);
});

document.getElementById('btn-copy-resp')?.addEventListener('click', () => {
  const req = getActiveRequest(state);
  const resp = req ? state.responsesByReqId[req.id] : null;
  if (!resp || !resp.body) {
    showToast(translate(state.lang, 'toasts.noRespToCopy'), 'warning');
    return;
  }
  copyTextWithToast(resp.body, translate(state.lang, 'toasts.copiedResp'));
});

document.getElementById('btn-download-resp')?.addEventListener('click', () => {
  const req = getActiveRequest(state);
  const resp = req ? state.responsesByReqId[req.id] : null;
  if (!resp) {
    showToast(translate(state.lang, 'toasts.noRespToDownload'), 'warning');
    return;
  }
  const suggested = `${(req.name || 'response').replace(/[^a-z0-9_-]/gi, '_')}.json`;
  saveFileWithPickerAndToast(resp.body || '', suggested);
});

document.getElementById('btn-open-import')?.addEventListener('click', () => {
  document.getElementById('modal-import-title').textContent = translate(state.lang, 'modals.importExportTitle');
  const sanitizedCol = sanitizeCollectionForExport(getActiveCollection(state));
  document.getElementById('import-textarea').value = JSON.stringify(sanitizedCol, null, 2);
  document.getElementById('import-report-box').innerHTML = '';
  document.getElementById('modal-import').classList.add('open');
});
document.getElementById('btn-close-import-modal')?.addEventListener('click', () => {
  document.getElementById('modal-import').classList.remove('open');
});
document.getElementById('btn-export-etp')?.addEventListener('click', () => {
  const sanitizedCol = sanitizeCollectionForExport(getActiveCollection(state));
  document.getElementById('import-textarea').value = JSON.stringify(sanitizedCol, null, 2);
});
document.getElementById('btn-copy-modal-code')?.addEventListener('click', () => {
  const val = document.getElementById('import-textarea').value;
  copyTextWithToast(val, translate(state.lang, 'toasts.copiedContent'));
});
document.getElementById('btn-save-modal-file')?.addEventListener('click', () => {
  const val = document.getElementById('import-textarea').value;
  const isCurl = val.trim().startsWith('curl ');
  const suggested = isCurl ? 'request-curl.sh' : `${(getActiveCollection(state).metadata.name || 'collection').replace(/[^a-z0-9_-]/gi, '_')}.etp.json`;
  saveFileWithPickerAndToast(val, suggested);
});
document.getElementById('btn-execute-import')?.addEventListener('click', () => {
  const raw = document.getElementById('import-textarea').value;
  try {
    const parsed = JSON.parse(raw);
    const discarded = Object.keys(parsed).filter((k) => k.startsWith('x-') || k.toLowerCase().includes('script'));
    if (parsed.kind === 'eltransportador.collection' || Array.isArray(parsed.requests)) {
      const cleanCol = sanitizeImportedCollection(parsed);
      state.collections.push(cleanCol);
      state.activeCollectionIdx = state.collections.length - 1;
      persistWorkspaceToLocalStorage(state);
      renderAll();
    }
    document.getElementById('import-report-box').innerHTML = `
      <div style="padding:8px;background:var(--bg-elevated);border-radius:6px;">
        <span class="etp-pass">${escapeHtml(translate(state.lang, 'toasts.importedOk'))}</span>
        ${discarded.length ? `<br/><small>Discarded untrusted fields: ${escapeHtml(discarded.join(', '))}</small>` : ''}
      </div>
    `;
    showToast(translate(state.lang, 'toasts.importedOk'));
  } catch (e) {
    document.getElementById('import-report-box').innerHTML = `<span class="etp-fail">✗ JSON Error: ${escapeHtml(e.message)}</span>`;
  }
});

document.getElementById('btn-export-curl')?.addEventListener('click', () => {
  const req = getActiveRequest(state);
  const curlCmd = generateCompleteCurlCommand(req, state);
  document.getElementById('modal-import-title').textContent = `cURL — ${req.name}`;
  document.getElementById('import-textarea').value = curlCmd;
  document.getElementById('import-report-box').innerHTML = '';
  document.getElementById('modal-import').classList.add('open');
});

document.getElementById('btn-open-settings')?.addEventListener('click', () => {
  renderSettingsModalContent(state, renderAll);
  document.getElementById('modal-settings').classList.add('open');
});
document.getElementById('btn-close-settings-modal')?.addEventListener('click', () => {
  document.getElementById('modal-settings').classList.remove('open');
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    document.getElementById('global-search')?.focus();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    executeActiveRequest();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    document.getElementById('btn-save-req')?.click();
  }
});

renderAll();
