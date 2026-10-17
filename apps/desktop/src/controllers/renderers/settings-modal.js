/**
 * Renderizador del Modal de Configuración Global y Administración de Secretos (ES / EN) — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/settings-modal.js
 */
import { translate } from "../../lang/i18n.js";
import {
  APP_VERSION,
  hasAdminPasswordConfigured,
  setInitialAdminPassword,
  changeAdminPasswordPreservingSecrets,
  resetForgottenAdminPasswordWipingSecrets
} from "../../services/storage-sync.js";
import { escapeHtml, escapeAttr, showToast, openConfirmMoveModal } from "./dom-utils.js";

export function renderSettingsModalContent(state, renderAll) {
  const bodyEl = document.getElementById("modal-settings-body");
  if (!bodyEl) return;

  const lang = state.lang || "es";
  const hasPwd = hasAdminPasswordConfigured();
  const secretsCount = Object.keys(state.secretVault || {}).length;

  let html = `
    <div class="etp-settings-hero">
      <div style="display:flex;flex-direction:column;gap:3px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <strong style="font-size:14px;">${escapeHtml(translate(lang, "settings.heroTitle"))}</strong>
          <span class="etp-version-pill">v${escapeHtml(APP_VERSION)}</span>
        </div>
        <span style="font-size:12px;color:var(--text-secondary);">${escapeHtml(translate(lang, "settings.heroSubtitle"))}</span>
      </div>
      <div>
        ${
          hasPwd
            ? `<span class="etp-status-badge status-2xx" id="settings-pwd-status-badge">${escapeHtml(translate(lang, "settings.pwdActiveBadge", { count: secretsCount }))}</span>`
            : `<span class="etp-status-badge status-4xx" id="settings-pwd-status-badge">${escapeHtml(translate(lang, "settings.pwdMissingBadge"))}</span>`
        }
      </div>
    </div>
  `;

  if (!hasPwd) {
    html += `
      <div class="etp-warning-banner" id="settings-no-pwd-warning">
        <strong>${escapeHtml(translate(lang, "settings.noPwdWarnTitle"))}</strong>
        <span>${escapeHtml(translate(lang, "settings.noPwdWarnDesc"))}</span>
      </div>

      <div class="etp-settings-card">
        <div class="etp-settings-card-header">
          <span>${escapeHtml(translate(lang, "settings.initCardTitle"))}</span>
          <span class="etp-search-badge">${escapeHtml(translate(lang, "settings.initCardBadge"))}</span>
        </div>
        <div class="etp-settings-grid">
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-init-pwd">${escapeHtml(translate(lang, "settings.initNewPwdLabel"))}</label>
            <input type="password" id="settings-init-pwd" class="etp-input" placeholder="${escapeAttr(translate(lang, "settings.initNewPwdPlaceholder"))}" />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-init-pwd-confirm">${escapeHtml(translate(lang, "settings.initConfirmPwdLabel"))}</label>
            <input type="password" id="settings-init-pwd-confirm" class="etp-input" placeholder="${escapeAttr(translate(lang, "settings.initConfirmPwdPlaceholder"))}" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <button type="button" class="etp-btn etp-btn-primary" id="btn-save-initial-pwd">${escapeHtml(translate(lang, "settings.btnSaveInitPwd"))}</button>
        </div>
      </div>
    `;
  } else {
    html += `
      <div class="etp-settings-grid">
        <div class="etp-settings-card">
          <div class="etp-settings-card-header">
            <span>${escapeHtml(translate(lang, "settings.changeCardTitle"))}</span>
            <span class="etp-env-badge">${escapeHtml(translate(lang, "settings.changeCardBadge"))}</span>
          </div>
          <p style="font-size:12px;color:var(--text-secondary);">${escapeHtml(translate(lang, "settings.changeCardDesc", { count: secretsCount }))}</p>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-old-pwd">${escapeHtml(translate(lang, "settings.oldPwdLabel"))}</label>
            <input type="password" id="settings-old-pwd" class="etp-input" placeholder="${escapeAttr(translate(lang, "settings.oldPwdPlaceholder"))}" />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-change-new-pwd">${escapeHtml(translate(lang, "settings.changeNewPwdLabel"))}</label>
            <input type="password" id="settings-change-new-pwd" class="etp-input" placeholder="${escapeAttr(translate(lang, "settings.changeNewPwdPlaceholder"))}" />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-change-confirm-pwd">${escapeHtml(translate(lang, "settings.changeConfirmPwdLabel"))}</label>
            <input type="password" id="settings-change-confirm-pwd" class="etp-input" placeholder="${escapeAttr(translate(lang, "settings.changeConfirmPwdPlaceholder"))}" />
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:auto;">
            <button type="button" class="etp-btn etp-btn-primary" id="btn-change-pwd-keep-secrets">${escapeHtml(translate(lang, "settings.btnChangePwdKeep"))}</button>
          </div>
        </div>

        <div class="etp-settings-card danger-zone">
          <div class="etp-settings-card-header">
            <span style="color:var(--status-danger);">${escapeHtml(translate(lang, "settings.resetCardTitle"))}</span>
          </div>
          <div class="etp-danger-banner">
            <strong>${escapeHtml(translate(lang, "settings.resetDangerTitle"))}</strong> ${escapeHtml(translate(lang, "settings.resetDangerDesc", { count: secretsCount }))}
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-reset-new-pwd">${escapeHtml(translate(lang, "settings.resetNewPwdLabel"))}</label>
            <input type="password" id="settings-reset-new-pwd" class="etp-input" placeholder="${escapeAttr(translate(lang, "settings.resetNewPwdPlaceholder"))}" />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" for="settings-reset-confirm-pwd">${escapeHtml(translate(lang, "settings.resetConfirmPwdLabel"))}</label>
            <input type="password" id="settings-reset-confirm-pwd" class="etp-input" placeholder="${escapeAttr(translate(lang, "settings.resetConfirmPwdPlaceholder"))}" />
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:auto;">
            <button type="button" class="etp-btn etp-btn-danger" id="btn-reset-forgotten-pwd">${escapeHtml(translate(lang, "settings.btnResetPwdWipe"))}</button>
          </div>
        </div>
      </div>
    `;
  }

  html += `
    <div class="etp-settings-card">
      <div class="etp-settings-card-header">
        <span>${escapeHtml(translate(lang, "settings.policiesCardTitle"))}</span>
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);">com.eltransportador.desktop</span>
      </div>
      <table class="etp-kv-table">
        <tbody>
          <tr><td><strong>${escapeHtml(translate(lang, "settings.polEncryptionLabel"))}</strong></td><td>${escapeHtml(translate(lang, "settings.polEncryptionVal"))}</td></tr>
          <tr><td><strong>${escapeHtml(translate(lang, "settings.polVaultLabel"))}</strong></td><td>${escapeHtml(translate(lang, "settings.polVaultVal"))}</td></tr>
          <tr><td><strong>${escapeHtml(translate(lang, "settings.polSsrfLabel"))}</strong></td><td>${escapeHtml(translate(lang, "settings.polSsrfVal"))}</td></tr>
          <tr><td><strong>${escapeHtml(translate(lang, "settings.polSandboxLabel"))}</strong></td><td><code>${escapeHtml(translate(lang, "settings.polSandboxVal"))}</code></td></tr>
        </tbody>
      </table>
    </div>
  `;

  bodyEl.innerHTML = html;

  document.getElementById("btn-save-initial-pwd")?.addEventListener("click", () => {
    const p1 = (document.getElementById("settings-init-pwd")?.value || "").trim();
    const p2 = (document.getElementById("settings-init-pwd-confirm")?.value || "").trim();
    if (p1.length < 4) {
      showToast(translate(state.lang, "toasts.pwdMinLength"), "warning");
      return;
    }
    if (p1 !== p2) {
      showToast(translate(state.lang, "toasts.pwdMismatch"), "danger");
      return;
    }
    const res = setInitialAdminPassword(p1, state);
    if (res.ok) {
      showToast(translate(state.lang, "toasts.pwdSavedInit"));
      renderSettingsModalContent(state, renderAll);
      renderAll();
    }
  });

  document.getElementById("btn-change-pwd-keep-secrets")?.addEventListener("click", () => {
    const oldP = (document.getElementById("settings-old-pwd")?.value || "").trim();
    const newP = (document.getElementById("settings-change-new-pwd")?.value || "").trim();
    const confP = (document.getElementById("settings-change-confirm-pwd")?.value || "").trim();
    if (!oldP) {
      showToast(translate(state.lang, "toasts.pwdNeedOld"), "warning");
      return;
    }
    if (newP.length < 4) {
      showToast(translate(state.lang, "toasts.pwdMinLength"), "warning");
      return;
    }
    if (newP !== confP) {
      showToast(translate(state.lang, "toasts.pwdMismatch"), "danger");
      return;
    }
    const res = changeAdminPasswordPreservingSecrets(oldP, newP, state);
    if (!res.ok) {
      showToast(translate(state.lang, "toasts.pwdWrongOld"), "danger");
      return;
    }
    showToast(translate(state.lang, "toasts.pwdChangedKeep"));
    renderSettingsModalContent(state, renderAll);
    renderAll();
  });

  document.getElementById("btn-reset-forgotten-pwd")?.addEventListener("click", () => {
    const newP = (document.getElementById("settings-reset-new-pwd")?.value || "").trim();
    const confP = (document.getElementById("settings-reset-confirm-pwd")?.value || "").trim();
    if (newP.length < 4) {
      showToast(translate(state.lang, "toasts.pwdMinLength"), "warning");
      return;
    }
    if (newP !== confP) {
      showToast(translate(state.lang, "toasts.pwdMismatch"), "danger");
      return;
    }
    openConfirmMoveModal(
      translate(state.lang, "settings.resetConfirmModalMsg", {
        count: Object.keys(state.secretVault || {}).length
      }),
      () => {
        resetForgottenAdminPasswordWipingSecrets(newP, state);
        renderSettingsModalContent(state, renderAll);
        renderAll();
        showToast(translate(state.lang, "toasts.pwdResetWiped"), "warning");
      },
      translate(state.lang, "settings.resetConfirmModalTitle"),
      state.lang
    );
  });
}
