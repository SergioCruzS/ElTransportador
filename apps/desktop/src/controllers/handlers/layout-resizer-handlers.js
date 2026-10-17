/**
 * Manejadores de Disposición Visual, Redimensionadores, Panel Lateral y Subpestañas — ElTransportador v1.2.0
 * Archivo: apps/desktop/src/controllers/handlers/layout-resizer-handlers.js
 */
import { persistWorkspaceToLocalStorage } from "../../services/storage-sync.js";
import {
  closeInputDialog,
  confirmInputDialog,
  clearInputDialogError,
  closeConfirmMoveModal,
  acceptConfirmMoveModal,
  renderViewLayoutPreferences,
  renderSidebar,
  renderCenterEditor,
  renderResponsePanel,
  renderFlowsStudioView
} from "../ui-renderers.js";

export function bindLayoutAndResizerHandlers(state, renderAll) {
  document.getElementById("btn-close-input-dialog")?.addEventListener("click", closeInputDialog);
  document.getElementById("btn-cancel-input-dialog")?.addEventListener("click", closeInputDialog);
  document.getElementById("btn-confirm-input-dialog")?.addEventListener("click", confirmInputDialog);
  document.getElementById("input-dialog-field")?.addEventListener("input", () => clearInputDialogError());
  document.getElementById("input-dialog-field")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmInputDialog();
    } else if (e.key === "Escape") {
      closeInputDialog();
    }
  });

  document.getElementById("btn-close-confirm-move")?.addEventListener("click", closeConfirmMoveModal);
  document.getElementById("btn-cancel-confirm-move")?.addEventListener("click", closeConfirmMoveModal);
  document.getElementById("btn-accept-confirm-move")?.addEventListener("click", acceptConfirmMoveModal);

  // 1. Temporizador flotante para el menú lateral principal (Tester de APIs)
  let floatingHideTimer = null;
  const sidebarEl = document.getElementById("main-sidebar");

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
        if (activeEl && sidebarEl?.contains(activeEl) && ["INPUT", "SELECT", "TEXTAREA"].includes(activeEl.tagName)) {
          return;
        }
        state.sidebarVisible = false;
        persistWorkspaceToLocalStorage(state);
        renderViewLayoutPreferences(state);
      }, 2200);
    }
  }

  sidebarEl?.addEventListener("mouseenter", clearFloatingTimer);
  sidebarEl?.addEventListener("focusin", clearFloatingTimer);
  sidebarEl?.addEventListener("mouseleave", scheduleFloatingAutoHide);
  sidebarEl?.addEventListener("focusout", scheduleFloatingAutoHide);

  document.getElementById("btn-toggle-sidebar")?.addEventListener("click", () => {
    state.sidebarVisible = !state.sidebarVisible;
    persistWorkspaceToLocalStorage(state);
    renderViewLayoutPreferences(state);
    if (state.sidebarVisible && !state.sidebarPinned) {
      scheduleFloatingAutoHide();
    }
  });

  document.getElementById("btn-hide-sidebar-inline")?.addEventListener("click", () => {
    state.sidebarVisible = false;
    persistWorkspaceToLocalStorage(state);
    renderViewLayoutPreferences(state);
  });

  document.getElementById("btn-pin-sidebar")?.addEventListener("click", () => {
    state.sidebarPinned = !state.sidebarPinned;
    if (state.sidebarPinned) clearFloatingTimer();
    else scheduleFloatingAutoHide();
    persistWorkspaceToLocalStorage(state);
    renderViewLayoutPreferences(state);
  });

  // 2. Temporizador flotante para el menú lateral izquierdo de Flows Studio (Totalmente independiente)
  let flowsLeftFloatingTimer = null;
  const flowsLeftSidebarEl = document.getElementById("flows-left-sidebar");

  function clearFlowsLeftFloatingTimer() {
    if (flowsLeftFloatingTimer) {
      clearTimeout(flowsLeftFloatingTimer);
      flowsLeftFloatingTimer = null;
    }
  }

  function scheduleFlowsLeftAutoHide() {
    clearFlowsLeftFloatingTimer();
    if (state.flowsLeftSidebarPinned === false && state.flowsLeftSidebarVisible !== false) {
      flowsLeftFloatingTimer = setTimeout(() => {
        const activeEl = document.activeElement;
        if (activeEl && flowsLeftSidebarEl?.contains(activeEl) && ["INPUT", "SELECT", "TEXTAREA"].includes(activeEl.tagName)) {
          return;
        }
        state.flowsLeftSidebarVisible = false;
        persistWorkspaceToLocalStorage(state);
        renderViewLayoutPreferences(state);
      }, 2200);
    }
  }

  flowsLeftSidebarEl?.addEventListener("mouseenter", clearFlowsLeftFloatingTimer);
  flowsLeftSidebarEl?.addEventListener("focusin", clearFlowsLeftFloatingTimer);
  flowsLeftSidebarEl?.addEventListener("mouseleave", scheduleFlowsLeftAutoHide);
  flowsLeftSidebarEl?.addEventListener("focusout", scheduleFlowsLeftAutoHide);

  document.getElementById("btn-pin-flows-left-sidebar")?.addEventListener("click", () => {
    state.flowsLeftSidebarPinned = state.flowsLeftSidebarPinned === false ? true : false;
    if (state.flowsLeftSidebarPinned) clearFlowsLeftFloatingTimer();
    else scheduleFlowsLeftAutoHide();
    persistWorkspaceToLocalStorage(state);
    renderViewLayoutPreferences(state);
  });

  document.getElementById("btn-hide-flows-left-sidebar")?.addEventListener("click", () => {
    state.flowsLeftSidebarVisible = false;
    persistWorkspaceToLocalStorage(state);
    renderViewLayoutPreferences(state);
  });

  // 3. Redimensionadores independientes (Sidebar principal, Split central, Menú Izquierdo de Flujos y Menú Derecho Inspector de Flujos)
  const sidebarResizer = document.getElementById("sidebar-resizer");
  const splitResizer = document.getElementById("split-resizer");
  const flowsLeftResizer = document.getElementById("flows-left-sidebar-resizer");
  let isResizingSidebar = false;
  let isResizingSplit = false;
  let isResizingFlowsLeft = false;
  let isResizingFlowsRight = false;

  sidebarResizer?.addEventListener("mousedown", () => {
    isResizingSidebar = true;
    sidebarResizer.classList.add("dragging");
  });

  splitResizer?.addEventListener("mousedown", () => {
    isResizingSplit = true;
    splitResizer.classList.add("dragging");
  });

  flowsLeftResizer?.addEventListener("mousedown", () => {
    isResizingFlowsLeft = true;
    flowsLeftResizer.classList.add("dragging");
  });

  window.addEventListener("mousedown", (e) => {
    const rightResizer = e.target.closest("#flows-right-inspector-resizer");
    if (rightResizer) {
      isResizingFlowsRight = true;
      rightResizer.classList.add("dragging");
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (isResizingSidebar) {
      state.sidebarWidth = Math.min(560, Math.max(230, e.clientX));
      renderViewLayoutPreferences(state);
      return;
    }
    if (isResizingFlowsLeft) {
      state.flowsLeftSidebarWidth = Math.min(540, Math.max(220, e.clientX));
      renderViewLayoutPreferences(state);
      return;
    }
    if (isResizingFlowsRight) {
      const newRightW = Math.min(620, Math.max(280, window.innerWidth - e.clientX));
      state.flowsRightInspectorWidth = newRightW;
      renderViewLayoutPreferences(state);
      return;
    }
    if (isResizingSplit) {
      const splitContainer = document.getElementById("main-split-container");
      if (!splitContainer) return;
      const rect = splitContainer.getBoundingClientRect();
      if (state.splitVertical) {
        state.splitRatio = Math.min(72, Math.max(28, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
      } else {
        state.splitRatio = Math.min(72, Math.max(28, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
      }
      renderViewLayoutPreferences(state);
    }
  });

  window.addEventListener("mouseup", () => {
    if (isResizingSidebar) {
      isResizingSidebar = false;
      sidebarResizer?.classList.remove("dragging");
      persistWorkspaceToLocalStorage(state);
    }
    if (isResizingFlowsLeft) {
      isResizingFlowsLeft = false;
      flowsLeftResizer?.classList.remove("dragging");
      persistWorkspaceToLocalStorage(state);
    }
    if (isResizingFlowsRight) {
      isResizingFlowsRight = false;
      document.getElementById("flows-right-inspector-resizer")?.classList.remove("dragging");
      persistWorkspaceToLocalStorage(state);
    }
    if (isResizingSplit) {
      isResizingSplit = false;
      splitResizer?.classList.remove("dragging");
      persistWorkspaceToLocalStorage(state);
    }
  });

  document.getElementById("btn-toggle-split-dir")?.addEventListener("click", () => {
    state.splitVertical = !state.splitVertical;
    persistWorkspaceToLocalStorage(state);
    renderViewLayoutPreferences(state);
  });

  document.getElementById("btn-maximize-resp")?.addEventListener("click", () => {
    state.responseMaximized = !state.responseMaximized;
    persistWorkspaceToLocalStorage(state);
    renderViewLayoutPreferences(state);
  });

  document.querySelectorAll("[data-side-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sideTab = btn.getAttribute("data-side-tab");
      persistWorkspaceToLocalStorage(state);
      renderSidebar(state, renderAll);
    });
  });

  document.querySelectorAll("[data-req-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.reqSubTab = btn.getAttribute("data-req-tab");
      persistWorkspaceToLocalStorage(state);
      renderViewLayoutPreferences(state);
      renderCenterEditor(state, renderAll);
    });
  });

  document.querySelectorAll("[data-resp-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.respSubTab = btn.getAttribute("data-resp-tab");
      persistWorkspaceToLocalStorage(state);
      renderViewLayoutPreferences(state);
      renderResponsePanel(state);
    });
  });
}
