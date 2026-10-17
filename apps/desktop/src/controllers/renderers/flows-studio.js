/**
 * Renderizador Principal del Estudio y Orquestador Visual de Flujos de API — ElTransportador v1.2.0
 * Soporta secciones independientes para Modo Básico (secuencial) y Modo Avanzado (grafo visual).
 * Archivo: apps/desktop/src/controllers/renderers/flows-studio.js
 */
import { translate } from "../../lang/i18n.js";
import { persistWorkspaceToLocalStorage } from "../../services/storage-sync.js";
import {
  migrateFlowToV2,
  createIndependentAdvancedFlowFromBasic,
  validateFlowGraph,
  executeBasicFlow,
  executeAdvancedFlowGraph,
  createFlowExecutionController,
  NODE_TYPES
} from "../../services/flows/index.js";
import { escapeHtml, escapeAttr, showToast, openInputDialog } from "./dom-utils.js";
import { renderViewLayoutPreferences } from "./layout-prefs.js";
import { renderResponsePanel } from "./response-panel.js";
import { renderBasicFlowModeHtml, attachBasicFlowModeEvents } from "./flows/flows-basic-view.js";
import { renderAdvancedFlowCanvasHtml, attachAdvancedFlowCanvasEvents } from "./flows/flows-canvas-view.js";

function ensureFlowStudioUiState(state) {
  if (!state.flowStudioUi || typeof state.flowStudioUi !== "object") {
    state.flowStudioUi = {
      activeSectionMode: state.flowsActiveSectionMode === "advanced" ? "advanced" : "basic",
      selectedNodeId: null,
      selectedEdgeId: null,
      inspectorTab: "node",
      basicSelectedStepReqId: null,
      endpointSearchQuery: "",
      connectingFrom: null,
      compareRunIdA: null,
      compareRunIdB: null,
      execStatusByNode: {},
      execAttemptByNode: {},
      takenEdgeIds: [],
      focusedErrorNodeId: null,
      focusedErrorEdgeId: null,
      lastValidation: null,
      activeController: null,
      isRunning: false,
      isPaused: false
    };
  }
  if (!state.flowStudioUi.activeSectionMode) {
    state.flowStudioUi.activeSectionMode =
      state.flowsActiveSectionMode === "advanced" ? "advanced" : "basic";
  }
  return state.flowStudioUi;
}

export function renderFlowsStudioView(state, renderAll) {
  const sidebarListEl = document.getElementById("flows-sidebar-list");
  const sidebarTitleEl = document.getElementById("lbl-flows-sidebar-title");
  const sectionBadgeEl =
    document.getElementById("lbl-flows-section-badge") ||
    document.getElementById("flows-active-section-badge");
  const mainContentEl = document.getElementById("flows-studio-main-content");
  if (!sidebarListEl || !mainContentEl) return;

  const lang = state.lang || "es";
  const ui = ensureFlowStudioUiState(state);

  const allRequests = [];
  for (const col of state.collections || []) {
    for (const r of col.requests || []) {
      allRequests.push({ ...r, collectionName: col.metadata?.name || "Collection" });
    }
  }

  // Migrar en el mismo objeto sin reemplazar las referencias en memoria
  state.customFlows = Array.isArray(state.customFlows) ? state.customFlows : [];
  for (let i = 0; i < state.customFlows.length; i++) {
    const flw = state.customFlows[i];
    if (!flw || flw.schemaVersion !== 2) {
      state.customFlows[i] = migrateFlowToV2(flw, allRequests);
    }
  }

  // Si hay un activeFlowId explícito cuyo modo difiere y aún no fue sincronizado, alinear o filtrar por sección
  const currentSelectedAny = state.customFlows.find((f) => f.id === state.activeFlowId) || null;
  if (currentSelectedAny && !ui._sectionInitialized) {
    ui.activeSectionMode = currentSelectedAny.mode === "advanced" ? "advanced" : "basic";
    state.flowsActiveSectionMode = ui.activeSectionMode;
    ui._sectionInitialized = true;
  } else {
    ui._sectionInitialized = true;
  }

  const activeSectionMode = ui.activeSectionMode === "advanced" ? "advanced" : "basic";
  state.flowsActiveSectionMode = activeSectionMode;
  const isAdvancedSection = activeSectionMode === "advanced";

  // Filtrar flujos estrictamente por la sección activa (Básico vs Avanzado independientes)
  const sectionFlows = state.customFlows.filter(
    (f) => (f.mode === "advanced" ? "advanced" : "basic") === activeSectionMode
  );

  if (sidebarTitleEl) {
    sidebarTitleEl.textContent = `${translate(lang, "flows.myFlows")} (${sectionFlows.length})`;
  }
  if (sectionBadgeEl) {
    sectionBadgeEl.textContent = isAdvancedSection
      ? `🕸 ${translate(lang, "flows.modeAdvanced")}`
      : `☰ ${translate(lang, "flows.modeBasic")}`;
  }

  const flowQuery = (state.flowsSearchQuery || "").trim().toLowerCase();
  const visibleFlows = sectionFlows.filter(
    (f) => !flowQuery || (f.name || "").toLowerCase().includes(flowQuery)
  );

  if (visibleFlows.length === 0) {
    sidebarListEl.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px;border:1px dashed var(--border-strong);border-radius:7px;">${escapeHtml(translate(lang, "flows.emptyFlowsList"))}</div>`;
  } else {
    sidebarListEl.innerHTML = visibleFlows
      .map((flw) => {
        const isAct = flw.id === state.activeFlowId;
        const safeFlwId = escapeAttr(flw.id);
        const isAdv = flw.mode === "advanced";
        const modeBadge = isAdv
          ? translate(lang, "flows.tagAdvanced")
          : translate(lang, "flows.tagBasic");
        const stepsCount = isAdv
          ? (flw.graph?.nodes || []).filter((n) => n.type === NODE_TYPES.HTTP_REQUEST).length
          : (flw.selectedRequestIds || []).length;
        return `
          <div class="etp-env-item-card ${isAct ? "active" : ""}" data-select-flow="${safeFlwId}">
            <div style="min-width:0;flex:1;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">⚡ ${escapeHtml(flw.name)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
                <span class="etp-search-badge" style="font-size:9.5px;${isAdv ? "color:var(--accent-primary);border-color:var(--accent-primary);" : ""}">${escapeHtml(modeBadge)}</span>
                <span style="font-size:11px;color:var(--text-muted);">${stepsCount} ${escapeHtml(translate(lang, "flows.endpointsSelectedSuffix"))}</span>
              </div>
            </div>
            <div class="etp-tree-actions">
              <button type="button" class="etp-icon-btn" data-rename-flow="${safeFlwId}">✎</button>
              <button type="button" class="etp-icon-btn danger" data-delete-flow="${safeFlwId}">🗑</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  sidebarListEl.querySelectorAll("[data-select-flow]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      state.activeFlowId = el.getAttribute("data-select-flow");
      ui.selectedNodeId = null;
      ui.selectedEdgeId = null;
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  sidebarListEl.querySelectorAll("[data-rename-flow]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const fId = btn.getAttribute("data-rename-flow");
      const flw = state.customFlows.find((f) => f.id === fId);
      if (!flw) return;
      openInputDialog({
        title: translate(lang, "flows.myFlows"),
        label: translate(lang, "request.nameLabel"),
        initialValue: flw.name,
        onConfirm: (nextName) => {
          flw.name = nextName;
          persistWorkspaceToLocalStorage(state);
          renderFlowsStudioView(state, renderAll);
        }
      });
    });
  });

  sidebarListEl.querySelectorAll("[data-delete-flow]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const fId = btn.getAttribute("data-delete-flow");
      state.customFlows = state.customFlows.filter((f) => f.id !== fId);
      const remainingInSection = state.customFlows.filter(
        (f) => (f.mode === "advanced" ? "advanced" : "basic") === activeSectionMode
      );
      state.activeFlowId = remainingInSection[0]?.id || null;
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  // Seleccionar flujo activo únicamente dentro de la sección actual
  let activeFlow = sectionFlows.find((f) => f.id === state.activeFlowId) || sectionFlows[0] || null;
  if (activeFlow && state.activeFlowId !== activeFlow.id) {
    state.activeFlowId = activeFlow.id;
  } else if (!activeFlow) {
    state.activeFlowId = null;
  }

  const leftVisible = state.flowsLeftSidebarVisible !== false;
  const rightVisible = state.flowsRightInspectorVisible !== false;

  const buildHeaderModeSwitchHtml = () => `
    <div class="etp-flow-mode-switch" role="tablist" aria-label="Selector de modo de Flows Studio">
      <button
        type="button"
        class="etp-flow-mode-btn ${!isAdvancedSection ? "active" : ""}"
        id="btn-flow-mode-basic"
        role="tab"
        aria-selected="${!isAdvancedSection}"
      >
        ☰ ${escapeHtml(translate(lang, "flows.modeBasic"))}
      </button>
      <button
        type="button"
        class="etp-flow-mode-btn ${isAdvancedSection ? "active" : ""}"
        id="btn-flow-mode-advanced"
        role="tab"
        aria-selected="${isAdvancedSection}"
      >
        🕸 ${escapeHtml(translate(lang, "flows.modeAdvanced"))}
      </button>
    </div>
  `;

  const attachSectionSwitchHandlers = () => {
    document.getElementById("btn-toggle-flows-left-sidebar")?.addEventListener("click", () => {
      state.flowsLeftSidebarVisible = !(state.flowsLeftSidebarVisible !== false);
      persistWorkspaceToLocalStorage(state);
      renderViewLayoutPreferences(state);
      renderFlowsStudioView(state, renderAll);
    });

    document.getElementById("btn-toggle-flows-right-inspector")?.addEventListener("click", () => {
      state.flowsRightInspectorVisible = !(state.flowsRightInspectorVisible !== false);
      persistWorkspaceToLocalStorage(state);
      renderViewLayoutPreferences(state);
      renderFlowsStudioView(state, renderAll);
    });

    document.getElementById("btn-back-to-editor-inline")?.addEventListener("click", () => {
      state.activeMainView = "workspace";
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });

    document.getElementById("btn-flow-mode-basic")?.addEventListener("click", () => {
      ui.activeSectionMode = "basic";
      state.flowsActiveSectionMode = "basic";
      const basicFlows = state.customFlows.filter((f) => (f.mode || "basic") === "basic");
      state.activeFlowId = basicFlows[0]?.id || null;
      ui.selectedNodeId = null;
      ui.selectedEdgeId = null;
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });

    document.getElementById("btn-flow-mode-advanced")?.addEventListener("click", () => {
      ui.activeSectionMode = "advanced";
      state.flowsActiveSectionMode = "advanced";
      const advFlows = state.customFlows.filter((f) => f.mode === "advanced");
      state.activeFlowId = advFlows[0]?.id || null;
      ui.selectedNodeId = advFlows[0]?.graph?.nodes?.[0]?.id || null;
      ui.selectedEdgeId = null;
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  };

  if (!activeFlow) {
    mainContentEl.innerHTML = `
      <header class="etp-flows-header">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button type="button" class="etp-btn ${leftVisible ? "active-toggle" : ""}" id="btn-toggle-flows-left-sidebar" title="${escapeAttr(translate(lang, "flows.flowsPanelTooltip"))}">
            ◧ <span>${escapeHtml(translate(lang, "flows.flowsPanelBtn"))}</span>
          </button>
          <div>
            <h2 style="font-size:15px;font-weight:700;">⚡ ${escapeHtml(translate(lang, "flows.studioTitle"))}</h2>
            <p style="font-size:12px;color:var(--text-secondary);">${escapeHtml(translate(lang, "flows.studioSubtitle"))}</p>
          </div>
          ${buildHeaderModeSwitchHtml()}
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button type="button" class="etp-btn" id="btn-back-to-editor-inline">${escapeHtml(translate(lang, "topbar.btnFlowsBack"))}</button>
        </div>
      </header>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;text-align:center;gap:12px;">
        <div style="font-size:32px;">${isAdvancedSection ? "🕸" : "☰"}</div>
        <h3 style="font-size:16px;">${escapeHtml(translate(lang, "flows.noActiveFlowTitle"))} (${escapeHtml(isAdvancedSection ? translate(lang, "flows.modeAdvanced") : translate(lang, "flows.modeBasic"))})</h3>
        <p style="font-size:13px;color:var(--text-secondary);max-width:460px;">${escapeHtml(translate(lang, "flows.noActiveFlowDesc"))}</p>
        <button type="button" class="etp-btn etp-btn-primary" id="btn-create-flow-empty-cta">${escapeHtml(translate(lang, "flows.btnNewFlow"))}</button>
      </div>
    `;
    attachSectionSwitchHandlers();
    document.getElementById("btn-create-flow-empty-cta")?.addEventListener("click", () => {
      document.getElementById("btn-create-custom-flow")?.click();
    });
    return;
  }

  const catQ = (state.flowCatalogSearchQuery || "").trim().toLowerCase();
  const filteredCatalog = allRequests.filter(
    (r) =>
      !catQ ||
      r.name.toLowerCase().includes(catQ) ||
      r.url.toLowerCase().includes(catQ) ||
      r.method.toLowerCase().includes(catQ)
  );
  const orderedStepReqs = (activeFlow.selectedRequestIds || [])
    .map((id) => allRequests.find((r) => r.id === id))
    .filter(Boolean);

  const isAdvanced = activeFlow.mode === "advanced";
  const rerenderFlows = () => renderFlowsStudioView(state, renderAll);

  async function runActiveFlowWithOptions(opts = {}) {
    if (ui.isRunning) return;
    const currentOrderedReqs = (activeFlow.selectedRequestIds || [])
      .map((id) => allRequests.find((r) => r.id === id))
      .filter(Boolean);

    if (!isAdvanced && currentOrderedReqs.length === 0) {
      showToast(translate(lang, "toasts.selectAtLeastOneStep"), "warning");
      return;
    }

    const singleNodeId = opts.onlyNodeId || opts.retrySingleNodeId || null;
    if (isAdvanced && !singleNodeId) {
      const validation = validateFlowGraph(activeFlow, allRequests, state);
      ui.lastValidation = validation;
      if (!validation.valid) {
        ui.inspectorTab = "diagnostic";
        rerenderFlows();
        showToast(
          `✗ El grafo tiene ${validation.errors.length} error(es) de validación. Revisa el panel Diagnóstico.`,
          "danger"
        );
        return;
      }
    }

    const ctrl = createFlowExecutionController();
    ui.activeController = ctrl;
    ui.isRunning = true;
    ui.isPaused = false;
    ui.execStatusByNode = {};
    ui.execAttemptByNode = {};
    ui.takenEdgeIds = [];
    ui.focusedErrorNodeId = null;
    ui.focusedErrorEdgeId = null;
    rerenderFlows();

    const commonCallbacks = {
      controller: ctrl,
      simulateOnly: Boolean(opts.simulateOnly),
      startFromNodeId: opts.startFromNodeId || null,
      onlyNodeId: singleNodeId,
      retrySingleNodeId: singleNodeId,
      onNodeStateChange: (nodeId, execState, attemptInfo) => {
        ui.execStatusByNode[nodeId] = execState;
        if (attemptInfo) ui.execAttemptByNode[nodeId] = attemptInfo;
        const nodeEl = document.querySelector(`[data-flow-node-id="${nodeId}"]`);
        if (nodeEl) {
          nodeEl.className = `etp-flow-node type-${nodeEl.getAttribute("data-node-type") || "http_request"} exec-${execState} ${ui.selectedNodeId === nodeId ? "selected" : ""}`;
        }
      },
      onEdgeTaken: (edgeId) => {
        if (!ui.takenEdgeIds.includes(edgeId)) {
          ui.takenEdgeIds.push(edgeId);
        }
      }
    };

    const report = isAdvanced
      ? await executeAdvancedFlowGraph(activeFlow, allRequests, state, commonCallbacks)
      : await executeBasicFlow(activeFlow, allRequests, state, commonCallbacks);

    ui.isRunning = false;
    ui.isPaused = false;
    ui.activeController = null;

    // Asegurar sincronización en state.customFlows
    const flowIdx = state.customFlows.findIndex((f) => f.id === activeFlow.id);
    if (flowIdx >= 0) {
      state.customFlows[flowIdx] = activeFlow;
    }

    if (report && !report.allPassed && report.failedNodeId && isAdvanced) {
      ui.selectedNodeId = report.failedNodeId;
      ui.focusedErrorNodeId = report.failedNodeId;
      ui.focusedErrorEdgeId = report.failedEdgeId || null;
      ui.inspectorTab = "diagnostic";
      const failedNode = activeFlow.graph.nodes.find((n) => n.id === report.failedNodeId);
      if (failedNode && activeFlow.graph.viewport) {
        activeFlow.graph.viewport.x = Math.max(-600, 180 - (Number(failedNode.x) || 0));
        activeFlow.graph.viewport.y = Math.max(-400, 120 - (Number(failedNode.y) || 0));
      }
    }

    persistWorkspaceToLocalStorage(state);
    rerenderFlows();
    renderResponsePanel(state);
  }

  const bodyModeHtml = isAdvanced
    ? renderAdvancedFlowCanvasHtml(state, activeFlow, allRequests)
    : renderBasicFlowModeHtml(state, activeFlow, allRequests, filteredCatalog, orderedStepReqs);

  const flowTagPill = isAdvanced
    ? `<span class="etp-version-pill" style="background:var(--bg-active);">${escapeHtml(translate(lang, "flows.tagAdvanced"))}</span>`
    : `<span class="etp-version-pill">${escapeHtml(translate(lang, "flows.tagBasic"))}</span>`;

  mainContentEl.innerHTML = `
    <header class="etp-flows-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button type="button" class="etp-btn ${leftVisible ? "active-toggle" : ""}" id="btn-toggle-flows-left-sidebar" title="${escapeAttr(translate(lang, "flows.flowsPanelTooltip"))}">
          ◧ <span>${escapeHtml(translate(lang, "flows.flowsPanelBtn"))}</span>
        </button>
        <div>
          <div style="display:flex;align-items:center;gap:8px;">
            <h2 style="font-size:15px;font-weight:700;">⚡ ${escapeHtml(activeFlow.name)}</h2>
            ${flowTagPill}
          </div>
          <p style="font-size:12px;color:var(--text-secondary);">${escapeHtml(translate(lang, "flows.studioSubtitle"))}</p>
        </div>

        <!-- Selector de Sección Independiente Básico / Avanzado -->
        ${buildHeaderModeSwitchHtml()}
      </div>

      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        ${
          !isAdvanced
            ? `<button type="button" class="etp-btn" id="btn-convert-basic-to-advanced" title="Crear un nuevo flujo avanzado independiente a partir de este flujo básico">
                ${escapeHtml(translate(lang, "flows.btnConvertToAdvanced"))}
              </button>`
            : `
              <button type="button" class="etp-btn" id="btn-simulate-flow">
                ${escapeHtml(translate(lang, "flows.btnSimulate"))}
              </button>
              <button type="button" class="etp-btn ${rightVisible ? "active-toggle" : ""}" id="btn-toggle-flows-right-inspector" title="${escapeAttr(translate(lang, "flows.inspectorPanelTooltip"))}">
                🔧 <span>${escapeHtml(translate(lang, "flows.inspectorPanelBtn"))}</span>
              </button>
            `
        }
        ${
          ui.isRunning
            ? `
              <button type="button" class="etp-btn" id="btn-pause-resume-flow">
                ${escapeHtml(ui.isPaused ? translate(lang, "flows.btnResume") : translate(lang, "flows.btnPause"))}
              </button>
              <button type="button" class="etp-btn etp-btn-danger" id="btn-cancel-running-flow">
                ${escapeHtml(translate(lang, "flows.btnCancelRun"))}
              </button>
            `
            : `
              ${
                activeFlow.lastReport?.failedNodeId && isAdvanced
                  ? `<button type="button" class="etp-btn" id="btn-header-retry-failed" style="border-color:var(--status-warning);color:var(--status-warning);">${escapeHtml(translate(lang, "flows.btnRetryFailed"))}</button>`
                  : ""
              }
              <button type="button" class="etp-btn" id="btn-reset-flow-state">${escapeHtml(translate(lang, "flows.btnResetRun"))}</button>
              <button type="button" class="etp-btn etp-btn-success" id="btn-execute-selected-flow">
                ${escapeHtml(translate(lang, "flows.btnExecuteFlow"))} ${!isAdvanced ? `(${orderedStepReqs.length})` : ""}
              </button>
            `
        }
        <button type="button" class="etp-btn" id="btn-back-to-editor-inline">${escapeHtml(translate(lang, "topbar.btnFlowsBack"))}</button>
      </div>
    </header>
    ${bodyModeHtml}
  `;

  attachSectionSwitchHandlers();

  // Convertir flujo básico a un nuevo flujo avanzado independiente (con numeración consecutiva si ya existe el nombre)
  document.getElementById("btn-convert-basic-to-advanced")?.addEventListener("click", () => {
    const newAdvFlow = createIndependentAdvancedFlowFromBasic(
      activeFlow,
      state.customFlows,
      allRequests
    );
    if (!newAdvFlow) return;
    state.customFlows.push(newAdvFlow);
    ui.activeSectionMode = "advanced";
    state.flowsActiveSectionMode = "advanced";
    state.activeFlowId = newAdvFlow.id;
    ui.selectedNodeId = newAdvFlow.graph.nodes[0]?.id || null;
    ui.selectedEdgeId = null;
    persistWorkspaceToLocalStorage(state);
    rerenderFlows();
    showToast(translate(lang, "toasts.convertedFlowCreated", { name: newAdvFlow.name }));
  });

  document.getElementById("btn-execute-selected-flow")?.addEventListener("click", () => {
    runActiveFlowWithOptions({ simulateOnly: false });
  });

  document.getElementById("btn-simulate-flow")?.addEventListener("click", () => {
    runActiveFlowWithOptions({ simulateOnly: true });
  });

  document.getElementById("btn-header-retry-failed")?.addEventListener("click", () => {
    const failedId = activeFlow.lastReport?.failedNodeId;
    if (failedId) {
      runActiveFlowWithOptions({ onlyNodeId: failedId });
    }
  });

  document.getElementById("btn-reset-flow-state")?.addEventListener("click", () => {
    ui.execStatusByNode = {};
    ui.execAttemptByNode = {};
    ui.takenEdgeIds = [];
    ui.focusedErrorNodeId = null;
    ui.focusedErrorEdgeId = null;
    rerenderFlows();
  });

  document.getElementById("btn-pause-resume-flow")?.addEventListener("click", () => {
    if (!ui.activeController) return;
    if (ui.isPaused) {
      ui.activeController.resume();
      ui.isPaused = false;
    } else {
      ui.activeController.pause();
      ui.isPaused = true;
    }
    rerenderFlows();
  });

  document.getElementById("btn-cancel-running-flow")?.addEventListener("click", () => {
    if (ui.activeController) {
      ui.activeController.cancel();
    }
  });

  if (isAdvanced) {
    attachAdvancedFlowCanvasEvents(
      mainContentEl,
      state,
      activeFlow,
      allRequests,
      rerenderFlows,
      runActiveFlowWithOptions
    );
  } else {
    attachBasicFlowModeEvents(mainContentEl, state, activeFlow, rerenderFlows, allRequests);
  }
}
