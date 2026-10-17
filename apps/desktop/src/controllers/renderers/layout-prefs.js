/**
 * Renderizadores de Preferencias de Disposición Visual y Selector de Entorno — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/layout-prefs.js
 */
import { translate } from "../../lang/i18n.js";
import { escapeHtml, escapeAttr } from "./dom-utils.js";

export function renderViewLayoutPreferences(state) {
  const wsRoot = document.getElementById("workspace-root");
  const flowsView = document.getElementById("flows-studio-view");
  const btnFlowLbl = document.getElementById("lbl-btn-flow");

  if (state.activeMainView === "flows") {
    wsRoot.style.display = "none";
    flowsView.classList.add("active");
    if (btnFlowLbl) btnFlowLbl.textContent = translate(state.lang, "topbar.btnFlowsBack");
  } else {
    wsRoot.style.display = "flex";
    flowsView.classList.remove("active");
    if (btnFlowLbl) btnFlowLbl.textContent = translate(state.lang, "topbar.btnFlows");
  }

  const sidebar = document.getElementById("main-sidebar");
  const pinBtn = document.getElementById("lbl-pin-state");
  const toggleBtn = document.getElementById("btn-toggle-sidebar");
  const toolbar = document.getElementById("sidebar-toolbar");

  sidebar.style.width = state.sidebarVisible ? state.sidebarWidth + "px" : "0px";
  sidebar.style.minWidth = state.sidebarVisible ? state.sidebarWidth + "px" : "0px";
  sidebar.classList.toggle("collapsed", !state.sidebarVisible);
  sidebar.classList.toggle("unpinned", !state.sidebarPinned && state.sidebarVisible);
  toggleBtn.classList.toggle("active-toggle", state.sidebarVisible);
  pinBtn.textContent = state.sidebarPinned
    ? translate(state.lang, "sidebar.pinFixed")
    : translate(state.lang, "sidebar.pinFloating");

  if (toolbar) {
    toolbar.style.display = state.sideTab === "collections" ? "flex" : "none";
  }

  const splitContainer = document.getElementById("main-split-container");
  const centerPane = document.getElementById("center-request-panel");
  const splitResizer = document.getElementById("split-resizer");
  const maxLbl = document.getElementById("lbl-max-resp");

  splitContainer.classList.toggle("vertical", Boolean(state.splitVertical));
  centerPane.classList.toggle("hidden-when-max", Boolean(state.responseMaximized));
  splitResizer.style.display = state.responseMaximized ? "none" : "flex";
  if (maxLbl) {
    maxLbl.textContent = state.responseMaximized
      ? translate(state.lang, "response.btnRestore")
      : translate(state.lang, "response.btnMaximize");
  }

  const ratio = Math.min(72, Math.max(28, Number(state.splitRatio) || 48));
  if (state.splitVertical) {
    centerPane.style.height = ratio + "%";
    centerPane.style.width = "100%";
  } else {
    centerPane.style.width = ratio + "%";
    centerPane.style.height = "100%";
  }

  document.querySelectorAll("[data-side-tab]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-side-tab") === state.sideTab);
  });
  document.querySelectorAll("[data-req-tab]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-req-tab") === state.reqSubTab);
  });
  document.querySelectorAll("[data-resp-tab]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-resp-tab") === state.respSubTab);
  });
}

export function renderEnvironmentSelector(state) {
  const sel = document.getElementById("env-select");
  const options = [
    `<option value="none" ${state.activeEnvId === "none" ? "selected" : ""}>${escapeHtml(translate(state.lang, "topbar.noEnv"))}</option>`
  ];
  for (const env of state.environments) {
    options.push(
      `<option value="${escapeAttr(env.id)}" ${state.activeEnvId === env.id ? "selected" : ""}>${escapeHtml(env.name)}</option>`
    );
  }
  sel.innerHTML = options.join("");
}
