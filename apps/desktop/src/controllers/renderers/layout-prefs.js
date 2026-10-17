/**
 * Renderizadores de Preferencias de Disposición Visual y Selector de Entorno — ElTransportador v1.2.0
 * Archivo: apps/desktop/src/controllers/renderers/layout-prefs.js
 */
import { translate } from "../../lang/i18n.js";
import { escapeHtml, escapeAttr } from "./dom-utils.js";

export function renderViewLayoutPreferences(state) {
  const wsRoot = document.getElementById("workspace-root");
  const flowsView = document.getElementById("flows-studio-view");
  const btnFlowLbl = document.getElementById("lbl-btn-flow");
  const isFlowsMode = state.activeMainView === "flows";

  // Ocultar controles exclusivos del Tester de APIs cuando se está en el Estudio de Flujos
  const apiTesterTopbarEls = [
    document.getElementById("btn-toggle-sidebar"),
    document.querySelector(".etp-topbar-center"),
    document.getElementById("lbl-env"),
    document.getElementById("env-select"),
    document.getElementById("btn-open-vault"),
    document.getElementById("btn-open-import")
  ];
  for (const el of apiTesterTopbarEls) {
    if (el) {
      el.style.display = isFlowsMode ? "none" : "";
    }
  }

  if (isFlowsMode) {
    wsRoot.style.display = "none";
    flowsView.classList.add("active");
    if (btnFlowLbl) btnFlowLbl.textContent = translate(state.lang, "topbar.btnFlowsBack");
  } else {
    wsRoot.style.display = "flex";
    flowsView.classList.remove("active");
    if (btnFlowLbl) btnFlowLbl.textContent = translate(state.lang, "topbar.btnFlows");
  }

  // Menú lateral de la pantalla principal (Tester de APIs) — independiente del de Flujos
  const sidebar = document.getElementById("main-sidebar");
  const pinBtn = document.getElementById("lbl-pin-state");
  const toggleBtn = document.getElementById("btn-toggle-sidebar");
  const toolbar = document.getElementById("sidebar-toolbar");

  if (sidebar) {
    sidebar.style.width = state.sidebarVisible ? state.sidebarWidth + "px" : "0px";
    sidebar.style.minWidth = state.sidebarVisible ? state.sidebarWidth + "px" : "0px";
    sidebar.classList.toggle("collapsed", !state.sidebarVisible);
    sidebar.classList.toggle("unpinned", !state.sidebarPinned && state.sidebarVisible);
  }
  if (toggleBtn) toggleBtn.classList.toggle("active-toggle", state.sidebarVisible);
  if (pinBtn) {
    pinBtn.textContent = state.sidebarPinned
      ? translate(state.lang, "sidebar.pinFixed")
      : translate(state.lang, "sidebar.pinFloating");
  }

  if (toolbar) {
    toolbar.style.display = state.sideTab === "collections" ? "flex" : "none";
  }

  // Menú lateral izquierdo de Flows Studio — independiente
  const flowsLeftSidebar = document.getElementById("flows-left-sidebar");
  const flowsLeftPinLbl = document.getElementById("lbl-flows-left-pin-state");
  const flowsLeftToggleBtn = document.getElementById("btn-toggle-flows-left-sidebar");
  const fLeftVisible = state.flowsLeftSidebarVisible !== false;
  const fLeftPinned = state.flowsLeftSidebarPinned !== false;
  const fLeftWidth = Math.min(540, Math.max(220, Number(state.flowsLeftSidebarWidth) || 300));

  if (flowsLeftSidebar) {
    flowsLeftSidebar.style.width = fLeftVisible ? fLeftWidth + "px" : "0px";
    flowsLeftSidebar.style.minWidth = fLeftVisible ? fLeftWidth + "px" : "0px";
    flowsLeftSidebar.classList.toggle("collapsed", !fLeftVisible);
    flowsLeftSidebar.classList.toggle("unpinned", !fLeftPinned && fLeftVisible);
  }
  if (flowsLeftPinLbl) {
    flowsLeftPinLbl.textContent = fLeftPinned
      ? translate(state.lang, "sidebar.pinFixed")
      : translate(state.lang, "sidebar.pinFloating");
  }
  if (flowsLeftToggleBtn) {
    flowsLeftToggleBtn.classList.toggle("active-toggle", fLeftVisible);
  }

  // Menú lateral derecho (Inspector) de Flows Studio — independiente
  const flowsRightInspector = document.getElementById("flows-right-inspector");
  const flowsRightPinLbl = document.getElementById("lbl-flows-right-pin-state");
  const flowsRightToggleBtn = document.getElementById("btn-toggle-flows-right-inspector");
  const fRightVisible = state.flowsRightInspectorVisible !== false;
  const fRightPinned = state.flowsRightInspectorPinned !== false;
  const fRightWidth = Math.min(620, Math.max(280, Number(state.flowsRightInspectorWidth) || 390));

  if (flowsRightInspector) {
    flowsRightInspector.style.width = fRightVisible ? fRightWidth + "px" : "0px";
    flowsRightInspector.style.minWidth = fRightVisible ? fRightWidth + "px" : "0px";
    flowsRightInspector.classList.toggle("collapsed", !fRightVisible);
    flowsRightInspector.classList.toggle("unpinned-right", !fRightPinned && fRightVisible);
  }
  if (flowsRightPinLbl) {
    flowsRightPinLbl.textContent = fRightPinned
      ? translate(state.lang, "sidebar.pinFixed")
      : translate(state.lang, "sidebar.pinFloating");
  }
  if (flowsRightToggleBtn) {
    flowsRightToggleBtn.classList.toggle("active-toggle", fRightVisible);
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
