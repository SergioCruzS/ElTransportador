/**
 * Vista de Modo Básico de Flows Studio — ElTransportador v1.2.0
 * Conserva la experiencia lineal (catálogo, orden manual con Drag & Drop + flechas y ejecución secuencial)
 * añadiendo parámetros y variables consumidas exclusivas por paso, aserciones exclusivas, reintentos,
 * apartado de Variables del Flujo y su Valor Actual y soporte de rutas con índices de listas (ej. results[0].name).
 * Archivo: apps/desktop/src/controllers/renderers/flows/flows-basic-view.js
 */
import { translate } from "../../../lang/i18n.js";
import { persistWorkspaceToLocalStorage } from "../../../services/storage-sync.js";
import { localizeResponseForLang, maskSecretsInString, getByDotPath } from "../../../services/http-client.js";
import {
  NODE_TYPES,
  cloneRequestParamsForFlow,
  extractNodeVariableDependencies,
  collectAvailableVariablesForFlow,
  buildFlowVariablesSummaryEntries,
  sanitizeFlowVariablesArray
} from "../../../services/flows/index.js";
import { escapeHtml, escapeAttr, showToast } from "../dom-utils.js";

export function ensureBasicStepOverride(activeFlow, reqId, allRequests = []) {
  activeFlow.stepOverrides =
    activeFlow.stepOverrides && typeof activeFlow.stepOverrides === "object"
      ? activeFlow.stepOverrides
      : {};
  const reqObj = (allRequests || []).find((r) => r.id === reqId);
  if (!activeFlow.stepOverrides[reqId]) {
    activeFlow.stepOverrides[reqId] = {
      useExclusiveAssertions: false,
      params: reqObj ? cloneRequestParamsForFlow(reqObj) : [],
      assertions: [],
      extractions: [],
      retries: 0,
      retryCount: 0,
      retryDelaySec: 1
    };
  } else if (!Array.isArray(activeFlow.stepOverrides[reqId].params)) {
    activeFlow.stepOverrides[reqId].params = reqObj ? cloneRequestParamsForFlow(reqObj) : [];
  }
  return activeFlow.stepOverrides[reqId];
}

function getTargetTranslationKey(t) {
  switch (t) {
    case "status":
      return "flows.targetStatus";
    case "json_path":
      return "flows.targetJsonPath";
    case "header":
      return "flows.targetHeader";
    case "body_text":
      return "flows.targetBodyText";
    case "duration_ms":
      return "flows.targetDuration";
    default:
      return t;
  }
}

function getOperatorTranslationKey(op) {
  switch (op) {
    case "equals":
      return "flows.opEquals";
    case "not_equals":
      return "flows.opNotEquals";
    case "contains":
      return "flows.opContains";
    case "starts_with":
      return "flows.opStartsWith";
    case "ends_with":
      return "flows.opEndsWith";
    case "exists":
      return "flows.opExists";
    case "not_exists":
      return "flows.opNotExists";
    case "less_than":
      return "flows.opLessThan";
    case "greater_than":
      return "flows.opGreaterThan";
    default:
      return op;
  }
}

function getSourceTranslationKey(src) {
  switch (src) {
    case "json_path":
      return "flows.srcJsonPath";
    case "header":
      return "flows.srcHeader";
    case "cookie":
      return "flows.srcCookie";
    case "status":
      return "flows.srcStatus";
    default:
      return src;
  }
}

function getCategoryBadgeLabel(category, lang) {
  switch (category) {
    case "flow_produced":
      return translate(lang, "flows.catProducedBadge");
    case "flow_init":
      return translate(lang, "flows.catInitBadge");
    case "environment":
      return translate(lang, "flows.catEnvBadge");
    case "collection":
      return translate(lang, "flows.catColBadge");
    case "secret":
      return translate(lang, "flows.catSecretBadge");
    default:
      return category;
  }
}

function resolveLiveExtractionPreviewValue(ex, reqId, activeFlow, state) {
  if (!ex || !ex.variableName) return { resolved: false, value: "" };
  const varName = String(ex.variableName).trim();
  const cachedResp = reqId ? state?.responsesByReqId?.[reqId] : null;
  if (cachedResp) {
    const src = ex.source || "json_path";
    if (src === "status" && cachedResp.status !== undefined) {
      return { resolved: true, value: String(cachedResp.status) };
    }
    if (src === "header") {
      const targetKey = String(ex.path || "").toLowerCase();
      for (const [hk, hv] of Object.entries(cachedResp.headers || {})) {
        if (hk.toLowerCase() === targetKey) {
          return { resolved: true, value: maskSecretsInString(String(hv), state) };
        }
      }
    } else if (src === "cookie") {
      const targetCookie = String(ex.path || "").toLowerCase();
      const foundCookie = (cachedResp.cookies || []).find(
        (c) => String(c?.name || "").toLowerCase() === targetCookie
      );
      if (foundCookie) {
        return { resolved: true, value: maskSecretsInString(String(foundCookie.value || ""), state) };
      }
    } else {
      let bodyObj = cachedResp.bodyObj || null;
      if (!bodyObj && typeof cachedResp.body === "string" && cachedResp.body.trim()) {
        try {
          bodyObj = JSON.parse(cachedResp.body);
        } catch {}
      }
      if (bodyObj) {
        const extracted = getByDotPath(bodyObj, ex.path || "");
        if (extracted !== undefined && extracted !== null) {
          const strVal = typeof extracted === "object" ? JSON.stringify(extracted) : String(extracted);
          return { resolved: true, value: maskSecretsInString(strVal, state) };
        }
      }
    }
  }
  if (activeFlow?.lastReport?.finalFlowVariables?.[varName] !== undefined) {
    return {
      resolved: true,
      value: maskSecretsInString(String(activeFlow.lastReport.finalFlowVariables[varName]), state)
    };
  }
  if (state?.runtimeVars?.[varName] !== undefined) {
    return {
      resolved: true,
      value: maskSecretsInString(String(state.runtimeVars[varName]), state)
    };
  }
  if (ex.fallbackValue) {
    return { resolved: true, value: maskSecretsInString(String(ex.fallbackValue), state) };
  }
  return { resolved: false, value: "" };
}

function buildVariableSelectorOptionsHtml(availVars, currentValue, lang) {
  let html = `<option value="">${escapeHtml(translate(lang, "flows.assignVarPlaceholder"))}</option>`;
  const addGroup = (groupLabelKey, keys, isSecret = false) => {
    if (!keys || keys.length === 0) return;
    html += `<optgroup label="${escapeAttr(translate(lang, groupLabelKey))}">`;
    for (const k of keys) {
      const token = isSecret ? `\${secret:${k}}` : `\${${k}}`;
      const isSelected = String(currentValue || "").trim() === token;
      html += `<option value="${escapeAttr(token)}" ${isSelected ? "selected" : ""}>${escapeHtml(token)}</option>`;
    }
    html += `</optgroup>`;
  };
  addGroup("flows.varGroupFlowProduced", availVars.flowProduced, false);
  addGroup("flows.varGroupFlowInit", availVars.flowInit, false);
  addGroup("flows.varGroupEnv", availVars.envVars, false);
  addGroup("flows.varGroupCol", availVars.colVars, false);
  addGroup("flows.varGroupSecrets", availVars.secrets, true);
  return html;
}

export function renderBasicFlowModeHtml(state, activeFlow, allRequests, filteredCatalog, orderedStepReqs) {
  const lang = state.lang || "es";
  const noUrlLabel = translate(lang, "request.noUrlPlaceholder");
  const selectedStepReqId =
    state.flowStudioUi?.basicSelectedStepReqId &&
    activeFlow.selectedRequestIds.includes(state.flowStudioUi.basicSelectedStepReqId)
      ? state.flowStudioUi.basicSelectedStepReqId
      : activeFlow.selectedRequestIds[0] || null;
  if (state.flowStudioUi) {
    state.flowStudioUi.basicSelectedStepReqId = selectedStepReqId;
  }

  const catalogCardsHtml = filteredCatalog
    .map((req) => {
      const checked = activeFlow.selectedRequestIds.includes(req.id);
      const safeReqId = escapeAttr(req.id);
      const safeMethod = escapeHtml((req.method || "GET").toUpperCase());
      return `
        <label class="etp-flow-step-card" style="cursor:pointer;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
            <input type="checkbox" data-flow-req-check="${safeReqId}" ${checked ? "checked" : ""} aria-label="${escapeAttr(req.name)}" />
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
      ? `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px;border:1px dashed var(--border-strong);border-radius:7px;">${escapeHtml(translate(lang, "flows.emptyStepsHint"))}</div>`
      : orderedStepReqs
          .map((req, idx) => {
            const safeMethod = escapeHtml((req.method || "GET").toUpperCase());
            const ov = ensureBasicStepOverride(activeFlow, req.id, allRequests);
            const exclCount = (ov?.assertions || []).length;
            const prmCount = (ov?.params || []).filter((p) => p.enabled !== false && p.key).length;
            const retriesCount = Number(ov?.retries ?? ov?.retryCount) || 0;
            const isSelectedStep = req.id === selectedStepReqId;
            const isFirst = idx === 0;
            const isLast = idx === orderedStepReqs.length - 1;
            return `
              <div
                class="etp-flow-step-card ${isSelectedStep ? "active" : ""}"
                draggable="true"
                data-basic-step-idx="${idx}"
                data-basic-select-step="${escapeAttr(req.id)}"
                style="cursor:grab;${isSelectedStep ? "border-color:var(--accent-primary);background:var(--bg-active);" : ""}"
              >
                <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1;">
                  <span class="etp-drag-handle" title="${escapeAttr(translate(lang, "sidebar.dragHandleTooltip"))}">⋮⋮</span>
                  <span class="etp-search-badge">#${idx + 1}</span>
                  <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
                  <div style="min-width:0;flex:1;">
                    <div style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(req.name)}</div>
                    <div style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                      ${escapeHtml(req.url || noUrlLabel)}
                      ${prmCount > 0 ? ` • <span style="color:var(--accent-secondary);">? ${prmCount}</span>` : ""}
                      ${exclCount > 0 ? ` • <span style="color:var(--accent-primary);">✓ ${exclCount}</span>` : ""}
                      ${retriesCount > 0 ? ` • <span style="color:var(--status-warning);">↻ ${retriesCount}</span>` : ""}
                    </div>
                  </div>
                </div>
                <div class="etp-tree-actions">
                  <button type="button" class="etp-icon-btn" data-step-up="${idx}" ${isFirst ? "disabled style='opacity:0.35;cursor:default;'" : ""} title="${escapeAttr(translate(lang, "flows.moveUp"))}" aria-label="${escapeAttr(translate(lang, "flows.moveUp"))}">↑</button>
                  <button type="button" class="etp-icon-btn" data-step-down="${idx}" ${isLast ? "disabled style='opacity:0.35;cursor:default;'" : ""} title="${escapeAttr(translate(lang, "flows.moveDown"))}" aria-label="${escapeAttr(translate(lang, "flows.moveDown"))}">↓</button>
                  <button type="button" class="etp-icon-btn danger" data-step-remove="${escapeAttr(req.id)}" title="${escapeAttr(translate(lang, "flows.removeStep"))}" aria-label="${escapeAttr(translate(lang, "flows.removeStep"))}">✕</button>
                </div>
              </div>
            `;
          })
          .join("");

  // Panel de configuración de parámetros, variables consumidas, aserciones y reintentos exclusivos del flujo para el paso seleccionado
  let stepExclusiveEditorHtml = "";
  const selectedStepReq = orderedStepReqs.find((r) => r.id === selectedStepReqId);
  if (selectedStepReq) {
    const ov = ensureBasicStepOverride(activeFlow, selectedStepReq.id, allRequests);
    const currentRetries = Number(ov.retries ?? ov.retryCount ?? 0);
    const paramsList = Array.isArray(ov.params) ? ov.params : [];
    const assertionsList = Array.isArray(ov.assertions) ? ov.assertions : [];
    const extractionsList = Array.isArray(ov.extractions) ? ov.extractions : [];
    const availVars = collectAvailableVariablesForFlow(activeFlow, allRequests, state);
    const stepDeps = extractNodeVariableDependencies(
      {
        type: NODE_TYPES.HTTP_REQUEST,
        config: {
          requestId: selectedStepReq.id,
          params: paramsList,
          assertions: assertionsList,
          extractions: extractionsList
        }
      },
      allRequests
    );

    stepExclusiveEditorHtml = `
      <div style="margin-top:8px;padding:10px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg-elevated);display:flex;flex-direction:column;gap:8px;min-width:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
          <strong style="font-size:12px;">⚙ ${escapeHtml(translate(lang, "flows.stepConfigTitle"))}: «${escapeHtml(selectedStepReq.name)}»</strong>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <label style="font-size:11px;color:var(--text-secondary);">${escapeHtml(translate(lang, "flows.stepRetriesLabel"))}</label>
            <select id="basic-step-retries" class="etp-select" style="height:24px;font-size:11px;padding:0 6px;">
              ${[0, 1, 3, 5].map((r) => `<option value="${r}" ${currentRetries === r ? "selected" : ""}>${r}</option>`).join("")}
            </select>
            <label style="font-size:11px;color:var(--text-secondary);">${escapeHtml(translate(lang, "flows.stepRetryDelayLabel"))}</label>
            <input type="number" id="basic-step-retry-delay" class="etp-input" value="${Number(ov.retryDelaySec ?? 1)}" min="0.1" max="60" step="0.5" style="width:58px;height:24px;font-size:11px;padding:0 5px;" />
          </div>
        </div>

        <!-- Sección de Parámetros y Variables Consumidas (Exclusivos del Flujo) -->
        <div style="padding-top:6px;border-top:1px solid var(--border-subtle);display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
            <span style="font-size:11.5px;font-weight:700;color:var(--text-primary);">${escapeHtml(translate(lang, "flows.flowParamsTitle"))} (${paramsList.length})</span>
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
              <button type="button" class="etp-btn-xs" id="btn-basic-reset-flow-params" title="${escapeAttr(translate(lang, "flows.btnResetFlowParamsTooltip"))}">${escapeHtml(translate(lang, "flows.btnResetFlowParamsFromReq"))}</button>
              <button type="button" class="etp-btn-xs" id="btn-basic-add-flow-param">${escapeHtml(translate(lang, "flows.btnAddFlowParam"))}</button>
            </div>
          </div>
          <div style="font-size:10.5px;color:var(--text-secondary);line-height:1.35;">
            ${escapeHtml(translate(lang, "flows.flowParamsSubtitle"))}
          </div>
          ${
            paramsList.length > 0
              ? `<div class="etp-table-scroll-wrap">
                  <table class="etp-kv-table" style="font-size:11px;">
                    <thead>
                      <tr>
                        <th style="width:28px;">${escapeHtml(translate(lang, "flows.colOn"))}</th>
                        <th style="width:105px;">${escapeHtml(translate(lang, "flows.colParamKey"))}</th>
                        <th style="width:130px;">${escapeHtml(translate(lang, "flows.colParamValue"))}</th>
                        <th style="width:140px;">${escapeHtml(translate(lang, "flows.colAssignVar"))}</th>
                        <th style="width:26px;"></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${paramsList
                        .map(
                          (p, pIdx) => `
                        <tr>
                          <td><input type="checkbox" data-basic-prm-toggle="${pIdx}" ${p.enabled !== false ? "checked" : ""} /></td>
                          <td><input class="etp-kv-input" data-basic-prm-key="${pIdx}" value="${escapeAttr(p.key || "")}" placeholder="param_key" /></td>
                          <td><input class="etp-kv-input" data-basic-prm-val="${pIdx}" value="${escapeAttr(p.value || "")}" placeholder="valor o \${var}" /></td>
                          <td>
                            <select class="etp-select" data-basic-prm-varsel="${pIdx}" style="height:24px;font-size:10.5px;width:100%;padding:0 4px;">
                              ${buildVariableSelectorOptionsHtml(availVars, p.value, lang)}
                            </select>
                          </td>
                          <td><button type="button" class="etp-icon-btn danger" data-basic-prm-del="${pIdx}">×</button></td>
                        </tr>
                      `
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>`
              : `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(translate(lang, "flows.emptyFlowParams"))}</div>`
          }
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11px;padding:4px 8px;border-radius:6px;background:var(--bg-panel);border:1px solid var(--border-subtle);">
            <div>
              <strong>⬇ ${escapeHtml(translate(lang, "flows.varsConsumed"))}:</strong>
              ${
                stepDeps.consumedVars.length > 0
                  ? stepDeps.consumedVars.map((v) => `<code>\${${escapeHtml(v)}}</code>`).join(", ")
                  : `<span style="color:var(--text-muted);">${lang === "en" ? "None" : "Ninguna"}</span>`
              }
            </div>
            <div>
              <strong>⬆ ${escapeHtml(translate(lang, "flows.varsProduced"))}:</strong>
              ${
                stepDeps.producedVars.length > 0
                  ? stepDeps.producedVars.map((v) => `<code style="color:var(--accent-secondary);">\${${escapeHtml(v)}}</code>`).join(", ")
                  : `<span style="color:var(--text-muted);">${lang === "en" ? "None" : "Ninguna"}</span>`
              }
            </div>
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border-subtle);gap:6px;flex-wrap:wrap;">
          <label style="font-size:11.5px;display:flex;align-items:center;gap:5px;color:var(--text-secondary);">
            <input type="checkbox" id="basic-step-use-excl-ast" ${ov.useExclusiveAssertions ? "checked" : ""} />
            <span>${escapeHtml(translate(lang, "flows.replaceGlobalAssertions"))}</span>
          </label>
          <button type="button" class="etp-btn-xs" id="btn-basic-add-flow-ast">${escapeHtml(translate(lang, "flows.btnAddFlowAssertion"))}</button>
        </div>

        ${
          assertionsList.length > 0
            ? `<div class="etp-table-scroll-wrap">
                <table class="etp-kv-table" style="font-size:11.5px;">
                  <thead>
                    <tr>
                      <th style="width:30px;">${escapeHtml(translate(lang, "flows.colOn"))}</th>
                      <th style="width:110px;">${escapeHtml(translate(lang, "flows.colTarget"))}</th>
                      <th style="width:110px;">${escapeHtml(translate(lang, "flows.colProperty"))}</th>
                      <th style="width:115px;">${escapeHtml(translate(lang, "flows.colOperator"))}</th>
                      <th style="width:95px;">${escapeHtml(translate(lang, "flows.colExpected"))}</th>
                      <th style="width:28px;"></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${assertionsList
                      .map(
                        (a, aIdx) => `
                      <tr>
                        <td><input type="checkbox" data-basic-ast-toggle="${aIdx}" ${a.enabled !== false ? "checked" : ""} /></td>
                        <td>
                          <select class="etp-select" data-basic-ast-target="${aIdx}" style="height:24px;font-size:11px;width:100%;padding:0 4px;">
                            ${["status", "json_path", "header", "body_text", "duration_ms"]
                              .map((t) => `<option value="${t}" ${a.target === t ? "selected" : ""}>${escapeHtml(translate(lang, getTargetTranslationKey(t)))}</option>`)
                              .join("")}
                          </select>
                        </td>
                        <td><input class="etp-kv-input" data-basic-ast-prop="${aIdx}" value="${escapeAttr(a.property || "")}" placeholder="results[0].name" /></td>
                        <td>
                          <select class="etp-select" data-basic-ast-op="${aIdx}" style="height:24px;font-size:11px;width:100%;padding:0 4px;">
                            ${["equals", "not_equals", "contains", "exists", "not_exists", "less_than", "greater_than"]
                              .map((op) => `<option value="${op}" ${a.operator === op ? "selected" : ""}>${escapeHtml(translate(lang, getOperatorTranslationKey(op)))}</option>`)
                              .join("")}
                          </select>
                        </td>
                        <td><input class="etp-kv-input" data-basic-ast-exp="${aIdx}" value="${escapeAttr(a.expected ?? "")}" placeholder="200" /></td>
                        <td><button type="button" class="etp-icon-btn danger" data-basic-ast-del="${aIdx}">×</button></td>
                      </tr>
                    `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(translate(lang, "flows.emptyFlowAssertions"))}</div>`
        }

        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;gap:6px;flex-wrap:wrap;">
          <span style="font-size:11.5px;font-weight:600;color:var(--text-secondary);">${escapeHtml(translate(lang, "flows.stepExclusiveExtractions"))} (${extractionsList.length})</span>
          <button type="button" class="etp-btn-xs" id="btn-basic-add-flow-ext">${escapeHtml(translate(lang, "flows.btnAddFlowExtraction"))}</button>
        </div>
        <div style="font-size:10.5px;color:var(--text-muted);">
          ${escapeHtml(translate(lang, "flows.jsonPathArrayHint"))}
        </div>
        ${
          extractionsList.length > 0
            ? `<div class="etp-table-scroll-wrap">
                <table class="etp-kv-table" style="font-size:11.5px;">
                  <thead>
                    <tr>
                      <th style="width:28px;">${escapeHtml(translate(lang, "flows.colOn"))}</th>
                      <th style="width:95px;">${escapeHtml(translate(lang, "flows.colVariable"))}</th>
                      <th style="width:105px;">${escapeHtml(translate(lang, "flows.colSource"))}</th>
                      <th style="width:115px;">${escapeHtml(translate(lang, "flows.colPath"))}</th>
                      <th style="width:95px;">${escapeHtml(translate(lang, "flows.colVarCurrentVal"))}</th>
                      <th style="width:85px;">${escapeHtml(translate(lang, "flows.colFallback"))}</th>
                      <th style="width:26px;"></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${extractionsList
                      .map((ex, eIdx) => {
                        const livePreview = resolveLiveExtractionPreviewValue(ex, selectedStepReq.id, activeFlow, state);
                        return `
                      <tr>
                        <td><input type="checkbox" data-basic-ext-toggle="${eIdx}" ${ex.enabled !== false ? "checked" : ""} /></td>
                        <td><input class="etp-kv-input" data-basic-ext-var="${eIdx}" value="${escapeAttr(ex.variableName || "")}" placeholder="flow_var" /></td>
                        <td>
                          <select class="etp-select" data-basic-ext-src="${eIdx}" style="height:24px;font-size:11px;width:100%;padding:0 4px;">
                            ${["json_path", "header", "cookie", "status"]
                              .map((s) => `<option value="${s}" ${ex.source === s ? "selected" : ""}>${escapeHtml(translate(lang, getSourceTranslationKey(s)))}</option>`)
                              .join("")}
                          </select>
                        </td>
                        <td><input class="etp-kv-input" data-basic-ext-path="${eIdx}" value="${escapeAttr(ex.path || "")}" placeholder="results[0].name" /></td>
                        <td style="font-family:var(--font-mono);font-size:11px;color:${livePreview.resolved ? "var(--accent-secondary)" : "var(--text-muted)"};" data-basic-ext-live-val="${eIdx}">
                          ${livePreview.resolved ? escapeHtml(livePreview.value) : escapeHtml(translate(lang, "flows.varPendingExecution"))}
                        </td>
                        <td><input class="etp-kv-input" data-basic-ext-fb="${eIdx}" value="${escapeAttr(ex.fallbackValue || "")}" placeholder="default" /></td>
                        <td><button type="button" class="etp-icon-btn danger" data-basic-ext-del="${eIdx}">×</button></td>
                      </tr>
                    `;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : ""
        }
      </div>
    `;
  }

  // Apartado para ver las variables del flujo y su valor actual (incluyendo variables iniciales del flujo editables)
  activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
  const initFlowVars = activeFlow.flowVariables;
  const summaryVarEntries = buildFlowVariablesSummaryEntries(activeFlow, allRequests, state);

  const flowVariablesPanelHtml = `
    <div class="etp-side-card" id="basic-flow-variables-panel" style="margin-bottom:10px;">
      <div class="etp-side-card-title">
        <span>${escapeHtml(translate(lang, "flows.flowVariablesOverviewTitle"))} (${summaryVarEntries.length})</span>
        <button type="button" class="etp-btn-xs" id="btn-basic-add-init-var">${escapeHtml(translate(lang, "flows.btnAddFlowVar"))}</button>
      </div>
      <div style="font-size:11px;color:var(--text-secondary);line-height:1.35;">
        ${escapeHtml(translate(lang, "flows.flowVariablesOverviewDesc"))}
      </div>
      ${
        initFlowVars.length > 0
          ? `<div style="margin-top:4px;">
              <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;">⚙ ${escapeHtml(translate(lang, "flows.initialFlowVarsTitle"))} (${initFlowVars.length})</div>
              <div class="etp-table-scroll-wrap">
                <table class="etp-kv-table" style="font-size:11px;">
                  <thead>
                    <tr>
                      <th style="width:26px;">${escapeHtml(translate(lang, "flows.colOn"))}</th>
                      <th>${escapeHtml(translate(lang, "environments.colKey"))}</th>
                      <th>${escapeHtml(translate(lang, "environments.colValue"))}</th>
                      <th style="width:32px;">🔒</th>
                      <th style="width:24px;"></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${initFlowVars
                      .map(
                        (fv, idx) => `
                      <tr>
                        <td><input type="checkbox" data-basic-fvar-on="${idx}" ${fv.enabled !== false ? "checked" : ""} /></td>
                        <td><input class="etp-kv-input" data-basic-fvar-key="${idx}" value="${escapeAttr(fv.key || "")}" /></td>
                        <td>
                          ${
                            fv.isSecret
                              ? `<input type="password" class="etp-kv-input" data-basic-fvar-val="${idx}" value="${escapeAttr(fv.value || "")}" placeholder="${escapeAttr(translate(lang, "flows.secretActiveMask"))}" />`
                              : `<input class="etp-kv-input" data-basic-fvar-val="${idx}" value="${escapeAttr(maskSecretsInString(fv.value || "", state))}" />`
                          }
                        </td>
                        <td><input type="checkbox" data-basic-fvar-sec="${idx}" ${fv.isSecret ? "checked" : ""} /></td>
                        <td><button type="button" class="etp-icon-btn danger" data-basic-fvar-del="${idx}">×</button></td>
                      </tr>
                    `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>`
          : ""
      }
      ${
        summaryVarEntries.length > 0
          ? `<div class="etp-table-scroll-wrap" style="margin-top:4px;">
              <table class="etp-kv-table" id="flow-variables-summary-table" style="font-size:11px;">
                <thead>
                  <tr>
                    <th style="width:145px;">${escapeHtml(translate(lang, "flows.colVarName"))}</th>
                    <th style="width:165px;">${escapeHtml(translate(lang, "flows.colVarOrigin"))}</th>
                    <th>${escapeHtml(translate(lang, "flows.colVarCurrentVal"))}</th>
                  </tr>
                </thead>
                <tbody>
                  ${summaryVarEntries
                    .map(
                      (entry) => `
                    <tr data-flow-var-summary-row="${escapeAttr(entry.name)}">
                      <td style="font-family:var(--font-mono);font-weight:600;">
                        <div><code>${escapeHtml(entry.token)}</code></div>
                        <span class="etp-search-badge" style="font-size:9.5px;margin-top:2px;display:inline-block;">${escapeHtml(getCategoryBadgeLabel(entry.category, lang))}</span>
                      </td>
                      <td style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-secondary);">
                        ${escapeHtml(entry.sourceLabel || "—")}
                      </td>
                      <td style="font-family:var(--font-mono);font-weight:600;color:${entry.isSecret ? "var(--text-muted)" : entry.isResolved ? "var(--accent-secondary)" : "var(--status-warning)"};" data-flow-var-summary-val="${escapeAttr(entry.name)}">
                        ${
                          entry.isSecret
                            ? `<span class="etp-secret-locked-mask">${escapeHtml(entry.value)}</span>`
                            : entry.isResolved
                            ? escapeHtml(entry.value)
                            : escapeHtml(translate(lang, "flows.varPendingExecution"))
                        }
                      </td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
          : `<div style="font-size:11px;color:var(--text-muted);padding:6px 2px;">${escapeHtml(translate(lang, "flows.emptyFlowVariablesOverview"))}</div>`
      }
    </div>
  `;

  let resultsAreaHtml = `
    <div style="padding:28px;text-align:center;color:var(--text-muted);font-size:12.5px;border:1px dashed var(--border-strong);border-radius:7px;">
      ${escapeHtml(translate(lang, "flows.noRunYet"))}
    </div>
  `;

  if (activeFlow.lastReport && Array.isArray(activeFlow.lastReport.steps)) {
    const stepReportsHtml = activeFlow.lastReport.steps
      .map((s, idx) => {
        const safeMethod = escapeHtml((s.method || "GET").toUpperCase());
        const localizedStep = localizeResponseForLang({ assertionResults: s.assertionResults || [] }, lang);
        const assertionsHtml = (localizedStep.assertionResults || [])
          .map((a) => `<div class="${a.passed ? "etp-pass" : "etp-fail"}">${a.passed ? "✓" : "✗"} ${escapeHtml(a.message)}</div>`)
          .join("");
        const extractedEntries = Object.entries(s.extractedVariables || {});
        const extractedHtml =
          extractedEntries.length > 0
            ? `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--border-subtle);font-size:11px;color:var(--accent-secondary);">
                <strong>${escapeHtml(translate(lang, "flows.varsProduced"))}:</strong> ${extractedEntries
                  .map(([k, v]) => `<code>${escapeHtml(k)}=${escapeHtml(maskSecretsInString(String(v), state))}</code>`)
                  .join(", ")}
              </div>`
            : "";
        const attemptsVal = s.attempts || s.attemptsUsed || 1;
        const retryBadge =
          attemptsVal > 1
            ? `<span class="etp-search-badge" style="color:var(--status-warning);">↻ ${attemptsVal}/${s.maxAttempts || attemptsVal}</span>`
            : "";
        const errBanner =
          !s.passed && s.failureReason
            ? `<div style="margin-top:4px;color:var(--status-danger);font-size:11px;">✗ ${escapeHtml(s.failureReason)}</div>`
            : "";
        return `
          <div style="border:1px solid ${s.passed ? "var(--border-strong)" : "var(--status-danger)"};border-radius:7px;padding:9px 11px;background:var(--bg-input);">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
              <div style="min-width:0;flex:1;">
                <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
                <strong style="margin-left:6px;font-size:12px;">${escapeHtml(translate(lang, "flows.stepPrefix"))} ${idx + 1}: ${escapeHtml(s.requestName || s.nodeLabel || "Paso")}</strong>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                ${retryBadge}
                <span class="${s.passed ? "etp-pass" : "etp-fail"}" style="font-family:var(--font-mono);font-size:11.5px;">HTTP ${Number(s.status) || 0} (${Number(s.durationMs) || 0} ms)</span>
              </div>
            </div>
            <div style="font-size:11.5px;font-family:var(--font-mono);margin-top:5px;">
              ${errBanner}
              ${assertionsHtml}
              ${extractedHtml}
            </div>
          </div>
        `;
      })
      .join("");

    resultsAreaHtml = `
      <div class="etp-flow-kpi-grid">
        <div class="etp-flow-kpi-card">
          <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(translate(lang, "flows.summaryExecuted"))}</div>
          <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);">${Number(activeFlow.lastReport.totalRequests) || 0}</div>
        </div>
        <div class="etp-flow-kpi-card">
          <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(translate(lang, "flows.summaryAssertions"))}</div>
          <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);">${Number(activeFlow.lastReport.passedAssertions) || 0}/${Number(activeFlow.lastReport.totalAssertions) || 0}</div>
        </div>
        <div class="etp-flow-kpi-card">
          <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(translate(lang, "flows.summaryDuration"))}</div>
          <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);">${Number(activeFlow.lastReport.totalDurationMs) || 0} ms</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${stepReportsHtml}
      </div>
    `;
  }

  return `
    <div class="etp-flows-grid">
      <div class="etp-flows-column">
        <div class="etp-flows-col-header">
          <span>${escapeHtml(translate(lang, "flows.availableEndpointsTitle"))}</span>
          <span class="etp-search-badge">${filteredCatalog.length}</span>
        </div>
        <div style="padding:8px 10px;border-bottom:1px solid var(--border-subtle);">
          <div class="etp-response-search-shell">
            <span class="etp-search-icon">🔍</span>
            <input type="search" id="flow-catalog-search" class="etp-response-search-input" value="${escapeAttr(state.flowCatalogSearchQuery || "")}" placeholder="${escapeAttr(translate(lang, "flows.searchEndpointsPlaceholder"))}" />
          </div>
        </div>
        <div class="etp-flows-col-body">
          ${catalogCardsHtml}
        </div>
      </div>

      <div class="etp-flows-column">
        <div class="etp-flows-col-header">
          <span>${escapeHtml(translate(lang, "flows.selectedStepsTitle"))}</span>
          <span class="etp-search-badge">${orderedStepReqs.length}</span>
        </div>
        <div class="etp-flows-col-body" id="basic-steps-sequence-list">
          ${stepCardsHtml}
          ${stepExclusiveEditorHtml}
        </div>
      </div>

      <div class="etp-flows-column">
        <div class="etp-flows-col-header">
          <span>${escapeHtml(translate(lang, "flows.resultsTitle"))}</span>
          ${
            activeFlow.lastReport
              ? `<span class="etp-status-badge ${activeFlow.lastReport.allPassed ? "status-2xx" : "status-4xx"}" id="flow-summary-badge">${escapeHtml(activeFlow.lastReport.allPassed ? translate(lang, "flows.flowSuccess") : translate(lang, "flows.flowFailed"))}</span>`
              : ""
          }
        </div>
        <div class="etp-flows-col-body" id="flow-execution-results-area">
          ${flowVariablesPanelHtml}
          ${resultsAreaHtml}
        </div>
      </div>
    </div>
  `;
}

let draggedBasicStepIdx = null;

export function attachBasicFlowModeEvents(mainContentEl, state, activeFlow, rerenderFlows, allRequests = []) {
  const lang = state.lang || "es";
  if (!Array.isArray(allRequests) || allRequests.length === 0) {
    allRequests = [];
    for (const col of state.collections || []) {
      for (const r of col.requests || []) {
        allRequests.push({ ...r, collectionName: col.metadata?.name || "Collection" });
      }
    }
  }

  document.getElementById("flow-catalog-search")?.addEventListener("input", (e) => {
    state.flowCatalogSearchQuery = e.target.value;
    rerenderFlows();
  });

  // Eventos de Variables Iniciales del Flujo en Modo Básico
  document.getElementById("btn-basic-add-init-var")?.addEventListener("click", () => {
    activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
    const nextIdx = activeFlow.flowVariables.length + 1;
    activeFlow.flowVariables.push({
      id: `fvar_${Date.now()}_${nextIdx}`,
      key: `flow_var_${nextIdx}`,
      value: "valor",
      enabled: true,
      isSecret: false
    });
    persistWorkspaceToLocalStorage(state);
    rerenderFlows();
  });

  mainContentEl.querySelectorAll("[data-basic-fvar-on]").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const idx = Number(chk.getAttribute("data-basic-fvar-on"));
      activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
      if (activeFlow.flowVariables[idx]) {
        activeFlow.flowVariables[idx].enabled = e.target.checked;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      }
    });
  });

  mainContentEl.querySelectorAll("[data-basic-fvar-key]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = Number(inp.getAttribute("data-basic-fvar-key"));
      activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
      if (activeFlow.flowVariables[idx]) {
        activeFlow.flowVariables[idx].key = e.target.value;
        persistWorkspaceToLocalStorage(state);
      }
    });
    inp.addEventListener("change", () => rerenderFlows());
  });

  mainContentEl.querySelectorAll("[data-basic-fvar-val]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = Number(inp.getAttribute("data-basic-fvar-val"));
      activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
      if (activeFlow.flowVariables[idx]) {
        activeFlow.flowVariables[idx].value = e.target.value;
        persistWorkspaceToLocalStorage(state);
      }
    });
    inp.addEventListener("change", () => rerenderFlows());
  });

  mainContentEl.querySelectorAll("[data-basic-fvar-sec]").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const idx = Number(chk.getAttribute("data-basic-fvar-sec"));
      activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
      if (activeFlow.flowVariables[idx]) {
        activeFlow.flowVariables[idx].isSecret = e.target.checked;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      }
    });
  });

  mainContentEl.querySelectorAll("[data-basic-fvar-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-basic-fvar-del"));
      activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
      activeFlow.flowVariables.splice(idx, 1);
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });
  });

  mainContentEl.querySelectorAll("[data-flow-req-check]").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const rId = chk.getAttribute("data-flow-req-check");
      if (e.target.checked) {
        if (!activeFlow.selectedRequestIds.includes(rId)) {
          activeFlow.selectedRequestIds.push(rId);
          ensureBasicStepOverride(activeFlow, rId, allRequests);
          state.flowStudioUi.basicSelectedStepReqId = rId;
        }
      } else {
        activeFlow.selectedRequestIds = activeFlow.selectedRequestIds.filter((id) => id !== rId);
      }
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });
  });

  // Selección y Drag & Drop para reordenar pasos en la secuencia básica
  mainContentEl.querySelectorAll("[data-basic-select-step]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      state.flowStudioUi.basicSelectedStepReqId = card.getAttribute("data-basic-select-step");
      rerenderFlows();
    });

    card.addEventListener("dragstart", (e) => {
      draggedBasicStepIdx = Number(card.getAttribute("data-basic-step-idx"));
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(draggedBasicStepIdx));
      }
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.add("drag-over");
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over");
    });

    card.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("drag-over");
      const targetIdx = Number(card.getAttribute("data-basic-step-idx"));
      let sourceIdx = draggedBasicStepIdx;
      if ((sourceIdx === null || Number.isNaN(sourceIdx)) && e.dataTransfer) {
        sourceIdx = Number(e.dataTransfer.getData("text/plain"));
      }
      draggedBasicStepIdx = null;
      if (
        Number.isNaN(sourceIdx) ||
        Number.isNaN(targetIdx) ||
        sourceIdx === targetIdx ||
        sourceIdx < 0 ||
        targetIdx < 0 ||
        sourceIdx >= activeFlow.selectedRequestIds.length ||
        targetIdx >= activeFlow.selectedRequestIds.length
      ) {
        return;
      }
      const arr = activeFlow.selectedRequestIds.slice();
      const [movedId] = arr.splice(sourceIdx, 1);
      arr.splice(targetIdx, 0, movedId);
      activeFlow.selectedRequestIds = arr;
      state.flowStudioUi.basicSelectedStepReqId = movedId;
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });
  });

  // Reordenamiento con botones de flecha ↑ y ↓
  mainContentEl.querySelectorAll("[data-step-up]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(btn.getAttribute("data-step-up"));
      if (Number.isNaN(idx) || idx <= 0) return;
      const arr = activeFlow.selectedRequestIds.slice();
      const temp = arr[idx - 1];
      arr[idx - 1] = arr[idx];
      arr[idx] = temp;
      activeFlow.selectedRequestIds = arr;
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });
  });

  mainContentEl.querySelectorAll("[data-step-down]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(btn.getAttribute("data-step-down"));
      const arr = activeFlow.selectedRequestIds.slice();
      if (Number.isNaN(idx) || idx < 0 || idx >= arr.length - 1) return;
      const temp = arr[idx + 1];
      arr[idx + 1] = arr[idx];
      arr[idx] = temp;
      activeFlow.selectedRequestIds = arr;
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });
  });

  mainContentEl.querySelectorAll("[data-step-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rId = btn.getAttribute("data-step-remove");
      activeFlow.selectedRequestIds = activeFlow.selectedRequestIds.filter((id) => id !== rId);
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });
  });

  const selReqId = state.flowStudioUi?.basicSelectedStepReqId;
  if (selReqId && activeFlow.selectedRequestIds.includes(selReqId)) {
    const ov = ensureBasicStepOverride(activeFlow, selReqId, allRequests);

    document.getElementById("basic-step-retries")?.addEventListener("change", (e) => {
      const val = Number(e.target.value);
      const cleanRetries = [0, 1, 3, 5].includes(val) ? val : 0;
      ov.retries = cleanRetries;
      ov.retryCount = cleanRetries;
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });

    document.getElementById("basic-step-retry-delay")?.addEventListener("input", (e) => {
      ov.retryDelaySec = Math.min(60, Math.max(0.1, Number(e.target.value) || 1));
      persistWorkspaceToLocalStorage(state);
    });

    // Eventos de Parámetros y Variables Consumidas (exclusivos del flujo)
    document.getElementById("btn-basic-add-flow-param")?.addEventListener("click", () => {
      ov.params = Array.isArray(ov.params) ? ov.params : [];
      ov.params.push({
        id: "flw_prm_" + Date.now(),
        enabled: true,
        key: "",
        value: "",
        description: "",
        isSecret: false
      });
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });

    document.getElementById("btn-basic-reset-flow-params")?.addEventListener("click", () => {
      const origReq = allRequests.find((r) => r.id === selReqId);
      ov.params = origReq ? cloneRequestParamsForFlow(origReq) : [];
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
      showToast(translate(lang, "toasts.flowParamsReset"));
    });

    mainContentEl.querySelectorAll("[data-basic-prm-toggle]").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        const idx = Number(chk.getAttribute("data-basic-prm-toggle"));
        if (ov.params?.[idx]) ov.params[idx].enabled = e.target.checked;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });

    mainContentEl.querySelectorAll("[data-basic-prm-key]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const idx = Number(inp.getAttribute("data-basic-prm-key"));
        if (ov.params?.[idx]) ov.params[idx].key = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });

    mainContentEl.querySelectorAll("[data-basic-prm-val]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const idx = Number(inp.getAttribute("data-basic-prm-val"));
        if (ov.params?.[idx]) ov.params[idx].value = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
      inp.addEventListener("change", () => {
        rerenderFlows();
      });
    });

    mainContentEl.querySelectorAll("[data-basic-prm-varsel]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const idx = Number(sel.getAttribute("data-basic-prm-varsel"));
        const chosenToken = e.target.value;
        if (chosenToken && ov.params?.[idx]) {
          ov.params[idx].value = chosenToken;
          persistWorkspaceToLocalStorage(state);
          rerenderFlows();
        }
      });
    });

    mainContentEl.querySelectorAll("[data-basic-prm-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-basic-prm-del"));
        ov.params?.splice(idx, 1);
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });

    document.getElementById("basic-step-use-excl-ast")?.addEventListener("change", (e) => {
      ov.useExclusiveAssertions = Boolean(e.target.checked);
      persistWorkspaceToLocalStorage(state);
    });

    document.getElementById("btn-basic-add-flow-ast")?.addEventListener("click", () => {
      ov.assertions = Array.isArray(ov.assertions) ? ov.assertions : [];
      ov.assertions.push({
        id: "flw_ast_" + Date.now(),
        enabled: true,
        target: "status",
        property: "",
        operator: "equals",
        expected: "200"
      });
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });

    mainContentEl.querySelectorAll("[data-basic-ast-toggle]").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        const idx = Number(chk.getAttribute("data-basic-ast-toggle"));
        if (ov.assertions[idx]) ov.assertions[idx].enabled = e.target.checked;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-basic-ast-target]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const idx = Number(sel.getAttribute("data-basic-ast-target"));
        if (ov.assertions[idx]) ov.assertions[idx].target = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-basic-ast-prop]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const idx = Number(inp.getAttribute("data-basic-ast-prop"));
        if (ov.assertions[idx]) ov.assertions[idx].property = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-basic-ast-op]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const idx = Number(sel.getAttribute("data-basic-ast-op"));
        if (ov.assertions[idx]) ov.assertions[idx].operator = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-basic-ast-exp]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const idx = Number(inp.getAttribute("data-basic-ast-exp"));
        if (ov.assertions[idx]) ov.assertions[idx].expected = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-basic-ast-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-basic-ast-del"));
        ov.assertions.splice(idx, 1);
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });

    document.getElementById("btn-basic-add-flow-ext")?.addEventListener("click", () => {
      ov.extractions = Array.isArray(ov.extractions) ? ov.extractions : [];
      ov.extractions.push({
        id: "flw_ext_" + Date.now(),
        enabled: true,
        variableName: "flow_var",
        source: "json_path",
        path: "results[0].name",
        scope: "flow",
        fallbackValue: ""
      });
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });

    mainContentEl.querySelectorAll("[data-basic-ext-toggle]").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        const idx = Number(chk.getAttribute("data-basic-ext-toggle"));
        if (ov.extractions[idx]) ov.extractions[idx].enabled = e.target.checked;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });
    mainContentEl.querySelectorAll("[data-basic-ext-var]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const idx = Number(inp.getAttribute("data-basic-ext-var"));
        if (ov.extractions[idx]) ov.extractions[idx].variableName = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
      inp.addEventListener("change", () => rerenderFlows());
    });
    mainContentEl.querySelectorAll("[data-basic-ext-src]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const idx = Number(sel.getAttribute("data-basic-ext-src"));
        if (ov.extractions[idx]) ov.extractions[idx].source = e.target.value;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });
    mainContentEl.querySelectorAll("[data-basic-ext-path]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const idx = Number(inp.getAttribute("data-basic-ext-path"));
        if (ov.extractions[idx]) {
          ov.extractions[idx].path = e.target.value;
          const liveCell = mainContentEl.querySelector(`[data-basic-ext-live-val="${idx}"]`);
          if (liveCell) {
            const livePreview = resolveLiveExtractionPreviewValue(ov.extractions[idx], selReqId, activeFlow, state);
            liveCell.textContent = livePreview.resolved
              ? livePreview.value
              : translate(lang, "flows.varPendingExecution");
            liveCell.style.color = livePreview.resolved ? "var(--accent-secondary)" : "var(--text-muted)";
          }
        }
        persistWorkspaceToLocalStorage(state);
      });
      inp.addEventListener("change", () => rerenderFlows());
    });
    mainContentEl.querySelectorAll("[data-basic-ext-fb]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const idx = Number(inp.getAttribute("data-basic-ext-fb"));
        if (ov.extractions[idx]) ov.extractions[idx].fallbackValue = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
      inp.addEventListener("change", () => rerenderFlows());
    });
    mainContentEl.querySelectorAll("[data-basic-ext-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-basic-ext-del"));
        ov.extractions.splice(idx, 1);
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });
  }
}
