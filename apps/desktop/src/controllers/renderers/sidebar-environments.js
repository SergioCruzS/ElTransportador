/**
 * Renderizador de la Pestaña de Entornos y Bóveda de Secretos — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/sidebar-environments.js
 *
 * Incluye:
 * - Tabla de Variables de Entorno con columna funcional de candado (`🔒`) para marcar/desmarcar variables secretas,
 *   ocultar/mostrar su valor (`👁`), cifrar en reposo y redactar automáticamente en Wire Preview, Historial y cURL.
 * - Internacionalización 100% completa (ES / EN) en todos los textos, etiquetas y notificaciones de la Bóveda de Secretos.
 */
import { translate } from "../../lang/i18n.js";
import {
  encryptSecretValue,
  persistWorkspaceToLocalStorage,
  hasAdminPasswordConfigured,
  verifyAdminPassword
} from "../../services/storage-sync.js";
import { escapeHtml, escapeAttr, showToast, openInputDialog } from "./dom-utils.js";
import { updateUrlPreviewAndInspectorOnly } from "./workspace-helpers.js";
import { renderSettingsModalContent } from "./settings-modal.js";

export function renderSidebarEnvironmentsTab(state, container, renderSidebarFn, renderAll) {
  const lang = state.lang || "es";
  const activeEnvObj = state.environments.find((e) => e.id === state.activeEnvId) || null;
  const secretKeys = Object.keys(state.secretVault || {});
  const hasPwd = hasAdminPasswordConfigured();

  let html = `
    <div class="etp-side-card">
      <div class="etp-side-card-title">
        <span>${escapeHtml(translate(lang, "environments.newEnvCardTitle"))}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <input type="text" id="new-env-name-input" class="etp-input" style="flex:1;height:30px;font-size:12px;" placeholder="${escapeAttr(translate(lang, "environments.newEnvPlaceholder"))}" />
        <button type="button" class="etp-btn etp-btn-primary" id="btn-create-env" style="height:30px;padding:0 10px;font-size:12px;">${escapeHtml(translate(lang, "environments.btnCreate"))}</button>
      </div>
    </div>

    <div class="etp-side-card">
      <div class="etp-side-card-title">
        <span>${escapeHtml(translate(lang, "environments.configuredTitle"))}</span>
        <span style="font-size:11px;color:var(--text-muted);">${state.environments.length} ${escapeHtml(translate(lang, "environments.totalSuffix"))}</span>
      </div>
  `;

  if (state.environments.length === 0) {
    html += `<p style="font-size:12px;color:var(--text-muted);padding:4px 2px;">${escapeHtml(translate(lang, "environments.emptyEnvs"))}</p>`;
  } else {
    const envCardsHtml = state.environments
      .map((env) => {
        const isAct = env.id === state.activeEnvId;
        const safeEnvId = escapeAttr(env.id);
        const safeEnvName = escapeHtml(env.name);
        return `
          <div class="etp-env-item-card ${isAct ? "active" : ""}" data-pick-env="${safeEnvId}">
            <div style="min-width:0;flex:1;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeEnvName}</span>
                ${isAct ? `<span class="etp-env-badge">${escapeHtml(translate(lang, "environments.activeBadge"))}</span>` : ""}
              </div>
              <div style="font-size:11px;color:var(--text-muted);">${(env.variables || []).length} ${escapeHtml(translate(lang, "environments.varsCountSuffix"))}</div>
            </div>
            <div class="etp-tree-actions">
              <button type="button" class="etp-icon-btn" data-rename-env="${safeEnvId}">✎</button>
              <button type="button" class="etp-icon-btn danger" data-delete-env="${safeEnvId}">🗑</button>
            </div>
          </div>
        `;
      })
      .join("");
    html += `<div style="display:flex;flex-direction:column;gap:6px;">${envCardsHtml}</div>`;
  }
  html += `</div>`;

  if (activeEnvObj) {
    const varRowsHtml = (activeEnvObj.variables || [])
      .map((v, vIdx) => {
        const isSensVar = v._userToggledSecret
          ? Boolean(v.isSecret)
          : Boolean(v.isSecret) || /secret|token|password|apikey|api_key/i.test(v.key || "");
        const revKey = `${activeEnvObj.id}_${vIdx}`;
        const isRevealed = Boolean(state.revealedEnvVars?.[revKey]);
        const inputType = isSensVar && !isRevealed ? "password" : "text";
        const valPlaceholder = escapeAttr(translate(lang, "environments.varPlaceholderVal"));
        const secTooltip = escapeAttr(translate(lang, "environments.secretVarTooltip"));
        const showHideTooltip = escapeAttr(translate(lang, "environments.showHide"));
        return `
          <tr>
            <td><input type="checkbox" data-env-var-toggle="${vIdx}" ${v.enabled ? "checked" : ""} /></td>
            <td><input class="etp-kv-input" data-env-var-key="${vIdx}" value="${escapeAttr(v.key)}" placeholder="${escapeAttr(translate(lang, "environments.varPlaceholderKey"))}" /></td>
            <td><input type="${inputType}" class="etp-kv-input" data-env-var-val="${vIdx}" value="${escapeAttr(v.value)}" placeholder="${valPlaceholder}" /></td>
            <td style="white-space:nowrap;">
              <div style="display:flex;align-items:center;gap:4px;">
                <label style="font-size:11px;display:inline-flex;align-items:center;gap:3px;cursor:pointer;" title="${secTooltip}">
                  <input type="checkbox" data-env-var-sec="${vIdx}" ${isSensVar ? "checked" : ""} />
                  <span>${isSensVar ? "🔒" : "🔓"}</span>
                </label>
                ${isSensVar ? `<button type="button" class="etp-icon-btn" data-env-var-reveal="${vIdx}" title="${showHideTooltip}">👁</button>` : ""}
              </div>
            </td>
            <td style="text-align:center;">
              <button type="button" class="etp-icon-btn danger" data-env-var-del="${vIdx}" title="${escapeAttr(translate(lang, "environments.delete"))}">×</button>
            </td>
          </tr>
        `;
      })
      .join("");

    html += `
      <div class="etp-side-card">
        <div class="etp-side-card-title">
          <span>${escapeHtml(translate(lang, "environments.varsOfPrefix"))} «${escapeHtml(activeEnvObj.name)}»</span>
          <button type="button" class="etp-btn-xs" id="btn-add-env-var">${escapeHtml(translate(lang, "environments.btnAddVar"))}</button>
        </div>
        <table class="etp-kv-table">
          <thead>
            <tr>
              <th style="width:26px;">${escapeHtml(translate(lang, "environments.colOn"))}</th>
              <th>${escapeHtml(translate(lang, "environments.colVariable"))}</th>
              <th>${escapeHtml(translate(lang, "environments.colValue"))}</th>
              <th style="width:66px;" title="${escapeAttr(translate(lang, "environments.secretVarTooltip"))}">${escapeHtml(translate(lang, "environments.colSecretLock"))}</th>
              <th style="width:26px;"></th>
            </tr>
          </thead>
          <tbody>
            ${varRowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  const secretRowsHtml =
    secretKeys.length === 0
      ? `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);font-size:11.5px;padding:10px;">${escapeHtml(translate(lang, "environments.emptyVault"))}</td></tr>`
      : secretKeys
          .map((sKey) => {
            const safeSKey = escapeAttr(sKey);
            return `
              <tr data-secret-row="${safeSKey}">
                <td style="font-family:var(--font-mono);font-weight:700;font-size:12px;">${escapeHtml(sKey)}</td>
                <td><span class="etp-secret-locked-mask" data-sec-locked="${safeSKey}">${escapeHtml(translate(lang, "environments.secretLockedBadge"))}</span></td>
                <td style="text-align:center;">
                  <button type="button" class="etp-icon-btn danger" data-sec-del="${safeSKey}" title="${escapeAttr(translate(lang, "environments.deleteSecretTooltip"))}">🗑</button>
                </td>
              </tr>
            `;
          })
          .join("");

  html += `
    <div class="etp-side-card">
      <div class="etp-side-card-title">
        <span>${escapeHtml(translate(lang, "environments.vaultTitle"))} (${secretKeys.length})</span>
        <button type="button" class="etp-btn-xs" id="btn-vault-open-settings" title="${escapeAttr(translate(lang, "environments.btnVaultPwdTooltip"))}">${escapeHtml(translate(lang, "environments.btnVaultPwd"))}</button>
      </div>

      ${
        !hasPwd
          ? `
        <div class="etp-warning-banner" id="no-admin-pwd-warning-banner">
          <strong>${escapeHtml(translate(lang, "environments.noPwdWarnTitle"))}</strong>
          <span>${escapeHtml(translate(lang, "environments.noPwdWarnDesc"))}</span>
        </div>
      `
          : ""
      }

      <p style="font-size:11px;color:var(--text-muted);">${escapeHtml(translate(lang, "environments.vaultImmutableHint"))}</p>

      <div style="display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:6px;background:var(--bg-elevated);border:1px solid var(--border-subtle);">
        <input type="text" id="new-secret-key-input" class="etp-input" style="height:28px;font-size:12px;font-family:var(--font-mono);" placeholder="${escapeAttr(translate(lang, "environments.newSecretKeyPlaceholder"))}" />
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="password" id="new-secret-val-input" class="etp-input" style="flex:1;height:28px;font-size:12px;" placeholder="${escapeAttr(translate(lang, "environments.newSecretValPlaceholder"))}" />
          <button type="button" class="etp-btn etp-btn-primary" id="btn-add-secret-row" style="height:28px;padding:0 10px;font-size:11.5px;">${escapeHtml(translate(lang, "environments.btnAddSecret"))}</button>
        </div>
      </div>

      <table class="etp-kv-table">
        <thead>
          <tr>
            <th>${escapeHtml(translate(lang, "environments.colKey"))}</th>
            <th>${escapeHtml(translate(lang, "environments.colCryptoStatus"))}</th>
            <th style="width:36px;"></th>
          </tr>
        </thead>
        <tbody>
          ${secretRowsHtml}
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;

  document.getElementById("btn-vault-open-settings")?.addEventListener("click", () => {
    renderSettingsModalContent(state, renderAll);
    document.getElementById("modal-settings").classList.add("open");
  });

  document.getElementById("btn-create-env").addEventListener("click", () => {
    const inp = document.getElementById("new-env-name-input");
    const name = (inp.value || "").trim() || `Environment ${state.environments.length + 1}`;
    const newEnv = {
      id: "env_" + Date.now(),
      name,
      variables: [
        {
          key: translate(state.lang, "environments.varPlaceholderKey"),
          value: translate(state.lang, "environments.varPlaceholderVal"),
          enabled: true,
          isSecret: false
        }
      ]
    };
    state.environments.push(newEnv);
    state.activeEnvId = newEnv.id;
    persistWorkspaceToLocalStorage(state);
    renderAll();
    showToast(translate(state.lang, "toasts.createdEnv", { name }));
  });

  document.getElementById("new-env-name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("btn-create-env").click();
    }
  });

  container.querySelectorAll("[data-pick-env]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const id = el.getAttribute("data-pick-env");
      state.activeEnvId = state.activeEnvId === id ? "none" : id;
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });

  container.querySelectorAll("[data-rename-env]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-rename-env");
      const env = state.environments.find((x) => x.id === id);
      if (!env) return;
      openInputDialog({
        title: translate(state.lang, "environments.configuredTitle"),
        label: translate(state.lang, "request.nameLabel"),
        initialValue: env.name,
        onConfirm: (nextName) => {
          env.name = nextName;
          persistWorkspaceToLocalStorage(state);
          renderAll();
          showToast(translate(state.lang, "toasts.renamedEnv", { name: nextName }));
        }
      });
    });
  });

  container.querySelectorAll("[data-delete-env]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-delete-env");
      state.environments = state.environments.filter((x) => x.id !== id);
      if (state.activeEnvId === id) state.activeEnvId = state.environments[0]?.id || "none";
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });

  const btnAddEnvVar = document.getElementById("btn-add-env-var");
  if (btnAddEnvVar && activeEnvObj) {
    btnAddEnvVar.addEventListener("click", () => {
      activeEnvObj.variables.push({
        key: translate(state.lang, "environments.defaultNewVarKey"),
        value: translate(state.lang, "environments.defaultNewVarVal"),
        enabled: true,
        isSecret: false
      });
      persistWorkspaceToLocalStorage(state);
      renderSidebarFn(state, renderAll);
      updateUrlPreviewAndInspectorOnly(state);
    });
  }

  container.querySelectorAll("[data-env-var-toggle]").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const idx = Number(chk.getAttribute("data-env-var-toggle"));
      if (activeEnvObj && activeEnvObj.variables[idx]) {
        activeEnvObj.variables[idx].enabled = e.target.checked;
        persistWorkspaceToLocalStorage(state);
        updateUrlPreviewAndInspectorOnly(state);
      }
    });
  });
  container.querySelectorAll("[data-env-var-key]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = Number(inp.getAttribute("data-env-var-key"));
      if (activeEnvObj && activeEnvObj.variables[idx]) {
        activeEnvObj.variables[idx].key = e.target.value;
        persistWorkspaceToLocalStorage(state);
        updateUrlPreviewAndInspectorOnly(state);
      }
    });
  });
  container.querySelectorAll("[data-env-var-val]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = Number(inp.getAttribute("data-env-var-val"));
      if (activeEnvObj && activeEnvObj.variables[idx]) {
        activeEnvObj.variables[idx].value = e.target.value;
        persistWorkspaceToLocalStorage(state);
        updateUrlPreviewAndInspectorOnly(state);
      }
    });
  });
  container.querySelectorAll("[data-env-var-sec]").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const idx = Number(chk.getAttribute("data-env-var-sec"));
      if (activeEnvObj && activeEnvObj.variables[idx]) {
        activeEnvObj.variables[idx].isSecret = e.target.checked;
        activeEnvObj.variables[idx]._userToggledSecret = true;
        persistWorkspaceToLocalStorage(state);
        renderSidebarFn(state, renderAll);
        updateUrlPreviewAndInspectorOnly(state);
      }
    });
  });
  container.querySelectorAll("[data-env-var-reveal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-env-var-reveal"));
      if (!activeEnvObj) return;
      const revKey = `${activeEnvObj.id}_${idx}`;
      state.revealedEnvVars = state.revealedEnvVars || {};
      state.revealedEnvVars[revKey] = !state.revealedEnvVars[revKey];
      renderSidebarFn(state, renderAll);
    });
  });
  container.querySelectorAll("[data-env-var-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-env-var-del"));
      if (activeEnvObj) {
        activeEnvObj.variables.splice(idx, 1);
        persistWorkspaceToLocalStorage(state);
        renderSidebarFn(state, renderAll);
        updateUrlPreviewAndInspectorOnly(state);
      }
    });
  });

  // Crear nuevo secreto con cifrado único e inmutable
  document.getElementById("btn-add-secret-row").addEventListener("click", () => {
    const keyInp = document.getElementById("new-secret-key-input");
    const valInp = document.getElementById("new-secret-val-input");
    let keyName = (keyInp?.value || "").trim().replace(/[^a-zA-Z0-9_.\-]/g, "_");
    const secretVal = valInp?.value || "";

    if (!keyName) {
      let idx = Object.keys(state.secretVault).length + 1;
      keyName = "secret_" + idx;
      while (state.secretVault[keyName] !== undefined) {
        idx++;
        keyName = "secret_" + idx;
      }
    }

    if (state.secretVault[keyName] !== undefined) {
      showToast(translate(state.lang, "toasts.secretExists", { key: keyName }), "warning");
      return;
    }
    if (!secretVal) {
      showToast(translate(state.lang, "toasts.secretEmptyVal"), "warning");
      return;
    }

    state.secretVault[keyName] = secretVal;
    state.secretCiphersByKey = state.secretCiphersByKey || {};
    state.secretCiphersByKey[keyName] = encryptSecretValue(secretVal);
    persistWorkspaceToLocalStorage(state);
    renderSidebarFn(state, renderAll);
    updateUrlPreviewAndInspectorOnly(state);

    if (!hasAdminPasswordConfigured()) {
      showToast(translate(state.lang, "toasts.secretCreatedTemp"), "warning");
    } else {
      showToast(translate(state.lang, "toasts.secretCreatedOk", { key: keyName }));
    }
  });

  // Eliminar secreto (requiere contraseña de administración)
  container.querySelectorAll("[data-sec-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sKey = btn.getAttribute("data-sec-del");
      if (!hasAdminPasswordConfigured()) {
        showToast(translate(state.lang, "toasts.secretDeleteNeedsPwd"), "warning");
        renderSettingsModalContent(state, renderAll);
        document.getElementById("modal-settings").classList.add("open");
        return;
      }

      openInputDialog({
        title: translate(state.lang, "modals.deleteSecretTitle"),
        label: translate(state.lang, "modals.deleteSecretLabel", { key: sKey }),
        initialValue: "",
        inputType: "password",
        placeholder: translate(state.lang, "modals.deleteSecretPlaceholder"),
        onConfirm: (enteredPwd) => {
          if (!verifyAdminPassword(enteredPwd)) {
            showToast(translate(state.lang, "toasts.secretWrongPwd", { key: sKey }), "danger");
            return;
          }
          delete state.secretVault[sKey];
          if (state.secretCiphersByKey) {
            delete state.secretCiphersByKey[sKey];
          }
          persistWorkspaceToLocalStorage(state);
          renderSidebarFn(state, renderAll);
          updateUrlPreviewAndInspectorOnly(state);
          showToast(translate(state.lang, "toasts.secretDeletedOk", { key: sKey }));
        }
      });
    });
  });
}
