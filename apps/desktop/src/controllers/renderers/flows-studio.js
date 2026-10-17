/**
 * Renderizador del Estudio y Ejecutor de Flujos de API — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/flows-studio.js
 */
import { translate } from "../../lang/i18n.js";
import { persistWorkspaceToLocalStorage } from "../../services/storage-sync.js";
import { executeSingleRequestObject, localizeResponseForLang } from "../../services/http-client.js";
import { escapeHtml, escapeAttr, showToast, openInputDialog } from "./dom-utils.js";
import { renderResponsePanel } from "./response-panel.js";

export function renderFlowsStudioView(state, renderAll) {
  const sidebarListEl = document.getElementById("flows-sidebar-list");
  const sidebarTitleEl = document.getElementById("lbl-flows-sidebar-title");
  const mainContentEl = document.getElementById("flows-studio-main-content");
  if (!sidebarListEl || !mainContentEl) return;

  if (sidebarTitleEl) {
    sidebarTitleEl.textContent = `${translate(state.lang, "flows.myFlows")} (${state.customFlows.length})`;
  }

  const flowQuery = (state.flowsSearchQuery || "").trim().toLowerCase();
  const visibleFlows = state.customFlows.filter(
    (f) => !flowQuery || (f.name || "").toLowerCase().includes(flowQuery)
  );

  if (visibleFlows.length === 0) {
    sidebarListEl.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px;border:1px dashed var(--border-strong);border-radius:7px;">${escapeHtml(translate(state.lang, "flows.emptyFlowsList"))}</div>`;
  } else {
    sidebarListEl.innerHTML = visibleFlows
      .map((flw) => {
        const isAct = flw.id === state.activeFlowId;
        const safeFlwId = escapeAttr(flw.id);
        return `
          <div class="etp-env-item-card ${isAct ? "active" : ""}" data-select-flow="${safeFlwId}">
            <div style="min-width:0;flex:1;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">⚡ ${escapeHtml(flw.name)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
                <span style="font-size:11px;color:var(--text-muted);">${(flw.selectedRequestIds || []).length} ${escapeHtml(translate(state.lang, "flows.endpointsSelectedSuffix"))}</span>
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
        title: translate(state.lang, "flows.myFlows"),
        label: translate(state.lang, "request.nameLabel"),
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
        <h3 style="font-size:16px;">${escapeHtml(translate(state.lang, "flows.noActiveFlowTitle"))}</h3>
        <p style="font-size:13px;color:var(--text-secondary);max-width:460px;">${escapeHtml(translate(state.lang, "flows.noActiveFlowDesc"))}</p>
        <button type="button" class="etp-btn etp-btn-primary" id="btn-create-flow-empty-cta">${escapeHtml(translate(state.lang, "flows.btnNewFlow"))}</button>
      </div>
    `;
    document.getElementById("btn-create-flow-empty-cta")?.addEventListener("click", () => {
      document.getElementById("btn-create-custom-flow").click();
    });
    return;
  }

  const allRequests = [];
  for (const col of state.collections) {
    for (const r of col.requests || []) {
      allRequests.push({ ...r, collectionName: col.metadata.name });
    }
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

  const noUrlLabel = translate(state.lang, "request.noUrlPlaceholder");

  const catalogCardsHtml = filteredCatalog
    .map((req) => {
      const checked = activeFlow.selectedRequestIds.includes(req.id);
      const safeReqId = escapeAttr(req.id);
      const safeMethod = escapeHtml((req.method || "GET").toUpperCase());
      return `
        <label class="etp-flow-step-card" style="cursor:pointer;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
            <input type="checkbox" data-flow-req-check="${safeReqId}" ${checked ? "checked" : ""} />
            <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
            <div style="min-width:0;flex:1;">
              <div style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(req.name)}</div>
              <div style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📦 ${escapeHtml(req.collectionName)} • ${escapeHtml(req.url || noUrlLabel)}</div>
            </div>
          </div>
        </label>
      `;
    })
    .join("");

  const stepCardsHtml =
    orderedStepReqs.length === 0
      ? `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px;border:1px dashed var(--border-strong);border-radius:7px;">${escapeHtml(translate(state.lang, "flows.emptyStepsHint"))}</div>`
      : orderedStepReqs
          .map((req, idx) => {
            const safeMethod = escapeHtml((req.method || "GET").toUpperCase());
            return `
              <div class="etp-flow-step-card">
                <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1;">
                  <span class="etp-search-badge">#${idx + 1}</span>
                  <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
                  <div style="min-width:0;flex:1;">
                    <div style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(req.name)}</div>
                    <div style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(req.url || noUrlLabel)}</div>
                  </div>
                </div>
                <div class="etp-tree-actions">
                  <button type="button" class="etp-icon-btn" data-step-up="${idx}" title="${escapeAttr(translate(state.lang, "flows.moveUp"))}">↑</button>
                  <button type="button" class="etp-icon-btn" data-step-down="${idx}" title="${escapeAttr(translate(state.lang, "flows.moveDown"))}">↓</button>
                  <button type="button" class="etp-icon-btn danger" data-step-remove="${escapeAttr(req.id)}" title="${escapeAttr(translate(state.lang, "flows.removeStep"))}">✕</button>
                </div>
              </div>
            `;
          })
          .join("");

  let resultsAreaHtml = `
    <div style="padding:28px;text-align:center;color:var(--text-muted);font-size:12.5px;border:1px dashed var(--border-strong);border-radius:7px;">
      ${escapeHtml(translate(state.lang, "flows.noRunYet"))}
    </div>
  `;

  if (activeFlow.lastReport) {
    const stepReportsHtml = activeFlow.lastReport.steps
      .map((s, idx) => {
        const safeMethod = escapeHtml((s.method || "GET").toUpperCase());
        const localizedStep = localizeResponseForLang({ assertionResults: s.assertionResults || [] }, state.lang);
        const assertionsHtml = (localizedStep.assertionResults || [])
          .map((a) => `<div class="${a.passed ? "etp-pass" : "etp-fail"}">${a.passed ? "✓" : "✗"} ${escapeHtml(a.message)}</div>`)
          .join("");
        return `
          <div style="border:1px solid var(--border-strong);border-radius:7px;padding:9px 11px;background:var(--bg-input);">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <div style="min-width:0;flex:1;">
                <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
                <strong style="margin-left:6px;font-size:12px;">${escapeHtml(translate(state.lang, "flows.stepPrefix"))} ${idx + 1}: ${escapeHtml(s.requestName)}</strong>
              </div>
              <span class="${s.passed ? "etp-pass" : "etp-fail"}" style="font-family:var(--font-mono);font-size:11.5px;">HTTP ${Number(s.status) || 0} (${Number(s.durationMs) || 0} ms)</span>
            </div>
            <div style="font-size:11.5px;font-family:var(--font-mono);margin-top:5px;">
              ${assertionsHtml}
            </div>
          </div>
        `;
      })
      .join("");

    resultsAreaHtml = `
      <div class="etp-flow-kpi-grid">
        <div class="etp-flow-kpi-card">
          <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(translate(state.lang, "flows.summaryExecuted"))}</div>
          <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);">${Number(activeFlow.lastReport.totalRequests) || 0}</div>
        </div>
        <div class="etp-flow-kpi-card">
          <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(translate(state.lang, "flows.summaryAssertions"))}</div>
          <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);">${Number(activeFlow.lastReport.passedAssertions) || 0}/${Number(activeFlow.lastReport.totalAssertions) || 0}</div>
        </div>
        <div class="etp-flow-kpi-card">
          <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(translate(state.lang, "flows.summaryDuration"))}</div>
          <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);">${Number(activeFlow.lastReport.totalDurationMs) || 0} ms</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${stepReportsHtml}
      </div>
    `;
  }

  mainContentEl.innerHTML = `
    <header class="etp-flows-header">
      <div>
        <div style="display:flex;align-items:center;gap:8px;">
          <h2 style="font-size:15px;font-weight:700;">⚡ ${escapeHtml(activeFlow.name)}</h2>
        </div>
        <p style="font-size:12px;color:var(--text-secondary);">${escapeHtml(translate(state.lang, "flows.studioSubtitle"))}</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button type="button" class="etp-btn" id="btn-back-to-editor-inline">${escapeHtml(translate(state.lang, "topbar.btnFlowsBack"))}</button>
        <button type="button" class="etp-btn etp-btn-success" id="btn-execute-selected-flow">
          ${escapeHtml(translate(state.lang, "flows.btnExecuteFlow"))} (${orderedStepReqs.length})
        </button>
      </div>
    </header>

    <div class="etp-flows-grid">
      <div class="etp-flows-column">
        <div class="etp-flows-col-header">
          <span>${escapeHtml(translate(state.lang, "flows.availableEndpointsTitle"))}</span>
          <span class="etp-search-badge">${filteredCatalog.length}</span>
        </div>
        <div style="padding:8px 10px;border-bottom:1px solid var(--border-subtle);">
          <div class="etp-response-search-shell">
            <span class="etp-search-icon">🔍</span>
            <input type="search" id="flow-catalog-search" class="etp-response-search-input" value="${escapeAttr(state.flowCatalogSearchQuery || "")}" placeholder="${escapeAttr(translate(state.lang, "flows.searchEndpointsPlaceholder"))}" />
          </div>
        </div>
        <div class="etp-flows-col-body">
          ${catalogCardsHtml}
        </div>
      </div>

      <div class="etp-flows-column">
        <div class="etp-flows-col-header">
          <span>${escapeHtml(translate(state.lang, "flows.selectedStepsTitle"))}</span>
          <span class="etp-search-badge">${orderedStepReqs.length}</span>
        </div>
        <div class="etp-flows-col-body">
          ${stepCardsHtml}
        </div>
      </div>

      <div class="etp-flows-column">
        <div class="etp-flows-col-header">
          <span>${escapeHtml(translate(state.lang, "flows.resultsTitle"))}</span>
          ${
            activeFlow.lastReport
              ? `<span class="etp-status-badge ${activeFlow.lastReport.allPassed ? "status-2xx" : "status-4xx"}" id="flow-summary-badge">${escapeHtml(activeFlow.lastReport.allPassed ? translate(state.lang, "flows.flowSuccess") : translate(state.lang, "flows.flowFailed"))}</span>`
              : ""
          }
        </div>
        <div class="etp-flows-col-body" id="flow-execution-results-area">
          ${resultsAreaHtml}
        </div>
      </div>
    </div>
  `;

  document.getElementById("btn-back-to-editor-inline")?.addEventListener("click", () => {
    state.activeMainView = "workspace";
    persistWorkspaceToLocalStorage(state);
    renderAll();
  });

  document.getElementById("flow-catalog-search")?.addEventListener("input", (e) => {
    state.flowCatalogSearchQuery = e.target.value;
    renderFlowsStudioView(state, renderAll);
  });

  mainContentEl.querySelectorAll("[data-flow-req-check]").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const rId = chk.getAttribute("data-flow-req-check");
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

  mainContentEl.querySelectorAll("[data-step-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-step-up"));
      if (idx <= 0) return;
      const arr = activeFlow.selectedRequestIds;
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  mainContentEl.querySelectorAll("[data-step-down]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-step-down"));
      const arr = activeFlow.selectedRequestIds;
      if (idx >= arr.length - 1) return;
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  mainContentEl.querySelectorAll("[data-step-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rId = btn.getAttribute("data-step-remove");
      activeFlow.selectedRequestIds = activeFlow.selectedRequestIds.filter((id) => id !== rId);
      persistWorkspaceToLocalStorage(state);
      renderFlowsStudioView(state, renderAll);
    });
  });

  document.getElementById("btn-execute-selected-flow")?.addEventListener("click", async () => {
    if (orderedStepReqs.length === 0) {
      showToast(translate(state.lang, "toasts.selectAtLeastOneStep"), "warning");
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
      for (const a of r.assertionResults || []) {
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
