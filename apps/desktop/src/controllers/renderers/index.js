/**
 * Índice Modular de Renderizadores de Interfaz (Barrel) — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/index.js
 */
import { translate, applyDomTranslations } from "../../lang/i18n.js";
import { APP_VERSION } from "../../services/storage-sync.js";
import { renderEnvironmentSelector } from "./layout-prefs.js";
import { renderSidebar } from "./sidebar.js";
import { renderCenterEditor } from "./center-editor.js";
import { renderResponsePanel } from "./response-panel.js";
import { renderFlowsStudioView } from "./flows-studio.js";
import { renderSettingsModalContent } from "./settings-modal.js";

export * from "./dom-utils.js";
export * from "./workspace-helpers.js";
export * from "./layout-prefs.js";
export * from "./settings-modal.js";
export * from "./sidebar-collections.js";
export * from "./sidebar-environments.js";
export * from "./sidebar-history.js";
export * from "./sidebar.js";
export * from "./center-editor-tabs.js";
export * from "./center-editor-events.js";
export * from "./center-editor.js";
export * from "./json-viewer.js";
export * from "./response-panel.js";
export * from "./flows-studio.js";

export function renderAllViews(state) {
  const renderAll = () => renderAllViews(state);
  applyDomTranslations(state.lang, document);
  document.getElementById("lbl-app-version").textContent = `v${APP_VERSION}`;
  document.getElementById("lbl-lang").textContent = state.lang.toUpperCase();
  document.getElementById("lbl-theme").textContent =
    state.theme === "dark"
      ? translate(state.lang, "topbar.themeDark")
      : translate(state.lang, "topbar.themeLight");

  const scopeSel = document.getElementById("global-search-scope");
  if (scopeSel) scopeSel.value = state.globalSearchScope || "all";

  renderEnvironmentSelector(state);
  renderSidebar(state, renderAll);
  renderCenterEditor(state, renderAll);
  renderResponsePanel(state);
  renderFlowsStudioView(state, renderAll);

  const settingsModal = document.getElementById("modal-settings");
  if (settingsModal && typeof settingsModal.classList?.contains === "function" && settingsModal.classList.contains("open")) {
    renderSettingsModalContent(state, renderAll);
  }
}
