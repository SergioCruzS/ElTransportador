/**
 * Renderizadores Modulares de Componentes de Interfaz — ElTransportador v1.0.0
 * Archivo: apps/desktop/src/controllers/ui-renderers.js
 *
 * Controles de Seguridad en UI y Bóveda:
 * 1. Secretos de solo creación y eliminación (Inmutables y No Visibles):
 *    Una vez creado un secreto, jamás puede verse (`👁` eliminado en bóveda) ni editarse; solo puede eliminarse o crearse uno nuevo.
 * 2. Eliminación protegida por Contraseña de Administración: sin ingresar la contraseña correcta no es posible eliminar secretos.
 * 3. Aviso de sesión efímera: si el usuario no configura una contraseña en Configuración (⚙), se le notifica que los secretos
 *    agregados no se guardarán y se borrarán al reiniciar la aplicación.
 * 4. Modal de Configuración estilizado con cambio de contraseña (ingresando la anterior para conservar secretos) y
 *    recuperación de contraseña olvidada (con modal de confirmación superpuesto `z-index: 3500` advirtiendo que se borrarán todos los secretos).
 */
import { translate, applyDomTranslations } from '../lang/i18n.js';
import {
  APP_VERSION,
  encryptSecretValue,
  persistWorkspaceToLocalStorage,
  hasAdminPasswordConfigured,
  verifyAdminPassword,
  setInitialAdminPassword,
  changeAdminPasswordPreservingSecrets,
  resetForgottenAdminPasswordWipingSecrets
} from '../services/storage-sync.js';
import {
  buildFullResolvedUrlWithParams,
  maskSecretsInString,
  buildLiveHttpWirePreview,
  executeSingleRequestObject
} from '../services/http-client.js';

export function escapeHtml(val) {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(val) {
  return escapeHtml(val);
}

let draggedReqState = { reqId: null, colIdx: 0 };

export function showToast(message, variant = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `etp-toast ${variant === 'warning' ? 'warning' : variant === 'danger' ? 'danger' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3400);
}

let pendingInputDialogCallback = null;
export function openInputDialog({ title, label, initialValue = '', inputType = 'text', placeholder = '', onConfirm }) {
  document.getElementById('input-dialog-title').textContent = title;
  document.getElementById('input-dialog-label').textContent = label;
  const field = document.getElementById('input-dialog-field');
  field.type = inputType === 'password' ? 'password' : 'text';
  field.placeholder = placeholder || '';
  field.value = initialValue;
  pendingInputDialogCallback = onConfirm;
  document.getElementById('modal-input-dialog').classList.add('open');
  setTimeout(() => field.focus(), 30);
}

export function closeInputDialog() {
  const field = document.getElementById('input-dialog-field');
  if (field) {
    field.value = '';
    field.type = 'text';
  }
  document.getElementById('modal-input-dialog').classList.remove('open');
  pendingInputDialogCallback = null;
}

export function confirmInputDialog() {
  const val = document.getElementById('input-dialog-field').value.trim();
  if (val && typeof pendingInputDialogCallback === 'function') {
    const cb = pendingInputDialogCallback;
    closeInputDialog();
    cb(val);
    return;
  }
  closeInputDialog();
}

let pendingDragMoveAction = null;
export function openConfirmMoveModal(message, onAccept, titleOverride = null) {
  const titleEl = document.getElementById('confirm-move-title');
  if (titleEl) {
    titleEl.textContent = titleOverride || 'Confirmación de seguridad';
  }
  document.getElementById('confirm-move-message').textContent = message;
  pendingDragMoveAction = onAccept;
  document.getElementById('modal-confirm-move').classList.add('open');
}

export function closeConfirmMoveModal() {
  document.getElementById('modal-confirm-move').classList.remove('open');
  pendingDragMoveAction = null;
}

export function acceptConfirmMoveModal() {
  if (typeof pendingDragMoveAction === 'function') {
    const cb = pendingDragMoveAction;
    closeConfirmMoveModal();
    cb();
    return;
  }
  closeConfirmMoveModal();
}

export function getActiveCollection(state) {
  return state.collections[state.activeCollectionIdx] || state.collections[0];
}

export function getActiveRequest(state) {
  return state.openTabs.find((r) => r.id === state.activeTabId) || state.openTabs[0];
}

export function findCollectionIndexOfRequest(state, reqId) {
  for (let i = 0; i < state.collections.length; i++) {
    if ((state.collections[i].requests || []).some((r) => r.id === reqId)) {
      return i;
    }
  }
  return state.activeCollectionIdx || 0;
}

export function moveRequestBetweenLocations(state, reqId, sourceColIdx, targetColIdx, targetFolderId = null, targetIndex = null) {
  const sCol = state.collections[sourceColIdx];
  const tCol = state.collections[targetColIdx];
  if (!sCol || !tCol) return false;

  const sIdx = (sCol.requests || []).findIndex((r) => r.id === reqId);
  const reqObj = sIdx >= 0 ? sCol.requests.splice(sIdx, 1)[0] : state.openTabs.find((t) => t.id === reqId);
  if (!reqObj) return false;

  reqObj.folderId = targetFolderId || null;

  tCol.requests = Array.isArray(tCol.requests) ? tCol.requests : [];
  if (typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex <= tCol.requests.length) {
    tCol.requests.splice(targetIndex, 0, reqObj);
  } else {
    tCol.requests.push(reqObj);
  }

  const tab = state.openTabs.find((t) => t.id === reqId);
  if (tab) {
    tab.folderId = reqObj.folderId;
  }
  state.activeCollectionIdx = targetColIdx;
  persistWorkspaceToLocalStorage(state);
  return true;
}

export function syncActiveRequestToCollection(state) {
  const req = getActiveRequest(state);
  if (!req) return;
  for (const col of state.collections) {
    const idx = (col.requests || []).findIndex((r) => r.id === req.id);
    if (idx >= 0) {
      col.requests[idx] = JSON.parse(JSON.stringify(req));
    }
  }
  persistWorkspaceToLocalStorage(state);
  updateUrlPreviewAndInspectorOnly(state);
}

export function updateUrlPreviewAndInspectorOnly(state) {
  const req = getActiveRequest(state);
  if (!req) return;
  const { text: resolvedUrl, unresolved } = buildFullResolvedUrlWithParams(req, state);
  const urlPrev = document.getElementById('resolved-url-preview');
  if (urlPrev) {
    urlPrev.textContent = `${translate(state.lang, 'request.resolvedUrl')} ${maskSecretsInString(resolvedUrl || '—', state)}`;
  }
  const warnEl = document.getElementById('unresolved-warning');
  if (warnEl) {
    const tlsInsecure = req.settings && req.settings.verifyTls === false;
    const varMsg =
      unresolved.length > 0
        ? `${translate(state.lang, 'request.unresolvedVarsPrefix')} ${unresolved.join(', ')}`
        : translate(state.lang, 'request.varsVerified');
    if (tlsInsecure) {
      warnEl.style.color = 'var(--status-danger)';
      warnEl.textContent = `⚠ Conexión Insegura (TLS sin verificar) • ${varMsg}`;
    } else {
      warnEl.style.color = unresolved.length > 0 ? 'var(--status-warning)' : 'var(--status-success)';
      warnEl.textContent = varMsg;
    }
  }
  const wireEl = document.getElementById('live-wire-preview-pre');
  if (wireEl) {
    wireEl.textContent = buildLiveHttpWirePreview(req, state);
  }
}

export function renderViewLayoutPreferences(state) {
  const wsRoot = document.getElementById('workspace-root');
  const flowsView = document.getElementById('flows-studio-view');
  const btnFlowLbl = document.getElementById('lbl-btn-flow');
  if (state.activeMainView === 'flows') {
    wsRoot.style.display = 'none';
    flowsView.classList.add('active');
    if (btnFlowLbl) btnFlowLbl.textContent = translate(state.lang, 'topbar.btnFlowsBack');
  } else {
    wsRoot.style.display = 'flex';
    flowsView.classList.remove('active');
    if (btnFlowLbl) btnFlowLbl.textContent = translate(state.lang, 'topbar.btnFlows');
  }

  const sidebar = document.getElementById('main-sidebar');
  const pinBtn = document.getElementById('lbl-pin-state');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const toolbar = document.getElementById('sidebar-toolbar');

  sidebar.style.width = state.sidebarVisible ? state.sidebarWidth + 'px' : '0px';
  sidebar.style.minWidth = state.sidebarVisible ? state.sidebarWidth + 'px' : '0px';
  sidebar.classList.toggle('collapsed', !state.sidebarVisible);
  sidebar.classList.toggle('unpinned', !state.sidebarPinned && state.sidebarVisible);
  toggleBtn.classList.toggle('active-toggle', state.sidebarVisible);
  pinBtn.textContent = state.sidebarPinned
    ? translate(state.lang, 'sidebar.pinFixed')
    : translate(state.lang, 'sidebar.pinFloating');

  if (toolbar) {
    toolbar.style.display = state.sideTab === 'collections' ? 'flex' : 'none';
  }

  const splitContainer = document.getElementById('main-split-container');
  const centerPane = document.getElementById('center-request-panel');
  const splitResizer = document.getElementById('split-resizer');
  const maxLbl = document.getElementById('lbl-max-resp');

  splitContainer.classList.toggle('vertical', Boolean(state.splitVertical));
  centerPane.classList.toggle('hidden-when-max', Boolean(state.responseMaximized));
  splitResizer.style.display = state.responseMaximized ? 'none' : 'flex';
  if (maxLbl) {
    maxLbl.textContent = state.responseMaximized
      ? translate(state.lang, 'response.btnRestore')
      : translate(state.lang, 'response.btnMaximize');
  }
  const ratio = Math.min(72, Math.max(28, Number(state.splitRatio) || 48));
  if (state.splitVertical) {
    centerPane.style.height = ratio + '%';
    centerPane.style.width = '100%';
  } else {
    centerPane.style.width = ratio + '%';
    centerPane.style.height = '100%';
  }

  document.querySelectorAll('[data-side-tab]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-side-tab') === state.sideTab);
  });
  document.querySelectorAll('[data-req-tab]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-req-tab') === state.reqSubTab);
  });
  document.querySelectorAll('[data-resp-tab]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-resp-tab') === state.respSubTab);
  });
}

function matchesGlobalQuery(req, q, scope) {
  if (!q) return true;
  const name = (req.name || '').toLowerCase();
  const url = (req.url || '').toLowerCase();
  const method = (req.method || '').toLowerCase();
  if (scope === 'name') return name.includes(q);
  if (scope === 'url') return url.includes(q);
  if (scope === 'method') return method.includes(q);
  return name.includes(q) || url.includes(q) || method.includes(q);
}

/**
 * Renderiza el contenido estilizado del modal de Configuración Global y Administración de Contraseña de Secretos
 */
export function renderSettingsModalContent(state, renderAll) {
  const bodyEl = document.getElementById('modal-settings-body');
  if (!bodyEl) return;

  const hasPwd = hasAdminPasswordConfigured();
  const secretsCount = Object.keys(state.secretVault || {}).length;

  let html = `
    <div class="etp-settings-hero">
      <div style="display:flex;flex-direction:column;gap:3px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <strong style="font-size:14px;">ElTransportador IDE — Seguridad y Administración de Secretos</strong>
          <span class="etp-version-pill">v${escapeHtml(APP_VERSION)}</span>
        </div>
        <span style="font-size:12px;color:var(--text-secondary);">Cada secreto se cifra con su propia llave aleatoria única de 256 bits. La contraseña protege la administración y persistencia de la bóveda.</span>
      </div>
      <div>
        ${hasPwd
          ? `<span class="etp-status-badge status-2xx" id="settings-pwd-status-badge">🟢 Contraseña Activa (${secretsCount} secretos protegidos)</span>`
          : `<span class="etp-status-badge status-4xx" id="settings-pwd-status-badge">🟠 Sin Contraseña (Secretos se borran al reiniciar)</span>`
        }
      </div>
    </div>
  `;

  if (!hasPwd) {
    html += `
      <div class="etp-warning-banner" id="settings-no-pwd-warning">
        <strong>⚠ Aviso: No has configurado una contraseña de administración</strong>
        <span>Si no configuras una contraseña, los secretos que agregues solo funcionarán temporalmente durante esta sesión y <strong>se borrarán automáticamente al reiniciar la aplicación</strong>. Además, sin esta contraseña no podrás eliminar secretos.</span>
      </div>

      <div class="etp-settings-card">
        <div class="etp-settings-card-header">
          <span>🔒 Configurar Contraseña de Administración de Secretos</span>
          <span class="etp-search-badge">Requerida para guardar y eliminar secretos</span>
        </div>
        <div class="etp-settings-grid">
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-init-pwd">Nueva Contraseña (mín. 4 caracteres):</label>
            <input type="password" id="settings-init-pwd" class="etp-input" placeholder="Ingresa tu contraseña de administración..." />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-init-pwd-confirm">Confirmar Contraseña:</label>
            <input type="password" id="settings-init-pwd-confirm" class="etp-input" placeholder="Repite la contraseña..." />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <button type="button" class="etp-btn etp-btn-primary" id="btn-save-initial-pwd">🔒 Guardar Contraseña y Activar Persistencia</button>
        </div>
      </div>
    `;
  } else {
    html += `
      <div class="etp-settings-grid">
        <div class="etp-settings-card">
          <div class="etp-settings-card-header">
            <span>🔑 Cambiar Contraseña (Conservar Secretos)</span>
            <span class="etp-env-badge">Sin pérdida de datos</span>
          </div>
          <p style="font-size:12px;color:var(--text-secondary);">Ingresa tu contraseña anterior para actualizar tu clave de administración manteniendo intactos todos los secretos guardados (${secretsCount}).</p>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-old-pwd">Contraseña Anterior (Actual):</label>
            <input type="password" id="settings-old-pwd" class="etp-input" placeholder="Ingresa tu contraseña actual..." />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-change-new-pwd">Nueva Contraseña:</label>
            <input type="password" id="settings-change-new-pwd" class="etp-input" placeholder="Nueva contraseña (mín. 4 caracteres)..." />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-change-confirm-pwd">Confirmar Nueva Contraseña:</label>
            <input type="password" id="settings-change-confirm-pwd" class="etp-input" placeholder="Confirma la nueva contraseña..." />
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:auto;">
            <button type="button" class="etp-btn etp-btn-primary" id="btn-change-pwd-keep-secrets">✓ Cambiar Contraseña Conservando Secretos</button>
          </div>
        </div>

        <div class="etp-settings-card danger-zone">
          <div class="etp-settings-card-header">
            <span style="color:var(--status-danger);">⚠ Recuperación de Contraseña (¿Olvidaste tu contraseña?)</span>
          </div>
          <div class="etp-danger-banner">
            <strong>Advertencia Crítica:</strong> Si olvidaste tu contraseña anterior, puedes establecer una nueva aquí, pero por seguridad <strong>TODOS los secretos guardados (${secretsCount}) se borrarán permanentemente</strong> al aplicar el cambio.
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-reset-new-pwd">Nueva Contraseña de Recuperación:</label>
            <input type="password" id="settings-reset-new-pwd" class="etp-input" placeholder="Nueva contraseña (mín. 4 caracteres)..." />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-reset-confirm-pwd">Confirmar Nueva Contraseña:</label>
            <input type="password" id="settings-reset-confirm-pwd" class="etp-input" placeholder="Confirma la nueva contraseña..." />
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:auto;">
            <button type="button" class="etp-btn etp-btn-danger" id="btn-reset-forgotten-pwd">🗑 Restablecer Contraseña y Borrar Secretos</button>
          </div>
        </div>
      </div>
    `;
  }

  html += `
    <div class="etp-settings-card">
      <div class="etp-settings-card-header">
        <span>🛡️ Resumen de Políticas Criptográficas y de Red Activas</span>
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);">com.eltransportador.desktop</span>
      </div>
      <table class="etp-kv-table">
        <tbody>
          <tr><td><strong>Cifrado de Secretos</strong></td><td>Llave aleatoria única de 256 bits + Sal de 128 bits + IV de 96 bits + MAC por cada secreto individual</td></tr>
          <tr><td><strong>Política de Bóveda</strong></td><td>Inmutable (los secretos creados no pueden verse ni editarse; eliminar exige contraseña de administración)</td></tr>
          <tr><td><strong>Protección Anti-SSRF</strong></td><td>Validación por cada salto de redirección (bloqueo de <code>169.254.169.254</code>, loopback y redes privadas) y purga cross-origin</td></tr>
          <tr><td><strong>Aislamiento de Vista Previa</strong></td><td><code>&lt;iframe sandbox="" referrerpolicy="no-referrer"&gt;</code> + CSP <code>script-src 'self'</code></td></tr>
        </tbody>
      </table>
    </div>
  `;

  bodyEl.innerHTML = html;

  // Eventos de Configuración Inicial de Contraseña
  document.getElementById('btn-save-initial-pwd')?.addEventListener('click', () => {
    const p1 = (document.getElementById('settings-init-pwd')?.value || '').trim();
    const p2 = (document.getElementById('settings-init-pwd-confirm')?.value || '').trim();
    if (p1.length < 4) {
      showToast('⚠ La contraseña debe tener al menos 4 caracteres.', 'warning');
      return;
    }
    if (p1 !== p2) {
      showToast('✗ Las contraseñas ingresadas no coinciden.', 'danger');
      return;
    }
    const res = setInitialAdminPassword(p1, state);
    if (res.ok) {
      showToast('✓ Contraseña configurada. Tus secretos ahora se guardarán de forma persistente.');
      renderSettingsModalContent(state, renderAll);
      renderAll();
    }
  });

  // Eventos de Cambio de Contraseña Conservando Secretos (con contraseña anterior)
  document.getElementById('btn-change-pwd-keep-secrets')?.addEventListener('click', () => {
    const oldP = (document.getElementById('settings-old-pwd')?.value || '').trim();
    const newP = (document.getElementById('settings-change-new-pwd')?.value || '').trim();
    const confP = (document.getElementById('settings-change-confirm-pwd')?.value || '').trim();
    if (!oldP) {
      showToast('⚠ Debes ingresar tu contraseña anterior para no borrar los secretos.', 'warning');
      return;
    }
    if (newP.length < 4) {
      showToast('⚠ La nueva contraseña debe tener al menos 4 caracteres.', 'warning');
      return;
    }
    if (newP !== confP) {
      showToast('✗ La nueva contraseña y su confirmación no coinciden.', 'danger');
      return;
    }
    const res = changeAdminPasswordPreservingSecrets(oldP, newP, state);
    if (!res.ok) {
      showToast('✗ La contraseña anterior es incorrecta. No se realizó el cambio.', 'danger');
      return;
    }
    showToast('✓ Contraseña actualizada correctamente conservando todos tus secretos guardados.');
    renderSettingsModalContent(state, renderAll);
    renderAll();
  });

  // Eventos de Recuperación por Contraseña Olvidada (con confirmación superpuesta sobre el modal principal)
  document.getElementById('btn-reset-forgotten-pwd')?.addEventListener('click', () => {
    const newP = (document.getElementById('settings-reset-new-pwd')?.value || '').trim();
    const confP = (document.getElementById('settings-reset-confirm-pwd')?.value || '').trim();
    if (newP.length < 4) {
      showToast('⚠ Ingresa una nueva contraseña de al menos 4 caracteres para restablecer.', 'warning');
      return;
    }
    if (newP !== confP) {
      showToast('✗ La nueva contraseña de recuperación y su confirmación no coinciden.', 'danger');
      return;
    }
    openConfirmMoveModal(
      `⚠ ADVERTENCIA CRÍTICA: Estás restableciendo la contraseña sin ingresar la anterior. Todos los secretos guardados (${Object.keys(state.secretVault || {}).length}) se borrarán permanentemente. ¿Deseas continuar y eliminar todos los secretos?`,
      () => {
        resetForgottenAdminPasswordWipingSecrets(newP, state);
        renderSettingsModalContent(state, renderAll);
        renderAll();
        showToast('✓ Contraseña restablecida. Todos los secretos anteriores fueron eliminados por seguridad.', 'warning');
      },
      '⚠ Confirmar Recuperación de Contraseña y Borrado de Secretos'
    );
  });
}

export function renderSidebar(state, renderAll) {
  renderViewLayoutPreferences(state);
  const container = document.getElementById('sidebar-body');
  const q = (state.searchQuery || '').trim().toLowerCase();
  const scope = state.globalSearchScope || 'all';
  const clearBtn = document.getElementById('btn-clear-global-search');
  const countBadge = document.getElementById('global-search-count');
  if (clearBtn) clearBtn.classList.toggle('visible', q.length > 0);

  let totalMatches = 0;
  for (const col of state.collections) {
    for (const r of (col.requests || [])) {
      if (matchesGlobalQuery(r, q, scope)) totalMatches++;
    }
  }
  if (countBadge) {
    countBadge.textContent = q ? `${totalMatches}` : 'Ctrl+K';
  }

  if (state.sideTab === 'collections') {
    let html = '';
    state.collections.forEach((col, colIdx) => {
      const safeColName = escapeHtml(col.metadata?.name || 'Collection');
      html += `
        <div class="etp-tree-collection">
          <div class="etp-tree-col-header" data-drop-col-root="${colIdx}">
            <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;" data-select-col="${colIdx}">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${safeColName}">📦 ${safeColName}</span>
            </div>
            <div class="etp-tree-actions">
              <button type="button" class="etp-icon-btn" data-edit-col="${colIdx}" title="${escapeAttr(translate(state.lang, 'sidebar.renameCollection'))}">✎</button>
              ${state.collections.length > 1 ? `<button type="button" class="etp-icon-btn danger" data-del-col="${colIdx}" title="${escapeAttr(translate(state.lang, 'sidebar.deleteCollection'))}">🗑</button>` : ''}
            </div>
          </div>
          <div class="etp-tree-col-root-drop" data-drop-col-root="${colIdx}">
            ↧ ${escapeHtml(translate(state.lang, 'sidebar.rootDropZone'))}
          </div>
      `;

      for (const folder of (col.folders || [])) {
        const safeFolderName = escapeHtml(folder.name);
        const safeFolderId = escapeAttr(folder.id);
        const folderReqs = (col.requests || []).filter(
          (r) => r.folderId === folder.id && matchesGlobalQuery(r, q, scope)
        );
        html += `
          <div class="etp-tree-folder" data-drop-folder="${safeFolderId}" data-col-idx="${colIdx}">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${safeFolderName}">📁 ${safeFolderName} (${folderReqs.length})</span>
            <div class="etp-tree-actions">
              <button type="button" class="etp-icon-btn" data-edit-folder="${safeFolderId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, 'sidebar.renameFolder'))}">✎</button>
              <button type="button" class="etp-icon-btn danger" data-del-folder="${safeFolderId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, 'sidebar.deleteFolder'))}">🗑</button>
            </div>
          </div>
        `;
        for (const req of folderReqs) {
          const isAct = req.id === state.activeTabId;
          const safeReqId = escapeAttr(req.id);
          const safeReqName = escapeHtml(req.name);
          const safeMethod = escapeHtml((req.method || 'GET').toUpperCase());
          html += `
            <div class="etp-tree-item ${isAct ? 'active' : ''}" draggable="true" data-drag-req="${safeReqId}" data-select-req="${safeReqId}" data-col-idx="${colIdx}" title="${safeReqName}">
              <div class="etp-tree-item-left">
                <span class="etp-drag-handle" title="${escapeAttr(translate(state.lang, 'sidebar.dragHandleTooltip'))}">⋮⋮</span>
                <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
                <span class="etp-tree-item-name">${safeReqName}</span>
              </div>
              <div class="etp-tree-actions">
                <button type="button" class="etp-icon-btn" data-edit-req="${safeReqId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, 'sidebar.renameRequest'))}">✎</button>
                <button type="button" class="etp-icon-btn danger" data-del-req="${safeReqId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, 'sidebar.deleteRequest'))}">🗑</button>
              </div>
            </div>
          `;
        }
      }

      const unfiled = (col.requests || []).filter(
        (r) => !r.folderId && matchesGlobalQuery(r, q, scope)
      );
      for (const req of unfiled) {
        const isAct = req.id === state.activeTabId;
        const safeReqId = escapeAttr(req.id);
        const safeReqName = escapeHtml(req.name);
        const safeMethod = escapeHtml((req.method || 'GET').toUpperCase());
        html += `
          <div class="etp-tree-item ${isAct ? 'active' : ''}" draggable="true" data-drag-req="${safeReqId}" data-select-req="${safeReqId}" data-col-idx="${colIdx}" title="${safeReqName}">
            <div class="etp-tree-item-left">
              <span class="etp-drag-handle" title="${escapeAttr(translate(state.lang, 'sidebar.dragHandleTooltip'))}">⋮⋮</span>
              <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
              <span class="etp-tree-item-name">${safeReqName}</span>
            </div>
            <div class="etp-tree-actions">
              <button type="button" class="etp-icon-btn" data-edit-req="${safeReqId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, 'sidebar.renameRequest'))}">✎</button>
              <button type="button" class="etp-icon-btn danger" data-del-req="${safeReqId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, 'sidebar.deleteRequest'))}">🗑</button>
            </div>
          </div>
        `;
      }
      html += '</div>';
    });

    container.innerHTML = html;

    container.querySelectorAll('[data-drag-req]').forEach((item) => {
      item.addEventListener('dragstart', (e) => {
        draggedReqState = {
          reqId: item.getAttribute('data-drag-req'),
          colIdx: Number(item.getAttribute('data-col-idx') || 0)
        };
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', draggedReqState.reqId);
        }
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.classList.remove('drag-over');
        const targetReqId = item.getAttribute('data-drag-req');
        const targetColIdx = Number(item.getAttribute('data-col-idx') || 0);
        if (!draggedReqState.reqId || draggedReqState.reqId === targetReqId) return;

        const sCol = state.collections[draggedReqState.colIdx];
        const tCol = state.collections[targetColIdx];
        const sourceReq = (sCol?.requests || []).find((r) => r.id === draggedReqState.reqId);
        const targetReq = (tCol?.requests || []).find((r) => r.id === targetReqId);
        if (!sourceReq || !targetReq) return;

        const destFolder = (tCol.folders || []).find((f) => f.id === targetReq.folderId);
        const destLabel = destFolder
          ? `📁 ${destFolder.name} (${tCol.metadata.name})`
          : `📦 ${tCol.metadata.name} ${translate(state.lang, 'request.rootOptionSuffix')}`;

        openConfirmMoveModal(
          translate(state.lang, 'modals.moveReorder', {
            req: sourceReq.name,
            target: targetReq.name,
            dest: destLabel
          }),
          () => {
            const targetIdx = tCol.requests.findIndex((r) => r.id === targetReqId);
            moveRequestBetweenLocations(
              state,
              sourceReq.id,
              draggedReqState.colIdx,
              targetColIdx,
              targetReq.folderId || null,
              targetIdx
            );
            renderAll();
            showToast(translate(state.lang, 'toasts.movedReq', { dest: destLabel }));
          }
        );
      });
    });

    container.querySelectorAll('[data-drop-folder]').forEach((folderEl) => {
      folderEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        folderEl.classList.add('drag-over');
      });
      folderEl.addEventListener('dragleave', () => {
        folderEl.classList.remove('drag-over');
      });
      folderEl.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        folderEl.classList.remove('drag-over');
        const targetFolderId = folderEl.getAttribute('data-drop-folder');
        const targetColIdx = Number(folderEl.getAttribute('data-col-idx') || 0);
        const sCol = state.collections[draggedReqState.colIdx];
        const tCol = state.collections[targetColIdx];
        const sourceReq = (sCol?.requests || []).find((r) => r.id === draggedReqState.reqId);
        const destFolder = (tCol?.folders || []).find((f) => f.id === targetFolderId);
        if (!sourceReq || !destFolder) return;
        if (draggedReqState.colIdx === targetColIdx && sourceReq.folderId === targetFolderId) return;

        const destLabel = `📁 ${destFolder.name} (${tCol.metadata.name})`;
        openConfirmMoveModal(
          translate(state.lang, 'modals.moveBetweenFolders', {
            req: sourceReq.name,
            dest: destLabel
          }),
          () => {
            moveRequestBetweenLocations(state, sourceReq.id, draggedReqState.colIdx, targetColIdx, targetFolderId, null);
            renderAll();
            showToast(translate(state.lang, 'toasts.movedReq', { dest: destLabel }));
          }
        );
      });
    });

    container.querySelectorAll('[data-drop-col-root]').forEach((rootEl) => {
      rootEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        rootEl.classList.add('drag-over');
      });
      rootEl.addEventListener('dragleave', () => {
        rootEl.classList.remove('drag-over');
      });
      rootEl.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        rootEl.classList.remove('drag-over');
        const targetColIdx = Number(rootEl.getAttribute('data-drop-col-root') || 0);
        const sCol = state.collections[draggedReqState.colIdx];
        const tCol = state.collections[targetColIdx];
        const sourceReq = (sCol?.requests || []).find((r) => r.id === draggedReqState.reqId);
        if (!sourceReq || !tCol) return;
        if (draggedReqState.colIdx === targetColIdx && !sourceReq.folderId) return;

        const destLabel = `📦 ${tCol.metadata.name} ${translate(state.lang, 'request.rootOptionSuffix')}`;
        openConfirmMoveModal(
          translate(state.lang, 'modals.moveBetweenFolders', {
            req: sourceReq.name,
            dest: destLabel
          }),
          () => {
            moveRequestBetweenLocations(state, sourceReq.id, draggedReqState.colIdx, targetColIdx, null, null);
            renderAll();
            showToast(translate(state.lang, 'toasts.movedReq', { dest: destLabel }));
          }
        );
      });
    });

    container.querySelectorAll('[data-select-req]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const rId = el.getAttribute('data-select-req');
        const cIdx = Number(el.getAttribute('data-col-idx') || 0);
        state.activeCollectionIdx = cIdx;
        const foundInTabs = state.openTabs.find((t) => t.id === rId);
        if (!foundInTabs) {
          const orig = state.collections[cIdx].requests.find((r) => r.id === rId);
          if (orig) state.openTabs.push(JSON.parse(JSON.stringify(orig)));
        }
        state.activeTabId = rId;
        persistWorkspaceToLocalStorage(state);
        renderAll();
      });
    });

    container.querySelectorAll('[data-edit-col]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cIdx = Number(btn.getAttribute('data-edit-col'));
        const col = state.collections[cIdx];
        openInputDialog({
          title: translate(state.lang, 'sidebar.renameCollection'),
          label: translate(state.lang, 'request.nameLabel'),
          initialValue: col.metadata.name,
          onConfirm: (nextName) => {
            col.metadata.name = nextName;
            persistWorkspaceToLocalStorage(state);
            renderAll();
            showToast(translate(state.lang, 'toasts.renamedCol'));
          }
        });
      });
    });

    container.querySelectorAll('[data-del-col]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cIdx = Number(btn.getAttribute('data-del-col'));
        if (state.collections.length <= 1) return;
        state.collections.splice(cIdx, 1);
        state.activeCollectionIdx = 0;
        persistWorkspaceToLocalStorage(state);
        renderAll();
      });
    });

    container.querySelectorAll('[data-edit-folder]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fId = btn.getAttribute('data-edit-folder');
        const cIdx = Number(btn.getAttribute('data-col-idx'));
        const folder = state.collections[cIdx].folders.find((f) => f.id === fId);
        if (!folder) return;
        openInputDialog({
          title: translate(state.lang, 'sidebar.renameFolder'),
          label: translate(state.lang, 'request.nameLabel'),
          initialValue: folder.name,
          onConfirm: (nextName) => {
            folder.name = nextName;
            persistWorkspaceToLocalStorage(state);
            renderAll();
            showToast(translate(state.lang, 'toasts.renamedFolder'));
          }
        });
      });
    });

    container.querySelectorAll('[data-del-folder]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fId = btn.getAttribute('data-del-folder');
        const cIdx = Number(btn.getAttribute('data-col-idx'));
        const col = state.collections[cIdx];
        col.folders = col.folders.filter((f) => f.id !== fId);
        col.requests.forEach((r) => {
          if (r.folderId === fId) r.folderId = null;
        });
        persistWorkspaceToLocalStorage(state);
        renderAll();
      });
    });

    container.querySelectorAll('[data-edit-req]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rId = btn.getAttribute('data-edit-req');
        const cIdx = Number(btn.getAttribute('data-col-idx'));
        const reqInCol = state.collections[cIdx].requests.find((r) => r.id === rId);
        if (!reqInCol) return;
        openInputDialog({
          title: translate(state.lang, 'sidebar.renameRequest'),
          label: translate(state.lang, 'request.nameLabel'),
          initialValue: reqInCol.name,
          onConfirm: (nextName) => {
            reqInCol.name = nextName;
            const reqInTab = state.openTabs.find((t) => t.id === rId);
            if (reqInTab) reqInTab.name = nextName;
            persistWorkspaceToLocalStorage(state);
            renderAll();
            showToast(translate(state.lang, 'toasts.renamedReq'));
          }
        });
      });
    });

    container.querySelectorAll('[data-del-req]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rId = btn.getAttribute('data-del-req');
        const cIdx = Number(btn.getAttribute('data-col-idx'));
        const col = state.collections[cIdx];
        col.requests = col.requests.filter((r) => r.id !== rId);
        state.openTabs = state.openTabs.filter((t) => t.id !== rId);
        if (state.openTabs.length === 0) {
          const fallbackReq = col.requests[0] || {
            id: 'req_' + Date.now(),
            name: translate(state.lang, 'defaults.firstRequestName'),
            folderId: null,
            method: 'GET',
            url: '',
            params: [],
            headers: [],
            auth: { type: 'none' },
            body: { mode: 'none', raw: '' },
            settings: { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, verifyTls: true },
            assertions: [],
            extractions: []
          };
          if (col.requests.length === 0) col.requests.push(fallbackReq);
          state.openTabs.push(JSON.parse(JSON.stringify(fallbackReq)));
        }
        if (state.activeTabId === rId) {
          state.activeTabId = state.openTabs[0].id;
        }
        persistWorkspaceToLocalStorage(state);
        renderAll();
      });
    });
    return;
  }

  // Pestaña Entornos y Bóveda de Secretos Inmutable (Solo Crear y Eliminar con Contraseña)
  if (state.sideTab === 'environments') {
    const activeEnvObj = state.environments.find((e) => e.id === state.activeEnvId) || null;
    const secretKeys = Object.keys(state.secretVault || {});
    const hasPwd = hasAdminPasswordConfigured();

    let html = `
      <div class="etp-side-card">
        <div class="etp-side-card-title">
          <span>${escapeHtml(translate(state.lang, 'environments.newEnvCardTitle'))}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="text" id="new-env-name-input" class="etp-input" style="flex:1;height:30px;font-size:12px;" placeholder="${escapeAttr(translate(state.lang, 'environments.newEnvPlaceholder'))}" />
          <button type="button" class="etp-btn etp-btn-primary" id="btn-create-env" style="height:30px;padding:0 10px;font-size:12px;">${escapeHtml(translate(state.lang, 'environments.btnCreate'))}</button>
        </div>
      </div>

      <div class="etp-side-card">
        <div class="etp-side-card-title">
          <span>${escapeHtml(translate(state.lang, 'environments.configuredTitle'))}</span>
          <span style="font-size:11px;color:var(--text-muted);">${state.environments.length} ${escapeHtml(translate(state.lang, 'environments.totalSuffix'))}</span>
        </div>
    `;

    if (state.environments.length === 0) {
      html += `<p style="font-size:12px;color:var(--text-muted);padding:4px 2px;">${escapeHtml(translate(state.lang, 'environments.emptyEnvs'))}</p>`;
    } else {
      html += `<div style="display:flex;flex-direction:column;gap:6px;">
        ${state.environments.map((env) => {
          const isAct = env.id === state.activeEnvId;
          const safeEnvId = escapeAttr(env.id);
          const safeEnvName = escapeHtml(env.name);
          return `
            <div class="etp-env-item-card ${isAct ? 'active' : ''}" data-pick-env="${safeEnvId}">
              <div style="min-width:0;flex:1;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeEnvName}</span>
                  ${isAct ? `<span class="etp-env-badge">${escapeHtml(translate(state.lang, 'environments.activeBadge'))}</span>` : ''}
                </div>
                <div style="font-size:11px;color:var(--text-muted);">${(env.variables || []).length} ${escapeHtml(translate(state.lang, 'environments.varsCountSuffix'))}</div>
              </div>
              <div class="etp-tree-actions">
                <button type="button" class="etp-icon-btn" data-rename-env="${safeEnvId}">✎</button>
                <button type="button" class="etp-icon-btn danger" data-delete-env="${safeEnvId}">🗑</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>`;
    }
    html += `</div>`;

    if (activeEnvObj) {
      html += `
        <div class="etp-side-card">
          <div class="etp-side-card-title">
            <span>${escapeHtml(translate(state.lang, 'environments.varsOfPrefix'))} «${escapeHtml(activeEnvObj.name)}»</span>
            <button type="button" class="etp-btn-xs" id="btn-add-env-var">${escapeHtml(translate(state.lang, 'environments.btnAddVar'))}</button>
          </div>
          <table class="etp-kv-table">
            <thead><tr><th style="width:24px;">${escapeHtml(translate(state.lang, 'environments.colOn'))}</th><th>${escapeHtml(translate(state.lang, 'environments.colVariable'))}</th><th>${escapeHtml(translate(state.lang, 'environments.colValue'))}</th><th style="width:68px;">🔒</th></tr></thead>
            <tbody>
              ${(activeEnvObj.variables || []).map((v, vIdx) => {
                const isSensVar = Boolean(v.isSecret) || /secret|token|password|apikey|api_key/i.test(v.key || '');
                const revKey = `${activeEnvObj.id}_${vIdx}`;
                const isRevealed = Boolean(state.revealedEnvVars?.[revKey]);
                const inputType = isSensVar && !isRevealed ? 'password' : 'text';
                return `
                  <tr>
                    <td><input type="checkbox" data-env-var-toggle="${vIdx}" ${v.enabled ? 'checked' : ''} /></td>
                    <td><input class="etp-kv-input" data-env-var-key="${vIdx}" value="${escapeAttr(v.key)}" placeholder="base_url" /></td>
                    <td><input type="${inputType}" class="etp-kv-input" data-env-var-val="${vIdx}" value="${escapeAttr(v.value)}" placeholder="https://..." /></td>
                    <td style="white-space:nowrap;">
                      <input type="checkbox" data-env-var-sec="${vIdx}" title="Variable secreta (cifrada en reposo)" ${isSensVar ? 'checked' : ''} />
                      ${isSensVar ? `<button type="button" class="etp-icon-btn" data-env-var-reveal="${vIdx}" title="${escapeAttr(translate(state.lang, 'environments.showHide'))}">👁</button>` : ''}
                      <button type="button" class="etp-icon-btn danger" data-env-var-del="${vIdx}">×</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    html += `
      <div class="etp-side-card">
        <div class="etp-side-card-title">
          <span>${escapeHtml(translate(state.lang, 'environments.vaultTitle'))} (${secretKeys.length})</span>
          <button type="button" class="etp-btn-xs" id="btn-vault-open-settings" title="Configurar o cambiar contraseña de administración">⚙ Contraseña</button>
        </div>

        ${!hasPwd ? `
          <div class="etp-warning-banner" id="no-admin-pwd-warning-banner">
            <strong>⚠ Sin Contraseña de Administración Configurada</strong>
            <span>Los secretos que agregues no se guardarán en disco y <strong>se borrarán al reiniciar la aplicación</strong>. Configura una contraseña en ⚙ Configuración para conservarlos y poder administrarlos.</span>
          </div>
        ` : ''}

        <p style="font-size:11px;color:var(--text-muted);">Los secretos tienen cifrado único y <strong>no pueden verse ni editarse</strong> una vez creados. Usa <code>\${secret:clave}</code> en tus peticiones:</p>

        <div style="display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:6px;background:var(--bg-elevated);border:1px solid var(--border-subtle);">
          <input type="text" id="new-secret-key-input" class="etp-input" style="height:28px;font-size:12px;font-family:var(--font-mono);" placeholder="Clave del nuevo secreto (ej. api_token)" />
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="password" id="new-secret-val-input" class="etp-input" style="flex:1;height:28px;font-size:12px;" placeholder="Valor secreto (se cifrará de forma única)..." />
            <button type="button" class="etp-btn etp-btn-primary" id="btn-add-secret-row" style="height:28px;padding:0 10px;font-size:11.5px;">${escapeHtml(translate(state.lang, 'environments.btnAddSecret'))}</button>
          </div>
        </div>

        <table class="etp-kv-table">
          <thead><tr><th>${escapeHtml(translate(state.lang, 'environments.colKey'))}</th><th>Estado Criptográfico</th><th style="width:36px;"></th></tr></thead>
          <tbody>
            ${secretKeys.length === 0 ? `
              <tr><td colspan="3" style="text-align:center;color:var(--text-muted);font-size:11.5px;padding:10px;">No hay secretos registrados en la bóveda.</td></tr>
            ` : secretKeys.map((sKey) => {
              const safeSKey = escapeAttr(sKey);
              return `
                <tr data-secret-row="${safeSKey}">
                  <td style="font-family:var(--font-mono);font-weight:700;font-size:12px;">${escapeHtml(sKey)}</td>
                  <td><span class="etp-secret-locked-mask" data-sec-locked="${safeSKey}">•••••••••••• 🔒 Cifrado único</span></td>
                  <td style="text-align:center;">
                    <button type="button" class="etp-icon-btn danger" data-sec-del="${safeSKey}" title="Eliminar secreto (requiere contraseña de administración)">🗑</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = html;

    document.getElementById('btn-vault-open-settings')?.addEventListener('click', () => {
      renderSettingsModalContent(state, renderAll);
      document.getElementById('modal-settings').classList.add('open');
    });

    document.getElementById('btn-create-env').addEventListener('click', () => {
      const inp = document.getElementById('new-env-name-input');
      const name = (inp.value || '').trim() || `Environment ${state.environments.length + 1}`;
      const newEnv = {
        id: 'env_' + Date.now(),
        name,
        variables: [{ key: 'base_url', value: 'https://api.ejemplo.com', enabled: true, isSecret: false }]
      };
      state.environments.push(newEnv);
      state.activeEnvId = newEnv.id;
      persistWorkspaceToLocalStorage(state);
      renderAll();
      showToast(translate(state.lang, 'toasts.createdEnv', { name }));
    });

    document.getElementById('new-env-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-create-env').click();
      }
    });

    container.querySelectorAll('[data-pick-env]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const id = el.getAttribute('data-pick-env');
        state.activeEnvId = state.activeEnvId === id ? 'none' : id;
        persistWorkspaceToLocalStorage(state);
        renderAll();
      });
    });

    container.querySelectorAll('[data-rename-env]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-rename-env');
        const env = state.environments.find((x) => x.id === id);
        if (!env) return;
        openInputDialog({
          title: translate(state.lang, 'environments.configuredTitle'),
          label: translate(state.lang, 'request.nameLabel'),
          initialValue: env.name,
          onConfirm: (nextName) => {
            env.name = nextName;
            persistWorkspaceToLocalStorage(state);
            renderAll();
            showToast(translate(state.lang, 'toasts.renamedEnv', { name: nextName }));
          }
        });
      });
    });

    container.querySelectorAll('[data-delete-env]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-delete-env');
        state.environments = state.environments.filter((x) => x.id !== id);
        if (state.activeEnvId === id) state.activeEnvId = state.environments[0]?.id || 'none';
        persistWorkspaceToLocalStorage(state);
        renderAll();
      });
    });

    const btnAddEnvVar = document.getElementById('btn-add-env-var');
    if (btnAddEnvVar && activeEnvObj) {
      btnAddEnvVar.addEventListener('click', () => {
        activeEnvObj.variables.push({ key: 'nueva_var', value: 'valor', enabled: true, isSecret: false });
        persistWorkspaceToLocalStorage(state);
        renderSidebar(state, renderAll);
        updateUrlPreviewAndInspectorOnly(state);
      });
    }

    container.querySelectorAll('[data-env-var-toggle]').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const idx = Number(chk.getAttribute('data-env-var-toggle'));
        if (activeEnvObj && activeEnvObj.variables[idx]) {
          activeEnvObj.variables[idx].enabled = e.target.checked;
          persistWorkspaceToLocalStorage(state);
          updateUrlPreviewAndInspectorOnly(state);
        }
      });
    });
    container.querySelectorAll('[data-env-var-key]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = Number(inp.getAttribute('data-env-var-key'));
        if (activeEnvObj && activeEnvObj.variables[idx]) {
          activeEnvObj.variables[idx].key = e.target.value;
          persistWorkspaceToLocalStorage(state);
          updateUrlPreviewAndInspectorOnly(state);
        }
      });
    });
    container.querySelectorAll('[data-env-var-val]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = Number(inp.getAttribute('data-env-var-val'));
        if (activeEnvObj && activeEnvObj.variables[idx]) {
          activeEnvObj.variables[idx].value = e.target.value;
          persistWorkspaceToLocalStorage(state);
          updateUrlPreviewAndInspectorOnly(state);
        }
      });
    });
    container.querySelectorAll('[data-env-var-sec]').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const idx = Number(chk.getAttribute('data-env-var-sec'));
        if (activeEnvObj && activeEnvObj.variables[idx]) {
          activeEnvObj.variables[idx].isSecret = e.target.checked;
          persistWorkspaceToLocalStorage(state);
          renderSidebar(state, renderAll);
        }
      });
    });
    container.querySelectorAll('[data-env-var-reveal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-env-var-reveal'));
        if (!activeEnvObj) return;
        const revKey = `${activeEnvObj.id}_${idx}`;
        state.revealedEnvVars = state.revealedEnvVars || {};
        state.revealedEnvVars[revKey] = !state.revealedEnvVars[revKey];
        renderSidebar(state, renderAll);
      });
    });
    container.querySelectorAll('[data-env-var-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-env-var-del'));
        if (activeEnvObj) {
          activeEnvObj.variables.splice(idx, 1);
          persistWorkspaceToLocalStorage(state);
          renderSidebar(state, renderAll);
          updateUrlPreviewAndInspectorOnly(state);
        }
      });
    });

    // Crear nuevo secreto con cifrado único e inmutable
    document.getElementById('btn-add-secret-row').addEventListener('click', () => {
      const keyInp = document.getElementById('new-secret-key-input');
      const valInp = document.getElementById('new-secret-val-input');
      let keyName = (keyInp?.value || '').trim().replace(/[^a-zA-Z0-9_.\-]/g, '_');
      const secretVal = valInp?.value || '';

      if (!keyName) {
        let idx = Object.keys(state.secretVault).length + 1;
        keyName = 'secret_' + idx;
        while (state.secretVault[keyName] !== undefined) {
          idx++;
          keyName = 'secret_' + idx;
        }
      }
      if (state.secretVault[keyName] !== undefined) {
        showToast(`⚠ El secreto «${keyName}» ya existe y no es editable. Elimínalo primero con tu contraseña si deseas reemplazarlo.`, 'warning');
        return;
      }
      if (!secretVal) {
        showToast('⚠ Ingresa el valor del secreto antes de crearlo.', 'warning');
        return;
      }

      state.secretVault[keyName] = secretVal;
      state.secretCiphersByKey = state.secretCiphersByKey || {};
      state.secretCiphersByKey[keyName] = encryptSecretValue(secretVal);

      persistWorkspaceToLocalStorage(state);
      renderSidebar(state, renderAll);
      updateUrlPreviewAndInspectorOnly(state);

      if (!hasAdminPasswordConfigured()) {
        showToast('⚠ Secreto creado temporalmente: configura una contraseña en ⚙ Configuración o se borrará al reiniciar la aplicación.', 'warning');
      } else {
        showToast(`✓ Secreto «${keyName}» cifrado de forma única y guardado.`);
      }
    });

    // Eliminar secreto: exige obligatoriamente la Contraseña de Administración
    container.querySelectorAll('[data-sec-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sKey = btn.getAttribute('data-sec-del');
        if (!hasAdminPasswordConfigured()) {
          showToast('🔒 Para eliminar secretos debes configurar primero una Contraseña de Administración en ⚙ Configuración.', 'warning');
          renderSettingsModalContent(state, renderAll);
          document.getElementById('modal-settings').classList.add('open');
          return;
        }
        openInputDialog({
          title: '🔒 Autorización Requerida para Eliminar Secreto',
          label: `Ingresa tu Contraseña de Administración para eliminar permanentemente el secreto «${sKey}»:`,
          initialValue: '',
          inputType: 'password',
          placeholder: 'Contraseña de administración...',
          onConfirm: (enteredPwd) => {
            if (!verifyAdminPassword(enteredPwd)) {
              showToast(`✗ Contraseña incorrecta. No se eliminó el secreto «${sKey}».`, 'danger');
              return;
            }
            delete state.secretVault[sKey];
            if (state.secretCiphersByKey) {
              delete state.secretCiphersByKey[sKey];
            }
            persistWorkspaceToLocalStorage(state);
            renderSidebar(state, renderAll);
            updateUrlPreviewAndInspectorOnly(state);
            showToast(`✓ Secreto «${sKey}» eliminado correctamente.`);
          }
        });
      });
    });
    return;
  }

  // Pestaña Historial
  if (state.sideTab === 'history') {
    const filteredHist = state.history.filter(
      (h) => matchesGlobalQuery(h, q, scope)
    );
    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">${escapeHtml(translate(state.lang, 'history.title'))} (${filteredHist.length})</span>
        <button type="button" class="etp-btn-xs" id="btn-clear-history">${escapeHtml(translate(state.lang, 'history.btnClear'))}</button>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">${escapeHtml(translate(state.lang, 'history.hint'))}</p>
    `;
    if (filteredHist.length === 0) {
      html += `<p style="font-size:12px;color:var(--text-muted);padding:8px;">${escapeHtml(translate(state.lang, 'history.empty'))}</p>`;
    } else {
      for (const h of filteredHist) {
        const isErr = !h.status || h.status >= 400;
        const safeMethod = escapeHtml((h.method || 'GET').toUpperCase());
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
              <span style="font-size:11px;font-family:var(--font-mono);font-weight:600;color:${isErr ? 'var(--status-danger)' : 'var(--status-success)'};">${escapeHtml(h.status || 'ERR')}</span>
              <button type="button" class="etp-icon-btn danger" data-del-hist="${safeHId}" title="${escapeAttr(translate(state.lang, 'history.deleteEntry'))}">×</button>
            </div>
          </div>
        `;
      }
    }
    container.innerHTML = html;

    container.querySelectorAll('[data-hist-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const hId = el.getAttribute('data-hist-id');
        const entry = state.history.find((x) => x.id === hId);
        if (!entry || !entry.requestSnapshot) return;

        let origReq = null;
        for (const col of state.collections) {
          const found = (col.requests || []).find((r) => r.id === entry.requestId);
          if (found) {
            origReq = JSON.parse(JSON.stringify(found));
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
        if (entry.responseSnapshot) {
          state.responsesByReqId[restoredReq.id] = JSON.parse(JSON.stringify(entry.responseSnapshot));
        }
        persistWorkspaceToLocalStorage(state);
        renderAll();
      });
    });

    container.querySelectorAll('[data-del-hist]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const hId = btn.getAttribute('data-del-hist');
        state.history = state.history.filter((x) => x.id !== hId);
        persistWorkspaceToLocalStorage(state);
        renderSidebar(state, renderAll);
      });
    });

    const btnClear = document.getElementById('btn-clear-history');
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        state.history = [];
        persistWorkspaceToLocalStorage(state);
        try { await fetch('/__etp_ipc__/clear_history', { method: 'POST', body: '{}' }); } catch {}
        renderSidebar(state, renderAll);
      });
    }
  }
}

export function renderCenterEditor(state, renderAll) {
  const tabsBar = document.getElementById('open-tabs-bar');
  tabsBar.innerHTML =
    state.openTabs.map((t) => {
      const safeId = escapeAttr(t.id);
      const safeMethod = escapeHtml((t.method || 'GET').toUpperCase());
      return `
        <div class="etp-req-tab ${t.id === state.activeTabId ? 'active' : ''}" data-tab-id="${safeId}">
          <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
          <span class="etp-tab-title">${escapeHtml(t.name)}</span>
          <button type="button" class="etp-tab-close" data-close-tab="${safeId}" title="${escapeAttr(translate(state.lang, 'request.closeTabTooltip'))}">×</button>
        </div>
      `;
    }).join('') +
    `<button type="button" class="etp-btn-xs" id="btn-add-tab-inline" title="${escapeAttr(translate(state.lang, 'request.newTabTooltip'))}" style="margin-left:4px;flex-shrink:0;">+</button>`;

  tabsBar.querySelectorAll('[data-tab-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-tab]')) return;
      state.activeTabId = el.getAttribute('data-tab-id');
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });

  tabsBar.querySelectorAll('[data-close-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const closeId = btn.getAttribute('data-close-tab');
      const idx = state.openTabs.findIndex((t) => t.id === closeId);
      if (idx < 0) return;
      state.openTabs.splice(idx, 1);
      if (state.openTabs.length === 0) {
        const blankReq = {
          id: 'req_' + Date.now(),
          name: translate(state.lang, 'defaults.firstRequestName'),
          folderId: null,
          method: 'GET',
          url: '',
          params: [],
          headers: [{ id: 'h_' + Date.now(), key: 'Accept', value: 'application/json', enabled: true }],
          auth: { type: 'none' },
          body: { mode: 'none', raw: '' },
          settings: { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, verifyTls: true },
          assertions: [],
          extractions: []
        };
        state.openTabs.push(blankReq);
      }
      if (state.activeTabId === closeId) {
        const nextTab = state.openTabs[Math.min(idx, state.openTabs.length - 1)];
        state.activeTabId = nextTab.id;
      }
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });

  document.getElementById('btn-add-tab-inline').addEventListener('click', () => {
    document.getElementById('btn-new-request').click();
  });

  const req = getActiveRequest(state);
  if (!req) return;

  document.getElementById('req-name-input').value = req.name || '';

  const folderSelect = document.getElementById('req-folder-select');
  const currentOwnerColIdx = findCollectionIndexOfRequest(state, req.id);
  const optGroups = [];
  state.collections.forEach((col, cIdx) => {
    const isThisCol = cIdx === currentOwnerColIdx;
    const rootSelected = isThisCol && !req.folderId ? 'selected' : '';
    const safeColName = escapeHtml(col.metadata?.name || 'Collection');
    let groupHtml = `<optgroup label="📦 ${safeColName}">`;
    groupHtml += `<option value="${cIdx}::" ${rootSelected}>📦 ${safeColName} — ${escapeHtml(translate(state.lang, 'request.rootOptionSuffix'))}</option>`;
    for (const f of (col.folders || [])) {
      const fSelected = isThisCol && req.folderId === f.id ? 'selected' : '';
      groupHtml += `<option value="${cIdx}::${escapeAttr(f.id)}" ${fSelected}>📁 ${safeColName} / ${escapeHtml(f.name)}</option>`;
    }
    groupHtml += `</optgroup>`;
    optGroups.push(groupHtml);
  });
  folderSelect.innerHTML = optGroups.join('');

  document.getElementById('req-method').value = req.method;
  document.getElementById('req-url').value = req.url;

  updateUrlPreviewAndInspectorOnly(state);

  const pane = document.getElementById('req-editor-pane');
  let subContentHtml = '';

  if (state.reqSubTab === 'params') {
    req.params = Array.isArray(req.params) ? req.params : [];
    subContentHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${escapeHtml(translate(state.lang, 'request.paramsTitle'))} (${req.params.length})</strong>
        <button type="button" class="etp-btn-xs" id="btn-add-param">${escapeHtml(translate(state.lang, 'request.btnAddParam'))}</button>
      </div>
      <table class="etp-kv-table">
        <thead><tr><th style="width:32px;">${escapeHtml(translate(state.lang, 'environments.colOn'))}</th><th>${escapeHtml(translate(state.lang, 'environments.colKey'))}</th><th>${escapeHtml(translate(state.lang, 'environments.colValue'))}</th><th>${escapeHtml(translate(state.lang, 'request.colDescription'))}</th><th style="width:30px;"></th></tr></thead>
        <tbody>
          ${req.params.map((p, idx) => `
            <tr>
              <td><input type="checkbox" data-param-toggle="${idx}" ${p.enabled ? 'checked' : ''} /></td>
              <td><input class="etp-kv-input" data-param-key="${idx}" value="${escapeAttr(p.key || '')}" placeholder="key" /></td>
              <td><input class="etp-kv-input" data-param-val="${idx}" value="${escapeAttr(p.value || '')}" placeholder="value" /></td>
              <td><input class="etp-kv-input" data-param-desc="${idx}" value="${escapeAttr(p.description || '')}" placeholder="${escapeAttr(translate(state.lang, 'request.optionalPlaceholder'))}" /></td>
              <td><button type="button" class="etp-icon-btn danger" data-param-del="${idx}">×</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (state.reqSubTab === 'headers') {
    req.headers = Array.isArray(req.headers) ? req.headers : [];
    subContentHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${escapeHtml(translate(state.lang, 'request.headersTitle'))} (${req.headers.length})</strong>
        <button type="button" class="etp-btn-xs" id="btn-add-header">${escapeHtml(translate(state.lang, 'request.btnAddHeader'))}</button>
      </div>
      <table class="etp-kv-table">
        <thead><tr><th style="width:32px;">${escapeHtml(translate(state.lang, 'environments.colOn'))}</th><th>Header</th><th>${escapeHtml(translate(state.lang, 'environments.colValue'))}</th><th style="width:85px;">${escapeHtml(translate(state.lang, 'request.colSecret'))}</th><th style="width:30px;"></th></tr></thead>
        <tbody>
          ${req.headers.map((h, idx) => {
            const isSensHeader = Boolean(h.isSecret) || /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test((h.key || '').trim());
            const isRev = Boolean(state.revealedHeaders?.[ `${req.id}_${idx}` ]);
            const inpType = isSensHeader && !isRev ? 'password' : 'text';
            return `
              <tr>
                <td><input type="checkbox" data-hdr-toggle="${idx}" ${h.enabled ? 'checked' : ''} /></td>
                <td><input class="etp-kv-input" data-hdr-key="${idx}" value="${escapeAttr(h.key || '')}" placeholder="X-Header" /></td>
                <td><input type="${inpType}" class="etp-kv-input" data-hdr-val="${idx}" value="${escapeAttr(h.value || '')}" placeholder="Value / \${secret:key}" /></td>
                <td>
                  <div style="display:flex;align-items:center;gap:4px;">
                    <label style="font-size:11px;display:flex;align-items:center;gap:3px;"><input type="checkbox" data-hdr-sec="${idx}" ${isSensHeader ? 'checked' : ''} /> 🔒</label>
                    ${isSensHeader ? `<button type="button" class="etp-icon-btn" data-hdr-reveal="${idx}" title="Mostrar / Ocultar valor">👁</button>` : ''}
                  </div>
                </td>
                <td><button type="button" class="etp-icon-btn danger" data-hdr-del="${idx}">×</button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } else if (state.reqSubTab === 'auth') {
    req.auth = req.auth || { type: 'none' };
    const auth = req.auth;
    subContentHtml = `
      <div class="etp-auth-card">
        <div class="etp-auth-grid">
          <label class="etp-auth-label" for="auth-type-select">${escapeHtml(translate(state.lang, 'request.authTypeLabel'))}</label>
          <div class="etp-auth-field-wrap">
            <select id="auth-type-select" class="etp-select">
              <option value="none" ${auth.type === 'none' ? 'selected' : ''}>${escapeHtml(translate(state.lang, 'request.authNone'))}</option>
              <option value="bearer" ${auth.type === 'bearer' ? 'selected' : ''}>${escapeHtml(translate(state.lang, 'request.authBearer'))}</option>
              <option value="basic" ${auth.type === 'basic' ? 'selected' : ''}>${escapeHtml(translate(state.lang, 'request.authBasic'))}</option>
              <option value="apikey" ${auth.type === 'apikey' ? 'selected' : ''}>${escapeHtml(translate(state.lang, 'request.authApiKey'))}</option>
            </select>
          </div>

          ${auth.type === 'bearer' ? `
            <label class="etp-auth-label" for="auth-bearer-input">${escapeHtml(translate(state.lang, 'request.authBearerLabel'))}</label>
            <div class="etp-auth-field-wrap">
              <input type="${state.showBearerToken ? 'text' : 'password'}" id="auth-bearer-input" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(auth.bearerToken || '')}" placeholder="${escapeAttr(translate(state.lang, 'request.authBearerPlaceholder'))}" />
              <button type="button" class="etp-btn-xs" id="btn-toggle-bearer-vis" style="height:34px;padding:0 10px;" title="Mostrar u ocultar Token Bearer">👁</button>
            </div>
          ` : auth.type === 'basic' ? `
            <label class="etp-auth-label" for="auth-basic-user">${escapeHtml(translate(state.lang, 'request.authUserLabel'))}</label>
            <div class="etp-auth-field-wrap">
              <input type="text" id="auth-basic-user" class="etp-input" value="${escapeAttr(auth.basicUsername || '')}" placeholder="${escapeAttr(translate(state.lang, 'request.authUserPlaceholder'))}" />
            </div>
            <label class="etp-auth-label" for="auth-basic-pass">${escapeHtml(translate(state.lang, 'request.authPassLabel'))}</label>
            <div class="etp-auth-field-wrap">
              <input type="${state.showBasicPassword ? 'text' : 'password'}" id="auth-basic-pass" class="etp-input" value="${escapeAttr(auth.basicPassword || '')}" placeholder="${escapeAttr(translate(state.lang, 'request.authPassPlaceholder'))}" />
              <button type="button" class="etp-btn-xs" id="btn-toggle-basic-pass" style="height:34px;padding:0 10px;" title="Mostrar u ocultar contraseña">👁</button>
            </div>
          ` : auth.type === 'apikey' ? `
            <label class="etp-auth-label" for="auth-apikey-name">${escapeHtml(translate(state.lang, 'request.authKeyNameLabel'))}</label>
            <div class="etp-auth-field-wrap">
              <input type="text" id="auth-apikey-name" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(auth.apiKeyName || 'X-API-Key')}" placeholder="X-API-Key" />
            </div>
            <label class="etp-auth-label" for="auth-apikey-val">${escapeHtml(translate(state.lang, 'request.authKeyValLabel'))}</label>
            <div class="etp-auth-field-wrap">
              <input type="${state.showApiKeyValue ? 'text' : 'password'}" id="auth-apikey-val" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(auth.apiKeyValue || '')}" placeholder="ak_live_..." />
              <button type="button" class="etp-btn-xs" id="btn-toggle-apikey-vis" style="height:34px;padding:0 10px;" title="Mostrar u ocultar API Key">👁</button>
            </div>
            <label class="etp-auth-label" for="auth-apikey-in">${escapeHtml(translate(state.lang, 'request.authKeyInLabel'))}</label>
            <div class="etp-auth-field-wrap">
              <select id="auth-apikey-in" class="etp-select">
                <option value="header" ${(auth.apiKeyIn || 'header') === 'header' ? 'selected' : ''}>${escapeHtml(translate(state.lang, 'request.authKeyInHeader'))}</option>
                <option value="query" ${auth.apiKeyIn === 'query' ? 'selected' : ''}>${escapeHtml(translate(state.lang, 'request.authKeyInQuery'))}</option>
              </select>
            </div>
          ` : ''}
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);padding-top:8px;border-top:1px solid var(--border-subtle);">
          ${auth.type === 'none'
            ? escapeHtml(translate(state.lang, 'request.authNoneHint'))
            : escapeHtml(translate(state.lang, 'request.authProtectedHint'))}
        </div>
      </div>
    `;
  } else if (state.reqSubTab === 'body') {
    req.body = req.body || { mode: 'none', raw: '', urlencoded: [], multipart: [] };
    const body = req.body;
    const rawText = body.raw || '';
    const linesCount = Math.max(1, rawText.split('\n').length);
    let jsonValidStatus = '<span id="json-valid-indicator"></span>';
    if (body.mode === 'json' && rawText.trim()) {
      try {
        JSON.parse(rawText);
        jsonValidStatus = `<span id="json-valid-indicator" style="color:var(--status-success);font-weight:600;">${escapeHtml(translate(state.lang, 'request.jsonValid'))}</span>`;
      } catch (err) {
        jsonValidStatus = `<span id="json-valid-indicator" style="color:var(--status-danger);font-weight:600;">${escapeHtml(translate(state.lang, 'request.jsonErrorPrefix'))} ${escapeHtml(err.message)}</span>`;
      }
    }

    subContentHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <strong>${escapeHtml(translate(state.lang, 'request.bodyModeLabel'))}</strong>
          <select id="body-mode-select" class="etp-select">
            <option value="none" ${body.mode === 'none' ? 'selected' : ''}>none</option>
            <option value="json" ${body.mode === 'json' ? 'selected' : ''}>application/json</option>
            <option value="text" ${body.mode === 'text' ? 'selected' : ''}>text/plain</option>
            <option value="urlencoded" ${body.mode === 'urlencoded' ? 'selected' : ''}>application/x-www-form-urlencoded</option>
            <option value="multipart" ${body.mode === 'multipart' ? 'selected' : ''}>multipart/form-data</option>
          </select>
        </div>
        ${jsonValidStatus}
      </div>
    `;

    if (body.mode === 'urlencoded') {
      body.urlencoded = Array.isArray(body.urlencoded) ? body.urlencoded : [];
      subContentHtml += `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span>${escapeHtml(translate(state.lang, 'request.urlencTitle'))} (${body.urlencoded.length})</span>
          <button type="button" class="etp-btn-xs" id="btn-add-urlenc">${escapeHtml(translate(state.lang, 'request.btnAddField'))}</button>
        </div>
        <table class="etp-kv-table">
          <thead><tr><th style="width:32px;">On</th><th>${escapeHtml(translate(state.lang, 'environments.colKey'))}</th><th>${escapeHtml(translate(state.lang, 'environments.colValue'))}</th><th style="width:30px;"></th></tr></thead>
          <tbody>
            ${body.urlencoded.map((u, idx) => `
              <tr>
                <td><input type="checkbox" data-urlenc-toggle="${idx}" ${u.enabled ? 'checked' : ''} /></td>
                <td><input class="etp-kv-input" data-urlenc-key="${idx}" value="${escapeAttr(u.key || '')}" /></td>
                <td><input class="etp-kv-input" data-urlenc-val="${idx}" value="${escapeAttr(u.value || '')}" /></td>
                <td><button type="button" class="etp-icon-btn danger" data-urlenc-del="${idx}">×</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else if (body.mode === 'multipart') {
      body.multipart = Array.isArray(body.multipart) ? body.multipart : [];
      subContentHtml += `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span>${escapeHtml(translate(state.lang, 'request.mpTitle'))} (${body.multipart.length})</span>
          <button type="button" class="etp-btn-xs" id="btn-add-multipart">${escapeHtml(translate(state.lang, 'request.btnAddPart'))}</button>
        </div>
        <table class="etp-kv-table">
          <thead><tr><th style="width:32px;">On</th><th>${escapeHtml(translate(state.lang, 'environments.colKey'))}</th><th>${escapeHtml(translate(state.lang, 'environments.colValue'))}</th><th style="width:30px;"></th></tr></thead>
          <tbody>
            ${body.multipart.map((m, idx) => `
              <tr>
                <td><input type="checkbox" data-mp-toggle="${idx}" ${m.enabled ? 'checked' : ''} /></td>
                <td><input class="etp-kv-input" data-mp-key="${idx}" value="${escapeAttr(m.key || '')}" /></td>
                <td><input class="etp-kv-input" data-mp-val="${idx}" value="${escapeAttr(m.value || '')}" /></td>
                <td><button type="button" class="etp-icon-btn danger" data-mp-del="${idx}">×</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      subContentHtml += `
        <div class="etp-code-box">
          <div class="etp-code-toolbar">
            <div style="display:flex;gap:6px;">
              <button type="button" class="etp-btn-xs" id="btn-prettify-json">${escapeHtml(translate(state.lang, 'request.btnPrettify'))}</button>
              <button type="button" class="etp-btn-xs" id="btn-minify-json">${escapeHtml(translate(state.lang, 'request.btnMinify'))}</button>
            </div>
            <span style="font-size:11px;color:var(--text-muted);">${escapeHtml(translate(state.lang, 'request.editorHint'))}</span>
          </div>
          <div class="etp-code-body">
            <div class="etp-code-gutter" id="body-code-gutter">${Array.from({ length: linesCount }, (_, i) => i + 1).join('<br/>')}</div>
            <textarea id="body-raw-textarea" class="etp-code-textarea" spellcheck="false" placeholder="${escapeAttr(translate(state.lang, 'request.bodyPlaceholder'))}">${escapeHtml(rawText)}</textarea>
          </div>
        </div>
      `;
    }
  } else if (state.reqSubTab === 'assertions') {
    req.assertions = Array.isArray(req.assertions) ? req.assertions : [];
    req.extractions = Array.isArray(req.extractions) ? req.extractions : [];
    subContentHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${escapeHtml(translate(state.lang, 'request.assertionsTitle'))} (${req.assertions.length})</strong>
        <button type="button" class="etp-btn-xs" id="btn-add-assertion">${escapeHtml(translate(state.lang, 'request.btnAddAssertion'))}</button>
      </div>
      <table class="etp-kv-table">
        <thead><tr><th style="width:30px;">On</th><th>${escapeHtml(translate(state.lang, 'request.colTarget'))}</th><th>${escapeHtml(translate(state.lang, 'request.colProperty'))}</th><th>${escapeHtml(translate(state.lang, 'request.colOperator'))}</th><th>${escapeHtml(translate(state.lang, 'request.colExpected'))}</th><th style="width:28px;"></th></tr></thead>
        <tbody>
          ${req.assertions.map((a, idx) => `
            <tr>
              <td><input type="checkbox" data-ast-toggle="${idx}" ${a.enabled ? 'checked' : ''} /></td>
              <td>
                <select class="etp-select" data-ast-target="${idx}" style="height:26px;font-size:11.5px;width:100%;">
                  <option value="status" ${a.target === 'status' ? 'selected' : ''}>status</option>
                  <option value="json_path" ${a.target === 'json_path' ? 'selected' : ''}>json_path</option>
                  <option value="header" ${a.target === 'header' ? 'selected' : ''}>header</option>
                  <option value="body_text" ${a.target === 'body_text' ? 'selected' : ''}>body_text</option>
                  <option value="duration_ms" ${a.target === 'duration_ms' ? 'selected' : ''}>duration_ms</option>
                </select>
              </td>
              <td><input class="etp-kv-input" data-ast-prop="${idx}" value="${escapeAttr(a.property || '')}" placeholder="data.id" /></td>
              <td>
                <select class="etp-select" data-ast-op="${idx}" style="height:26px;font-size:11.5px;width:100%;">
                  <option value="equals" ${a.operator === 'equals' ? 'selected' : ''}>equals</option>
                  <option value="not_equals" ${a.operator === 'not_equals' ? 'selected' : ''}>not_equals</option>
                  <option value="contains" ${a.operator === 'contains' ? 'selected' : ''}>contains</option>
                  <option value="exists" ${a.operator === 'exists' ? 'selected' : ''}>exists</option>
                  <option value="less_than" ${a.operator === 'less_than' ? 'selected' : ''}>less_than</option>
                  <option value="greater_than" ${a.operator === 'greater_than' ? 'selected' : ''}>greater_than</option>
                </select>
              </td>
              <td><input class="etp-kv-input" data-ast-exp="${idx}" value="${escapeAttr(a.expected || '')}" /></td>
              <td><button type="button" class="etp-icon-btn danger" data-ast-del="${idx}">×</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong>${escapeHtml(translate(state.lang, 'request.extractionsTitle'))} (${req.extractions.length})</strong>
          <button type="button" class="etp-btn-xs" id="btn-add-extraction">${escapeHtml(translate(state.lang, 'request.btnAddExtraction'))}</button>
        </div>
        <table class="etp-kv-table">
          <thead><tr><th style="width:30px;">On</th><th>${escapeHtml(translate(state.lang, 'request.colDestVar'))}</th><th>${escapeHtml(translate(state.lang, 'request.colJsonPath'))}</th><th>${escapeHtml(translate(state.lang, 'request.colCurrentVal'))}</th><th style="width:28px;"></th></tr></thead>
          <tbody>
            ${req.extractions.map((ex, idx) => `
              <tr>
                <td><input type="checkbox" data-ext-toggle="${idx}" ${ex.enabled ? 'checked' : ''} /></td>
                <td><input class="etp-kv-input" data-ext-var="${idx}" value="${escapeAttr(ex.variableName || '')}" /></td>
                <td><input class="etp-kv-input" data-ext-path="${idx}" value="${escapeAttr(ex.path || '')}" /></td>
                <td style="font-family:var(--font-mono);color:var(--accent-secondary);">${escapeHtml(state.runtimeVars[ex.variableName] || translate(state.lang, 'request.pendingVal'))}</td>
                <td><button type="button" class="etp-icon-btn danger" data-ext-del="${idx}">×</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.reqSubTab === 'settings') {
    req.settings = req.settings || { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, verifyTls: true };
    const s = req.settings;
    subContentHtml = `
      <div class="etp-auth-card">
        <div class="etp-auth-grid">
          <label class="etp-auth-label" for="set-timeout-input">${escapeHtml(translate(state.lang, 'request.timeoutLabel'))}</label>
          <div class="etp-auth-field-wrap">
            <input type="number" id="set-timeout-input" class="etp-input" value="${Number(s.timeoutMs) || 10000}" style="max-width:160px;" />
          </div>
          <label class="etp-auth-label">${escapeHtml(translate(state.lang, 'request.redirectsLabel'))}</label>
          <div class="etp-auth-field-wrap">
            <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="set-follow-redir" ${s.followRedirects ? 'checked' : ''} /> ${escapeHtml(translate(state.lang, 'request.followRedirects'))}</label>
            <input type="number" id="set-max-redir" class="etp-input" value="${Number(s.maxRedirects ?? 5)}" style="width:70px;height:28px;" />
            <span>)</span>
          </div>
          <label class="etp-auth-label">${escapeHtml(translate(state.lang, 'request.tlsLabel'))}</label>
          <div class="etp-auth-field-wrap" style="flex-direction:column;align-items:flex-start;gap:6px;">
            <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="set-verify-tls" ${s.verifyTls ? 'checked' : ''} /> ${escapeHtml(translate(state.lang, 'request.verifyTls'))}</label>
            ${!s.verifyTls ? `<span id="tls-insecure-badge" class="etp-status-badge status-4xx">⚠ Conexión Insegura: la validación de certificados SSL/TLS está desactivada para esta petición</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  subContentHtml += `
    <div class="etp-live-request-inspector">
      <div class="etp-inspector-header">
        <span>${escapeHtml(translate(state.lang, 'request.wirePreviewTitle'))}</span>
        <span>${escapeHtml(translate(state.lang, 'request.wireStatsPrefix'))} ${(req.params || []).filter((p) => p.enabled && p.key).length} • Headers: ${(req.headers || []).filter((h) => h.enabled && h.key).length} • Auth: ${escapeHtml(req.auth?.type || 'none')}</span>
      </div>
      <pre class="etp-inspector-pre" id="live-wire-preview-pre">${escapeHtml(buildLiveHttpWirePreview(req, state))}</pre>
    </div>
  `;

  pane.innerHTML = subContentHtml;

  if (state.reqSubTab === 'params') {
    document.getElementById('btn-add-param').addEventListener('click', () => {
      req.params.push({ id: 'p_' + Date.now(), key: '', value: '', description: '', enabled: true });
      syncActiveRequestToCollection(state);
      renderCenterEditor(state, renderAll);
    });
    pane.querySelectorAll('[data-param-toggle]').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        req.params[Number(chk.getAttribute('data-param-toggle'))].enabled = e.target.checked;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-param-key]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        req.params[Number(inp.getAttribute('data-param-key'))].key = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-param-val]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        req.params[Number(inp.getAttribute('data-param-val'))].value = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-param-desc]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        req.params[Number(inp.getAttribute('data-param-desc'))].description = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-param-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        req.params.splice(Number(btn.getAttribute('data-param-del')), 1);
        syncActiveRequestToCollection(state);
        renderCenterEditor(state, renderAll);
      });
    });
  }

  if (state.reqSubTab === 'headers') {
    document.getElementById('btn-add-header').addEventListener('click', () => {
      req.headers.push({ id: 'h_' + Date.now(), key: '', value: '', enabled: true, isSecret: false });
      syncActiveRequestToCollection(state);
      renderCenterEditor(state, renderAll);
    });
    pane.querySelectorAll('[data-hdr-toggle]').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        req.headers[Number(chk.getAttribute('data-hdr-toggle'))].enabled = e.target.checked;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-hdr-key]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        req.headers[Number(inp.getAttribute('data-hdr-key'))].key = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-hdr-val]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        req.headers[Number(inp.getAttribute('data-hdr-val'))].value = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-hdr-sec]').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        req.headers[Number(chk.getAttribute('data-hdr-sec'))].isSecret = e.target.checked;
        syncActiveRequestToCollection(state);
        renderCenterEditor(state, renderAll);
      });
    });
    pane.querySelectorAll('[data-hdr-reveal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-hdr-reveal'));
        const rKey = `${req.id}_${idx}`;
        state.revealedHeaders = state.revealedHeaders || {};
        state.revealedHeaders[rKey] = !state.revealedHeaders[rKey];
        renderCenterEditor(state, renderAll);
      });
    });
    pane.querySelectorAll('[data-hdr-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        req.headers.splice(Number(btn.getAttribute('data-hdr-del')), 1);
        syncActiveRequestToCollection(state);
        renderCenterEditor(state, renderAll);
      });
    });
  }

  if (state.reqSubTab === 'auth') {
    document.getElementById('auth-type-select').addEventListener('change', (e) => {
      req.auth = { ...req.auth, type: e.target.value };
      syncActiveRequestToCollection(state);
      renderCenterEditor(state, renderAll);
    });
    const bearerInp = document.getElementById('auth-bearer-input');
    if (bearerInp) {
      bearerInp.addEventListener('input', (e) => {
        req.auth.bearerToken = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
    const btnToggleBearer = document.getElementById('btn-toggle-bearer-vis');
    if (btnToggleBearer) {
      btnToggleBearer.addEventListener('click', () => {
        state.showBearerToken = !state.showBearerToken;
        renderCenterEditor(state, renderAll);
      });
    }
    const bUser = document.getElementById('auth-basic-user');
    if (bUser) {
      bUser.addEventListener('input', (e) => {
        req.auth.basicUsername = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
    const bPass = document.getElementById('auth-basic-pass');
    if (bPass) {
      bPass.addEventListener('input', (e) => {
        req.auth.basicPassword = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
    const btnTogglePass = document.getElementById('btn-toggle-basic-pass');
    if (btnTogglePass) {
      btnTogglePass.addEventListener('click', () => {
        state.showBasicPassword = !state.showBasicPassword;
        renderCenterEditor(state, renderAll);
      });
    }
    const akName = document.getElementById('auth-apikey-name');
    if (akName) {
      akName.addEventListener('input', (e) => {
        req.auth.apiKeyName = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
    const akVal = document.getElementById('auth-apikey-val');
    if (akVal) {
      akVal.addEventListener('input', (e) => {
        req.auth.apiKeyValue = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
    const btnToggleApiKey = document.getElementById('btn-toggle-apikey-vis');
    if (btnToggleApiKey) {
      btnToggleApiKey.addEventListener('click', () => {
        state.showApiKeyValue = !state.showApiKeyValue;
        renderCenterEditor(state, renderAll);
      });
    }
    const akIn = document.getElementById('auth-apikey-in');
    if (akIn) {
      akIn.addEventListener('change', (e) => {
        req.auth.apiKeyIn = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
  }

  if (state.reqSubTab === 'body') {
    document.getElementById('body-mode-select').addEventListener('change', (e) => {
      req.body = { ...req.body, mode: e.target.value };
      syncActiveRequestToCollection(state);
      renderCenterEditor(state, renderAll);
    });
    const ta = document.getElementById('body-raw-textarea');
    if (ta) {
      ta.addEventListener('input', (e) => {
        req.body.raw = e.target.value;
        const lines = Math.max(1, req.body.raw.split('\n').length);
        const gutter = document.getElementById('body-code-gutter');
        if (gutter) gutter.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('<br/>');
        const ind = document.getElementById('json-valid-indicator');
        if (ind && req.body.mode === 'json') {
          try {
            JSON.parse(req.body.raw);
            ind.style.color = 'var(--status-success)';
            ind.textContent = translate(state.lang, 'request.jsonValid');
          } catch (err) {
            ind.style.color = 'var(--status-danger)';
            ind.textContent = `${translate(state.lang, 'request.jsonErrorPrefix')} ${err.message}`;
          }
        }
        syncActiveRequestToCollection(state);
      });
      document.getElementById('btn-prettify-json').addEventListener('click', () => {
        try {
          req.body.raw = JSON.stringify(JSON.parse(req.body.raw || '{}'), null, 2);
          syncActiveRequestToCollection(state);
          renderCenterEditor(state, renderAll);
        } catch {}
      });
      document.getElementById('btn-minify-json').addEventListener('click', () => {
        try {
          req.body.raw = JSON.stringify(JSON.parse(req.body.raw || '{}'));
          syncActiveRequestToCollection(state);
          renderCenterEditor(state, renderAll);
        } catch {}
      });
    }
    const btnAddUrlenc = document.getElementById('btn-add-urlenc');
    if (btnAddUrlenc) {
      btnAddUrlenc.addEventListener('click', () => {
        req.body.urlencoded.push({ id: 'u_' + Date.now(), key: '', value: '', enabled: true });
        syncActiveRequestToCollection(state);
        renderCenterEditor(state, renderAll);
      });
      pane.querySelectorAll('[data-urlenc-toggle]').forEach((chk) => {
        chk.addEventListener('change', (e) => {
          req.body.urlencoded[Number(chk.getAttribute('data-urlenc-toggle'))].enabled = e.target.checked;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll('[data-urlenc-key]').forEach((inp) => {
        inp.addEventListener('input', (e) => {
          req.body.urlencoded[Number(inp.getAttribute('data-urlenc-key'))].key = e.target.value;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll('[data-urlenc-val]').forEach((inp) => {
        inp.addEventListener('input', (e) => {
          req.body.urlencoded[Number(inp.getAttribute('data-urlenc-val'))].value = e.target.value;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll('[data-urlenc-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          req.body.urlencoded.splice(Number(btn.getAttribute('data-urlenc-del')), 1);
          syncActiveRequestToCollection(state);
          renderCenterEditor(state, renderAll);
        });
      });
    }
    const btnAddMp = document.getElementById('btn-add-multipart');
    if (btnAddMp) {
      btnAddMp.addEventListener('click', () => {
        req.body.multipart.push({ id: 'm_' + Date.now(), key: '', value: '', enabled: true });
        syncActiveRequestToCollection(state);
        renderCenterEditor(state, renderAll);
      });
      pane.querySelectorAll('[data-mp-toggle]').forEach((chk) => {
        chk.addEventListener('change', (e) => {
          req.body.multipart[Number(chk.getAttribute('data-mp-toggle'))].enabled = e.target.checked;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll('[data-mp-key]').forEach((inp) => {
        inp.addEventListener('input', (e) => {
          req.body.multipart[Number(inp.getAttribute('data-mp-key'))].key = e.target.value;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll('[data-mp-val]').forEach((inp) => {
        inp.addEventListener('input', (e) => {
          req.body.multipart[Number(inp.getAttribute('data-mp-val'))].value = e.target.value;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll('[data-mp-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          req.body.multipart.splice(Number(btn.getAttribute('data-mp-del')), 1);
          syncActiveRequestToCollection(state);
          renderCenterEditor(state, renderAll);
        });
      });
    }
  }

  if (state.reqSubTab === 'assertions') {
    document.getElementById('btn-add-assertion').addEventListener('click', () => {
      req.assertions.push({
        id: 'ast_' + Date.now(),
        enabled: true,
        target: 'status',
        property: '',
        operator: 'equals',
        expected: '200'
      });
      syncActiveRequestToCollection(state);
      renderCenterEditor(state, renderAll);
    });
    pane.querySelectorAll('[data-ast-toggle]').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        req.assertions[Number(chk.getAttribute('data-ast-toggle'))].enabled = e.target.checked;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-ast-target]').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        req.assertions[Number(sel.getAttribute('data-ast-target'))].target = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-ast-prop]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        req.assertions[Number(inp.getAttribute('data-ast-prop'))].property = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-ast-op]').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        req.assertions[Number(sel.getAttribute('data-ast-op'))].operator = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-ast-exp]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        req.assertions[Number(inp.getAttribute('data-ast-exp'))].expected = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-ast-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        req.assertions.splice(Number(btn.getAttribute('data-ast-del')), 1);
        syncActiveRequestToCollection(state);
        renderCenterEditor(state, renderAll);
      });
    });

    document.getElementById('btn-add-extraction').addEventListener('click', () => {
      req.extractions.push({
        id: 'ext_' + Date.now(),
        enabled: true,
        variableName: 'nueva_var',
        source: 'json_path',
        path: 'id'
      });
      syncActiveRequestToCollection(state);
      renderCenterEditor(state, renderAll);
    });
    pane.querySelectorAll('[data-ext-toggle]').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        req.extractions[Number(chk.getAttribute('data-ext-toggle'))].enabled = e.target.checked;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-ext-var]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        req.extractions[Number(inp.getAttribute('data-ext-var'))].variableName = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-ext-path]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        req.extractions[Number(inp.getAttribute('data-ext-path'))].path = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll('[data-ext-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        req.extractions.splice(Number(btn.getAttribute('data-ext-del')), 1);
        syncActiveRequestToCollection(state);
        renderCenterEditor(state, renderAll);
      });
    });
  }

  if (state.reqSubTab === 'settings') {
    document.getElementById('set-timeout-input').addEventListener('input', (e) => {
      req.settings.timeoutMs = Number(e.target.value) || 10000;
      syncActiveRequestToCollection(state);
    });
    document.getElementById('set-follow-redir').addEventListener('change', (e) => {
      req.settings.followRedirects = e.target.checked;
      syncActiveRequestToCollection(state);
    });
    document.getElementById('set-max-redir').addEventListener('input', (e) => {
      req.settings.maxRedirects = Number(e.target.value) || 5;
      syncActiveRequestToCollection(state);
    });
    document.getElementById('set-verify-tls').addEventListener('change', (e) => {
      req.settings.verifyTls = e.target.checked;
      syncActiveRequestToCollection(state);
      renderCenterEditor(state, renderAll);
    });
  }
}

export function renderResponsePanel(state) {
  const req = getActiveRequest(state);
  const resp = req ? state.responsesByReqId[req.id] : null;
  const statusBadge = document.getElementById('resp-status-badge');
  const timeChip = document.getElementById('resp-time-chip');
  const sizeChip = document.getElementById('resp-size-chip');
  const testsChip = document.getElementById('resp-tests-chip');
  const linesInd = document.getElementById('resp-lines-indicator');
  const matchCountBadge = document.getElementById('resp-match-count');
  const clearRespBtn = document.getElementById('btn-clear-resp-search');
  const filterModeLbl = document.getElementById('lbl-resp-filter-mode');
  const container = document.getElementById('resp-body-container');

  const filterQ = (state.respFilterQuery || '').trim().toLowerCase();
  if (clearRespBtn) clearRespBtn.classList.toggle('visible', filterQ.length > 0);
  if (filterModeLbl) {
    filterModeLbl.textContent =
      state.respFilterMode === 'all'
        ? translate(state.lang, 'response.filterModeAll')
        : translate(state.lang, 'response.filterModeLines');
  }

  if (!resp) {
    statusBadge.textContent = translate(state.lang, 'response.statusReady');
    statusBadge.className = 'etp-status-badge status-3xx';
    timeChip.textContent = '0 ms';
    sizeChip.textContent = '0 B';
    testsChip.textContent = translate(state.lang, 'response.assertionsDash');
    linesInd.textContent = `0 ${translate(state.lang, 'response.linesSuffix')}`;
    if (matchCountBadge) matchCountBadge.textContent = `0 ${translate(state.lang, 'response.matchesSuffix')}`;
    container.innerHTML = `<div style="padding:36px;color:var(--text-muted);text-align:center;">${escapeHtml(translate(state.lang, 'response.emptyState'))}</div>`;
    return;
  }

  const codeGroup = Math.floor((resp.status || 0) / 100);
  statusBadge.textContent = resp.status > 0 ? `${resp.status} ${resp.statusText}` : `${resp.statusText || 'ERROR DE RED'}`;
  statusBadge.className = `etp-status-badge status-${codeGroup}xx`;
  timeChip.textContent = `${resp.durationMs} ms`;
  sizeChip.textContent = `${resp.sizeBytes} B`;

  const passedCount = (resp.assertionResults || []).filter((a) => a.passed).length;
  const totalCount = (resp.assertionResults || []).length;
  testsChip.textContent = `${translate(state.lang, 'response.assertionsPrefix')} ${passedCount}/${totalCount} OK`;

  const rawBodyStr = resp.body || '';
  const allLines = rawBodyStr.split('\n');
  const matchingLines = filterQ ? allLines.filter((line) => line.toLowerCase().includes(filterQ)) : allLines;
  const displayLines = filterQ && state.respFilterMode !== 'all' ? matchingLines : allLines;

  if (matchCountBadge) {
    matchCountBadge.textContent = `${filterQ ? matchingLines.length : 0} ${translate(state.lang, 'response.matchesSuffix')}`;
  }
  linesInd.textContent = `${displayLines.length} ${translate(state.lang, 'response.linesSuffix')}`;

  if (state.respSubTab === 'pretty' || state.respSubTab === 'raw') {
    const textToShow = displayLines.join('\n');
    const lineNums = Array.from({ length: Math.max(1, displayLines.length) }, (_, i) => i + 1).join('<br/>');
    container.innerHTML = `
      <div class="etp-pre-wrapper">
        <div class="etp-pre-gutter">${lineNums}</div>
        <pre class="etp-pre" id="resp-pre-content">${escapeHtml(textToShow)}</pre>
      </div>
    `;
    return;
  }

  if (state.respSubTab === 'headers') {
    const entries = Object.entries(resp.headers || {});
    container.innerHTML = `
      <div style="overflow:auto;flex:1;">
        <table class="etp-kv-table">
          <thead><tr><th>${escapeHtml(translate(state.lang, 'response.colRespHeader'))}</th><th>${escapeHtml(translate(state.lang, 'environments.colValue'))}</th></tr></thead>
          <tbody>
            ${entries.length ? entries.map(([k, v]) => `<tr><td style="font-family:var(--font-mono);font-weight:600;">${escapeHtml(k)}</td><td style="font-family:var(--font-mono);">${escapeHtml(v)}</td></tr>`).join('') : `<tr><td colspan="2" style="color:var(--text-muted);text-align:center;">${escapeHtml(translate(state.lang, 'response.emptyHeaders'))}</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (state.respSubTab === 'preview') {
    const safeSrcDoc = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"></head><body style="font-family:sans-serif;padding:12px;"><pre>${escapeHtml(rawBodyStr)}</pre></body></html>`;
    container.innerHTML = `
      <div style="margin-bottom:6px;font-size:11.5px;color:var(--status-success);">
        ${escapeHtml(translate(state.lang, 'response.sandboxNotice'))}
      </div>
      <iframe class="etp-sandbox-preview" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeAttr(safeSrcDoc)}"></iframe>
    `;
    return;
  }

  if (state.respSubTab === 'cookies') {
    const cookies = resp.cookies || [];
    container.innerHTML = `
      <div style="overflow:auto;flex:1;">
        <table class="etp-kv-table">
          <thead><tr><th>Name</th><th>Value</th><th>HttpOnly</th><th>Secure</th><th>SameSite</th></tr></thead>
          <tbody>
            ${cookies.length ? cookies.map((c) => `
              <tr>
                <td>${escapeHtml(c.name)}</td>
                <td>${escapeHtml(c.value)}</td>
                <td>${c.httpOnly ? '✓' : '—'}</td>
                <td>${c.secure ? '✓' : '—'}</td>
                <td>${escapeHtml(c.sameSite || '—')}</td>
              </tr>
            `).join('') : `<tr><td colspan="5" style="color:var(--text-muted);text-align:center;">${escapeHtml(translate(state.lang, 'response.emptyCookies'))}</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (state.respSubTab === 'assertions') {
    const results = resp.assertionResults || [];
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;overflow:auto;flex:1;">
        ${results.length ? results.map((r) => `
          <div style="padding:8px 10px;border-radius:5px;border:1px solid var(--border-strong);background:var(--bg-input);display:flex;justify-content:space-between;">
            <span>${escapeHtml(r.message)}</span>
            <span class="${r.passed ? 'etp-pass' : 'etp-fail'}">${r.passed ? 'PASS' : 'FAIL'}</span>
          </div>
        `).join('') : `<div style="color:var(--text-muted);padding:12px;">${escapeHtml(translate(state.lang, 'response.emptyAssertions'))}</div>`}
      </div>
    `;
  }
}

export function renderFlowsStudioView(state, renderAll) {
  const sidebarListEl = document.getElementById('flows-sidebar-list');
  const sidebarTitleEl = document.getElementById('lbl-flows-sidebar-title');
  const mainContentEl = document.getElementById('flows-studio-main-content');
  if (!sidebarListEl || !mainContentEl) return;

  if (sidebarTitleEl) {
    sidebarTitleEl.textContent = `${translate(state.lang, 'flows.myFlows')} (${state.customFlows.length})`;
  }

  const flowQuery = (state.flowsSearchQuery || '').trim().toLowerCase();
  const visibleFlows = state.customFlows.filter(
    (f) => !flowQuery || (f.name || '').toLowerCase().includes(flowQuery)
  );

  if (visibleFlows.length === 0) {
    sidebarListEl.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px;border:1px dashed var(--border-strong);border-radius:7px;">${escapeHtml(translate(state.lang, 'flows.emptyFlowsList'))}</div>`;
  } else {
    sidebarListEl.innerHTML = visibleFlows.map((flw) => {
      const isAct = flw.id === state.activeFlowId;
      const safeFlwId = escapeAttr(flw.id);
      return `
        <div class="etp-env-item-card ${isAct ? 'active' : ''}" data-select-flow="${safeFlwId}">
          <div style="min-width:0;flex:1;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">⚡ ${escapeHtml(flw.name)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
              <span style="font-size:11px;color:var(--text-muted);">${(flw.selectedRequestIds || []).length} ${escapeHtml(translate(state.lang, 'flows.endpointsSelectedSuffix'))}</span>
            </div>
          </div>
          <div class="etp-tree-actions">
            <button type="button" class="etp-icon-btn" data-rename-flow="${safeFlwId}">✎</button>
            <button type="button" class="etp-icon-btn danger" data-delete-flow="${safeFlwId}">🗑</button>
          </div>
        </div>
      `;
    }).join('');
  }

  sidebarListEl.querySelectorAll('[data-select-flow]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      state.activeFlowId = el.getAttribute('data-select-flow');
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  sidebarListEl.querySelectorAll('[data-rename-flow]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fId = btn.getAttribute('data-rename-flow');
      const flw = state.customFlows.find((f) => f.id === fId);
      if (!flw) return;
      openInputDialog({
        title: translate(state.lang, 'flows.myFlows'),
        label: translate(state.lang, 'request.nameLabel'),
        initialValue: flw.name,
        onConfirm: (nextName) => {
          flw.name = nextName;
          persistWorkspaceToLocalStorage(state);
          renderFlowsStudioView(state, renderAll);
        }
      });
    });
  });

  sidebarListEl.querySelectorAll('[data-delete-flow]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fId = btn.getAttribute('data-delete-flow');
      state.customFlows = state.customFlows.filter((f) => f.id !== fId);
      state.activeFlowId = state.customFlows[0]?.id || null;
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  const activeFlow = state.customFlows.find((f) => f.id === state.activeFlowId) || state.customFlows[0] || null;
  if (activeFlow && state.activeFlowId !== activeFlow.id) {
    state.activeFlowId = activeFlow.id;
  }

  if (!activeFlow) {
    mainContentEl.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;text-align:center;gap:12px;">
        <div style="font-size:32px;">⚡</div>
        <h3 style="font-size:16px;">${escapeHtml(translate(state.lang, 'flows.noActiveFlowTitle'))}</h3>
        <p style="font-size:13px;color:var(--text-secondary);max-width:460px;">${escapeHtml(translate(state.lang, 'flows.noActiveFlowDesc'))}</p>
        <button type="button" class="etp-btn etp-btn-primary" id="btn-create-flow-empty-cta">${escapeHtml(translate(state.lang, 'flows.btnNewFlow'))}</button>
      </div>
    `;
    document.getElementById('btn-create-flow-empty-cta')?.addEventListener('click', () => {
      document.getElementById('btn-create-custom-flow').click();
    });
    return;
  }

  const allRequests = [];
  for (const col of state.collections) {
    for (const r of (col.requests || [])) {
      allRequests.push({ ...r, collectionName: col.metadata.name });
    }
  }

  const catQ = (state.flowCatalogSearchQuery || '').trim().toLowerCase();
  const filteredCatalog = allRequests.filter(
    (r) => !catQ || r.name.toLowerCase().includes(catQ) || r.url.toLowerCase().includes(catQ) || r.method.toLowerCase().includes(catQ)
  );

  const orderedStepReqs = (activeFlow.selectedRequestIds || [])
    .map((id) => allRequests.find((r) => r.id === id))
    .filter(Boolean);

  mainContentEl.innerHTML = `
    <header class="etp-flows-header">
      <div>
        <div style="display:flex;align-items:center;gap:8px;">
          <h2 style="font-size:15px;font-weight:700;">⚡ ${escapeHtml(activeFlow.name)}</h2>
        </div>
        <p style="font-size:12px;color:var(--text-secondary);">${escapeHtml(translate(state.lang, 'flows.studioSubtitle'))}</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button type="button" class="etp-btn" id="btn-back-to-editor-inline">${escapeHtml(translate(state.lang, 'topbar.btnFlowsBack'))}</button>
        <button type="button" class="etp-btn etp-btn-success" id="btn-execute-selected-flow">
          ${escapeHtml(translate(state.lang, 'flows.btnExecuteFlow'))} (${orderedStepReqs.length})
        </button>
      </div>
    </header>

    <div class="etp-flows-grid">
      <div class="etp-flows-column">
        <div class="etp-flows-col-header">
          <span>${escapeHtml(translate(state.lang, 'flows.availableEndpointsTitle'))}</span>
          <span class="etp-search-badge">${filteredCatalog.length}</span>
        </div>
        <div style="padding:8px 10px;border-bottom:1px solid var(--border-subtle);">
          <div class="etp-response-search-shell">
            <span class="etp-search-icon">🔍</span>
            <input type="search" id="flow-catalog-search" class="etp-response-search-input" value="${escapeAttr(state.flowCatalogSearchQuery || '')}" placeholder="${escapeAttr(translate(state.lang, 'flows.searchEndpointsPlaceholder'))}" />
          </div>
        </div>
        <div class="etp-flows-col-body">
          ${filteredCatalog.map((req) => {
            const checked = activeFlow.selectedRequestIds.includes(req.id);
            const safeReqId = escapeAttr(req.id);
            const safeMethod = escapeHtml((req.method || 'GET').toUpperCase());
            return `
              <label class="etp-flow-step-card" style="cursor:pointer;">
                <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                  <input type="checkbox" data-flow-req-check="${safeReqId}" ${checked ? 'checked' : ''} />
                  <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
                  <div style="min-width:0;flex:1;">
                    <div style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(req.name)}</div>
                    <div style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📦 ${escapeHtml(req.collectionName)} • ${escapeHtml(req.url || '(sin URL)')}</div>
                  </div>
                </div>
              </label>
            `;
          }).join('')}
        </div>
      </div>

      <div class="etp-flows-column">
        <div class="etp-flows-col-header">
          <span>${escapeHtml(translate(state.lang, 'flows.selectedStepsTitle'))}</span>
          <span class="etp-search-badge">${orderedStepReqs.length}</span>
        </div>
        <div class="etp-flows-col-body">
          ${orderedStepReqs.length === 0 ? `
            <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px;border:1px dashed var(--border-strong);border-radius:7px;">
              ${escapeHtml(translate(state.lang, 'flows.emptyStepsHint'))}
            </div>
          ` : orderedStepReqs.map((req, idx) => {
            const safeMethod = escapeHtml((req.method || 'GET').toUpperCase());
            return `
              <div class="etp-flow-step-card">
                <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1;">
                  <span class="etp-search-badge">#${idx + 1}</span>
                  <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
                  <div style="min-width:0;flex:1;">
                    <div style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(req.name)}</div>
                    <div style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(req.url || '(sin URL)')}</div>
                  </div>
                </div>
                <div class="etp-tree-actions">
                  <button type="button" class="etp-icon-btn" data-step-up="${idx}" title="${escapeAttr(translate(state.lang, 'flows.moveUp'))}">↑</button>
                  <button type="button" class="etp-icon-btn" data-step-down="${idx}" title="${escapeAttr(translate(state.lang, 'flows.moveDown'))}">↓</button>
                  <button type="button" class="etp-icon-btn danger" data-step-remove="${escapeAttr(req.id)}" title="${escapeAttr(translate(state.lang, 'flows.removeStep'))}">✕</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="etp-flows-column">
        <div class="etp-flows-col-header">
          <span>${escapeHtml(translate(state.lang, 'flows.resultsTitle'))}</span>
          ${activeFlow.lastReport ? `
            <span class="etp-status-badge ${activeFlow.lastReport.allPassed ? 'status-2xx' : 'status-4xx'}" id="flow-summary-badge">
              ${escapeHtml(activeFlow.lastReport.allPassed ? translate(state.lang, 'flows.flowSuccess') : translate(state.lang, 'flows.flowFailed'))}
            </span>
          ` : ''}
        </div>
        <div class="etp-flows-col-body" id="flow-execution-results-area">
          ${activeFlow.lastReport ? `
            <div class="etp-flow-kpi-grid">
              <div class="etp-flow-kpi-card">
                <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(translate(state.lang, 'flows.summaryExecuted'))}</div>
                <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);">${Number(activeFlow.lastReport.totalRequests) || 0}</div>
              </div>
              <div class="etp-flow-kpi-card">
                <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(translate(state.lang, 'flows.summaryAssertions'))}</div>
                <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);">${Number(activeFlow.lastReport.passedAssertions) || 0}/${Number(activeFlow.lastReport.totalAssertions) || 0}</div>
              </div>
              <div class="etp-flow-kpi-card">
                <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(translate(state.lang, 'flows.summaryDuration'))}</div>
                <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);">${Number(activeFlow.lastReport.totalDurationMs) || 0} ms</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${activeFlow.lastReport.steps.map((s, idx) => {
                const safeMethod = escapeHtml((s.method || 'GET').toUpperCase());
                return `
                  <div style="border:1px solid var(--border-strong);border-radius:7px;padding:9px 11px;background:var(--bg-input);">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                      <div style="min-width:0;flex:1;">
                        <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
                        <strong style="margin-left:6px;font-size:12px;">${escapeHtml(translate(state.lang, 'flows.stepPrefix'))} ${idx + 1}: ${escapeHtml(s.requestName)}</strong>
                      </div>
                      <span class="${s.passed ? 'etp-pass' : 'etp-fail'}" style="font-family:var(--font-mono);font-size:11.5px;">HTTP ${Number(s.status) || 0} (${Number(s.durationMs) || 0} ms)</span>
                    </div>
                    <div style="font-size:11.5px;font-family:var(--font-mono);margin-top:5px;">
                      ${(s.assertionResults || []).map((a) => `<div class="${a.passed ? 'etp-pass' : 'etp-fail'}">${a.passed ? '✓' : '✗'} ${escapeHtml(a.message)}</div>`).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div style="padding:28px;text-align:center;color:var(--text-muted);font-size:12.5px;border:1px dashed var(--border-strong);border-radius:7px;">
              ${escapeHtml(translate(state.lang, 'flows.noRunYet'))}
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-back-to-editor-inline')?.addEventListener('click', () => {
    state.activeMainView = 'workspace';
    persistWorkspaceToLocalStorage(state);
    renderAll();
  });

  document.getElementById('flow-catalog-search')?.addEventListener('input', (e) => {
    state.flowCatalogSearchQuery = e.target.value;
    renderFlowsStudioView(state, renderAll);
  });

  mainContentEl.querySelectorAll('[data-flow-req-check]').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const rId = chk.getAttribute('data-flow-req-check');
      if (e.target.checked) {
        if (!activeFlow.selectedRequestIds.includes(rId)) {
          activeFlow.selectedRequestIds.push(rId);
        }
      } else {
        activeFlow.selectedRequestIds = activeFlow.selectedRequestIds.filter((id) => id !== rId);
      }
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  mainContentEl.querySelectorAll('[data-step-up]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-step-up'));
      if (idx <= 0) return;
      const arr = activeFlow.selectedRequestIds;
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  mainContentEl.querySelectorAll('[data-step-down]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-step-down'));
      const arr = activeFlow.selectedRequestIds;
      if (idx >= arr.length - 1) return;
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  mainContentEl.querySelectorAll('[data-step-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rId = btn.getAttribute('data-step-remove');
      activeFlow.selectedRequestIds = activeFlow.selectedRequestIds.filter((id) => id !== rId);
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  document.getElementById('btn-execute-selected-flow')?.addEventListener('click', async () => {
    if (orderedStepReqs.length === 0) {
      showToast(translate(state.lang, 'toasts.selectAtLeastOneStep'), 'warning');
      return;
    }
    const steps = [];
    let passedAssertions = 0;
    let totalAssertions = 0;
    let totalDurationMs = 0;
    for (const req of orderedStepReqs) {
      const r = await executeSingleRequestObject(req, state);
      state.responsesByReqId[req.id] = r;
      totalDurationMs += r.durationMs || 0;
      const reqPassed = r.status > 0 && r.status < 400 && (r.assertionResults || []).every((a) => a.passed);
      for (const a of (r.assertionResults || [])) {
        totalAssertions++;
        if (a.passed) passedAssertions++;
      }
      steps.push({
        requestId: req.id,
        requestName: req.name,
        method: req.method,
        status: r.status,
        durationMs: r.durationMs,
        passed: reqPassed,
        assertionResults: r.assertionResults || []
      });
    }
    activeFlow.lastReport = {
      totalRequests: steps.length,
      totalAssertions,
      passedAssertions,
      totalDurationMs,
      allPassed: steps.every((s) => s.passed),
      steps
    };
    persistWorkspaceToLocalStorage(state);
    renderFlowsStudioView(state, renderAll);
    renderResponsePanel(state);
  });
}

export function renderEnvironmentSelector(state) {
  const sel = document.getElementById('env-select');
  const options = [`<option value="none" ${state.activeEnvId === 'none' ? 'selected' : ''}>${escapeHtml(translate(state.lang, 'topbar.noEnv'))}</option>`];
  for (const env of state.environments) {
    options.push(`<option value="${escapeAttr(env.id)}" ${state.activeEnvId === env.id ? 'selected' : ''}>${escapeHtml(env.name)}</option>`);
  }
  sel.innerHTML = options.join('');
}

export function renderAllViews(state) {
  const renderAll = () => renderAllViews(state);
  applyDomTranslations(state.lang, document);
  document.getElementById('lbl-app-version').textContent = `v${APP_VERSION}`;
  document.getElementById('lbl-lang').textContent = state.lang.toUpperCase();
  document.getElementById('lbl-theme').textContent =
    state.theme === 'dark'
      ? translate(state.lang, 'topbar.themeDark')
      : translate(state.lang, 'topbar.themeLight');

  const scopeSel = document.getElementById('global-search-scope');
  if (scopeSel) scopeSel.value = state.globalSearchScope || 'all';

  renderEnvironmentSelector(state);
  renderSidebar(state, renderAll);
  renderCenterEditor(state, renderAll);
  renderResponsePanel(state);
  renderFlowsStudioView(state, renderAll);
}
