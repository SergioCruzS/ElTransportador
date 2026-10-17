import { translate } from "../../../lang/i18n.js";
import { persistWorkspaceToLocalStorage } from "../../../services/storage/index.js";
import { maskSecretsInString, getByDotPath } from "../../../services/http/index.js";
import {
  NODE_TYPES,
  pushFlowHistorySnapshot,
  cloneRequestParamsForFlow,
  extractNodeVariableDependencies,
  collectAvailableVariablesForFlow,
  buildFlowVariablesSummaryEntries,
  validateFlowGraph,
  compareFlowExecutions,
  exportSanitizedFlowReport,
  sanitizeFlowVariablesArray
} from "../../../services/flows/index.js";
import { escapeHtml, escapeAttr, showToast } from "../dom-utils.js";

function flattenJsonPathsForVisualCapture(obj, prefix = "", out = [], depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 5 || out.length >= 60) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const pathKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      flattenJsonPathsForVisualCapture(v, pathKey, out, depth + 1);
    } else if (Array.isArray(v)) {
      out.push({ path: `${pathKey}.length`, preview: String(v.length) });
      const sampleCount = Math.min(v.length, 3);
      for (let i = 0; i < sampleCount; i++) {
        if (typeof v[i] === "object" && v[i] !== null) {
          flattenJsonPathsForVisualCapture(v[i], `${pathKey}[${i}]`, out, depth + 1);
        } else {
          out.push({ path: `${pathKey}[${i}]`, preview: String(v[i]).slice(0, 40) });
        }
      }
    } else {
      out.push({ path: pathKey, preview: String(v ?? "null").slice(0, 50) });
    }
  }
  return out;
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

function resolveLiveNodeExtractionPreviewValue(ex, reqId, activeFlow, state) {
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

function buildFlowVariablesSummaryCardHtml(activeFlow, allRequests, state, lang) {
  const summaryVarEntries = buildFlowVariablesSummaryEntries(activeFlow, allRequests, state);
  return `
    <div class="etp-side-card" id="advanced-flow-variables-card">
      <div class="etp-side-card-title">
        <span>${escapeHtml(translate(lang, "flows.flowVariablesOverviewTitle"))} (${summaryVarEntries.length})</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary);line-height:1.35;">
        ${escapeHtml(translate(lang, "flows.flowVariablesOverviewDesc"))}
      </div>
      ${
        summaryVarEntries.length > 0
          ? `<div class="etp-table-scroll-wrap" style="margin-top:4px;">
              <table class="etp-kv-table" id="adv-flow-variables-summary-table" style="font-size:11px;">
                <thead>
                  <tr>
                    <th style="width:130px;">${escapeHtml(translate(lang, "flows.colVarName"))}</th>
                    <th style="width:140px;">${escapeHtml(translate(lang, "flows.colVarOrigin"))}</th>
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
}

function buildInspectorVarOptionsHtml(availVars, currentValue, lang) {
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

export function renderFlowInspectorHtml(state, activeFlow, allRequests) {
  const lang = state.lang || "es";
  const ui = state.flowStudioUi || {};
  const tab = ui.inspectorTab || "node";
  const graph = activeFlow.graph || { nodes: [], edges: [], settings: {} };
  const selectedNode = graph.nodes.find((n) => n.id === ui.selectedNodeId) || null;
  const selectedEdge = graph.edges.find((e) => e.id === ui.selectedEdgeId) || null;
  const validation = validateFlowGraph(activeFlow, allRequests, state);

  const policyOptions = [
    { value: "follow_port", label: translate(lang, "flows.policyFollowPort") },
    { value: "continue_default", label: translate(lang, "flows.policyContinueDefault") },
    { value: "stop_flow", label: translate(lang, "flows.policyStopFlow") },
    { value: "goto_error_node", label: translate(lang, "flows.policyGotoError") }
  ];

  const assertionTargets = [
    { value: "status", label: translate(lang, "flows.targetStatus") },
    { value: "json_path", label: translate(lang, "flows.targetJsonPath") },
    { value: "header", label: translate(lang, "flows.targetHeader") },
    { value: "body_text", label: translate(lang, "flows.targetBodyText") },
    { value: "duration_ms", label: translate(lang, "flows.targetDuration") }
  ];

  const assertionOperators = [
    { value: "equals", label: translate(lang, "flows.opEquals") },
    { value: "not_equals", label: translate(lang, "flows.opNotEquals") },
    { value: "contains", label: translate(lang, "flows.opContains") },
    { value: "exists", label: translate(lang, "flows.opExists") },
    { value: "not_exists", label: translate(lang, "flows.opNotExists") },
    { value: "less_than", label: translate(lang, "flows.opLessThan") },
    { value: "greater_than", label: translate(lang, "flows.opGreaterThan") }
  ];

  const conditionOperators = [
    ...assertionOperators,
    { value: "starts_with", label: translate(lang, "flows.opStartsWith") },
    { value: "ends_with", label: translate(lang, "flows.opEndsWith") }
  ];

  const extractionSources = [
    { value: "json_path", label: translate(lang, "flows.srcJsonPath") },
    { value: "header", label: translate(lang, "flows.srcHeader") },
    { value: "cookie", label: translate(lang, "flows.srcCookie") },
    { value: "status", label: translate(lang, "flows.srcStatus") }
  ];

  let bodyHtml = "";

  if (tab === "node") {
    if (selectedNode) {
      const cfg = selectedNode.config || (selectedNode.config = {});
      if (selectedNode.type === NODE_TYPES.HTTP_REQUEST && !Array.isArray(cfg.params)) {
        const assocReq = allRequests.find((r) => r.id === cfg.requestId);
        cfg.params = assocReq ? cloneRequestParamsForFlow(assocReq) : [];
      }
      const deps = extractNodeVariableDependencies(selectedNode, allRequests);
      const secretKeys = Object.keys(state.secretVault || {});

      bodyHtml += `
        <div class="etp-side-card">
          <div class="etp-side-card-title">
            <span>🔧 ${lang === "en" ? "Node" : "Nodo"}: ${escapeHtml(selectedNode.label)} (<code>${escapeHtml(selectedNode.type)}</code>)</span>
            <div style="display:flex;gap:4px;">
              <button type="button" class="etp-btn-xs" id="btn-run-from-this-node" title="${escapeAttr(translate(lang, "flows.btnRunFromNode"))}">▶ ${lang === "en" ? "From here" : "Desde aquí"}</button>
              ${selectedNode.type !== NODE_TYPES.START ? `<button type="button" class="etp-btn-xs" id="btn-delete-selected-node" style="color:var(--status-danger);" title="${escapeAttr(translate(lang, "flows.nodeDeleteTooltip"))}">🗑</button>` : ""}
            </div>
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.nodeLabelField"))}</label>
            <input type="text" id="insp-node-label" class="etp-input" value="${escapeAttr(selectedNode.label || "")}" />
          </div>
      `;

      if (selectedNode.type === NODE_TYPES.HTTP_REQUEST) {
        const paramsList = Array.isArray(cfg.params) ? cfg.params : [];
        const assertions = Array.isArray(cfg.assertions) ? cfg.assertions : [];
        const extractions = Array.isArray(cfg.extractions) ? cfg.extractions : [];
        const availVars = collectAvailableVariablesForFlow(activeFlow, allRequests, state);
        const endpointSearchQuery = String(ui.endpointSearchQuery || "").trim().toLowerCase();
        const filteredEndpoints = allRequests.filter((r) => {
          if (r.id === cfg.requestId) return true;
          if (!endpointSearchQuery) return true;
          return (
            (r.name || "").toLowerCase().includes(endpointSearchQuery) ||
            (r.method || "").toLowerCase().includes(endpointSearchQuery) ||
            (r.collectionName || "").toLowerCase().includes(endpointSearchQuery) ||
            (r.url || "").toLowerCase().includes(endpointSearchQuery)
          );
        });
        const currentHttpPolicy = cfg.policies?.onHttpError || cfg.onHttpError || "follow_port";
        const currentAstPolicy = cfg.policies?.onAssertionFailure || cfg.onAssertionFailure || "follow_port";
        const currentRetries = Number(cfg.retries ?? cfg.retryCount) || 0;

        bodyHtml += `
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.associatedEndpointLabel"))}</label>
            <div class="etp-response-search-shell" style="height:28px;margin-bottom:4px;">
              <span class="etp-search-icon">🔍</span>
              <input
                type="search"
                id="insp-node-req-search"
                class="etp-response-search-input"
                value="${escapeAttr(ui.endpointSearchQuery || "")}"
                placeholder="${escapeAttr(translate(lang, "flows.associatedEndpointSearchPlaceholder"))}"
              />
            </div>
            <select id="insp-node-req-id" class="etp-select">
              <option value="">${escapeHtml(translate(lang, "flows.selectEndpointPlaceholder"))}</option>
              ${filteredEndpoints
                .map(
                  (r) =>
                    `<option value="${escapeAttr(r.id)}" ${cfg.requestId === r.id ? "selected" : ""}>[${escapeHtml(r.method)}] ${escapeHtml(r.name)} (${escapeHtml(r.collectionName)})</option>`
                )
                .join("")}
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div class="etp-form-group">
              <label class="etp-form-label">${escapeHtml(translate(lang, "flows.retriesSelectLabel"))}</label>
              <select id="insp-node-retries" class="etp-select">
                ${[0, 1, 3, 5]
                  .map(
                    (r) =>
                      `<option value="${r}" ${currentRetries === r ? "selected" : ""}>${r} ${escapeHtml(translate(lang, "flows.retriesOptionSuffix"))}</option>`
                  )
                  .join("")}
              </select>
            </div>
            <div class="etp-form-group">
              <label class="etp-form-label">${escapeHtml(translate(lang, "flows.retryDelaySecLabel"))}</label>
              <input type="number" id="insp-node-retry-delay" class="etp-input" min="0.1" max="60" step="0.5" value="${Number(cfg.retryDelaySec ?? 1)}" />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr;gap:8px;">
            <div class="etp-form-group">
              <label class="etp-form-label">${escapeHtml(translate(lang, "flows.policyOnHttpErrorLabel"))}</label>
              <select id="insp-pol-http-err" class="etp-select">
                ${policyOptions
                  .map(
                    (p) => `<option value="${escapeAttr(p.value)}" ${currentHttpPolicy === p.value ? "selected" : ""}>${escapeHtml(p.label)}</option>`
                  )
                  .join("")}
              </select>
            </div>
            <div class="etp-form-group">
              <label class="etp-form-label">${escapeHtml(translate(lang, "flows.policyOnAssertionFailLabel"))}</label>
              <select id="insp-pol-ast-err" class="etp-select">
                ${policyOptions
                  .map(
                    (p) => `<option value="${escapeAttr(p.value)}" ${currentAstPolicy === p.value ? "selected" : ""}>${escapeHtml(p.label)}</option>`
                  )
                  .join("")}
              </select>
            </div>
          </div>

          <!-- Parámetros y Variables Consumidas (Exclusivos del Flujo) -->
          <div style="padding-top:6px;border-top:1px solid var(--border-subtle);display:flex;flex-direction:column;gap:5px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
              <strong style="font-size:11.5px;">${escapeHtml(translate(lang, "flows.flowParamsTitle"))} (${paramsList.length})</strong>
              <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
                <button type="button" class="etp-btn-xs" id="btn-insp-reset-params" title="${escapeAttr(translate(lang, "flows.btnResetFlowParamsTooltip"))}">${escapeHtml(translate(lang, "flows.btnResetFlowParamsFromReq"))}</button>
                <button type="button" class="etp-btn-xs" id="btn-insp-add-param">${escapeHtml(translate(lang, "flows.btnAddFlowParam"))}</button>
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
                          <th style="width:26px;">${escapeHtml(translate(lang, "flows.colOn"))}</th>
                          <th>${escapeHtml(translate(lang, "flows.colParamKey"))}</th>
                          <th>${escapeHtml(translate(lang, "flows.colParamValue"))}</th>
                          <th>${escapeHtml(translate(lang, "flows.colAssignVar"))}</th>
                          <th style="width:24px;"></th>
                        </tr>
                      </thead>
                      <tbody>
                        ${paramsList
                          .map(
                            (p, idx) => `
                          <tr>
                            <td><input type="checkbox" data-insp-prm-on="${idx}" ${p.enabled !== false ? "checked" : ""} /></td>
                            <td><input class="etp-kv-input" data-insp-prm-key="${idx}" value="${escapeAttr(p.key || "")}" placeholder="param_key" /></td>
                            <td><input class="etp-kv-input" data-insp-prm-val="${idx}" value="${escapeAttr(p.value || "")}" placeholder="valor o \${var}" /></td>
                            <td>
                              <select class="etp-select" data-insp-prm-varsel="${idx}" style="height:24px;font-size:10.5px;width:100%;padding:0 4px;">
                                ${buildInspectorVarOptionsHtml(availVars, p.value, lang)}
                              </select>
                            </td>
                            <td><button type="button" class="etp-icon-btn danger" data-insp-prm-del="${idx}">×</button></td>
                          </tr>
                        `
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </div>`
                : `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(translate(lang, "flows.emptyFlowParams"))}</div>`
            }
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;padding-top:6px;border-top:1px solid var(--border-subtle);gap:6px;flex-wrap:wrap;">
            <label style="font-size:11px;display:flex;align-items:center;gap:4px;">
              <input type="checkbox" id="insp-node-excl-ast" ${cfg.useExclusiveAssertions ? "checked" : ""} />
              ${escapeHtml(translate(lang, "flows.onlyFlowAssertionsCheckbox"))}
            </label>
            <button type="button" class="etp-btn-xs" id="btn-insp-add-ast">${escapeHtml(translate(lang, "flows.btnAddFlowAssertionShort"))}</button>
          </div>
          ${
            assertions.length > 0
              ? `<div class="etp-table-scroll-wrap">
                  <table class="etp-kv-table" style="font-size:11px;">
                    <thead>
                      <tr>
                        <th style="width:26px;">${escapeHtml(translate(lang, "flows.colOn"))}</th>
                        <th>${escapeHtml(translate(lang, "flows.colTarget"))}</th>
                        <th>${escapeHtml(translate(lang, "flows.colProperty"))}</th>
                        <th>${escapeHtml(translate(lang, "flows.colOperator"))}</th>
                        <th>${escapeHtml(translate(lang, "flows.colExpected"))}</th>
                        <th style="width:24px;"></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${assertions
                        .map(
                          (a, idx) => `
                        <tr>
                          <td><input type="checkbox" data-insp-ast-on="${idx}" ${a.enabled !== false ? "checked" : ""} /></td>
                          <td>
                            <select class="etp-select" data-insp-ast-target="${idx}" style="height:24px;font-size:10.5px;width:100%;">
                              ${assertionTargets
                                .map((t) => `<option value="${t.value}" ${a.target === t.value ? "selected" : ""}>${escapeHtml(t.label)}</option>`)
                                .join("")}
                            </select>
                          </td>
                          <td><input class="etp-kv-input" data-insp-ast-prop="${idx}" value="${escapeAttr(a.property || "")}" placeholder="results[0].name" /></td>
                          <td>
                            <select class="etp-select" data-insp-ast-op="${idx}" style="height:24px;font-size:10.5px;width:100%;">
                              ${assertionOperators
                                .map((op) => `<option value="${op.value}" ${a.operator === op.value ? "selected" : ""}>${escapeHtml(op.label)}</option>`)
                                .join("")}
                            </select>
                          </td>
                          <td><input class="etp-kv-input" data-insp-ast-exp="${idx}" value="${escapeAttr(a.expected ?? "")}" placeholder="200" /></td>
                          <td><button type="button" class="etp-icon-btn danger" data-insp-ast-del="${idx}">×</button></td>
                        </tr>
                      `
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>`
              : ""
          }
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;gap:6px;flex-wrap:wrap;">
            <strong style="font-size:11.5px;">${escapeHtml(translate(lang, "flows.declarativeExtractionsTitle"))} (${extractions.length})</strong>
            <button type="button" class="etp-btn-xs" id="btn-insp-add-ext">${escapeHtml(translate(lang, "flows.btnAddFlowExtractionShort"))}</button>
          </div>
          <div style="font-size:10.5px;color:var(--text-muted);">
            ${escapeHtml(translate(lang, "flows.jsonPathArrayHint"))}
          </div>
          ${
            extractions.length > 0
              ? `<div class="etp-table-scroll-wrap">
                  <table class="etp-kv-table" style="font-size:11px;">
                    <thead>
                      <tr>
                        <th>${escapeHtml(translate(lang, "flows.colVariable"))}</th>
                        <th>${escapeHtml(translate(lang, "flows.colSource"))}</th>
                        <th>${escapeHtml(translate(lang, "flows.colPathOrHeader"))}</th>
                        <th>${escapeHtml(translate(lang, "flows.colVarCurrentVal"))}</th>
                        <th>${escapeHtml(translate(lang, "flows.colScope"))}</th>
                        <th>${escapeHtml(translate(lang, "flows.colFallback"))}</th>
                        <th style="width:24px;"></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${extractions
                        .map((ex, idx) => {
                          const livePreview = resolveLiveNodeExtractionPreviewValue(ex, cfg.requestId, activeFlow, state);
                          return `
                        <tr>
                          <td><input class="etp-kv-input" data-insp-ext-var="${idx}" value="${escapeAttr(ex.variableName || "")}" placeholder="flow_var" /></td>
                          <td>
                            <select class="etp-select" data-insp-ext-src="${idx}" style="height:24px;font-size:10.5px;width:100%;">
                              ${extractionSources
                                .map((s) => `<option value="${s.value}" ${ex.source === s.value ? "selected" : ""}>${escapeHtml(s.label)}</option>`)
                                .join("")}
                            </select>
                          </td>
                          <td><input class="etp-kv-input" data-insp-ext-path="${idx}" value="${escapeAttr(ex.path || "")}" placeholder="results[0].name" /></td>
                          <td style="font-family:var(--font-mono);font-size:10.5px;color:${livePreview.resolved ? "var(--accent-secondary)" : "var(--text-muted)"};" data-insp-ext-live-val="${idx}">
                            ${livePreview.resolved ? escapeHtml(livePreview.value) : escapeHtml(translate(lang, "flows.varPendingExecution"))}
                          </td>
                          <td>
                            <select class="etp-select" data-insp-ext-scope="${idx}" style="height:24px;font-size:10.5px;width:100%;">
                              <option value="flow" ${ex.scope !== "runtime" ? "selected" : ""}>${escapeHtml(translate(lang, "flows.scopeFlow"))}</option>
                              <option value="runtime" ${ex.scope === "runtime" ? "selected" : ""}>${escapeHtml(translate(lang, "flows.scopeRuntime"))}</option>
                            </select>
                          </td>
                          <td><input class="etp-kv-input" data-insp-ext-fb="${idx}" value="${escapeAttr(ex.fallbackValue ?? "")}" /></td>
                          <td><button type="button" class="etp-icon-btn danger" data-insp-ext-del="${idx}">×</button></td>
                        </tr>
                      `;
                        })
                        .join("")}
                    </tbody>
                  </table>
                </div>`
              : ""
          }
        `;
      } else if (selectedNode.type === NODE_TYPES.CONDITION) {
        const leftVal = cfg.leftOperand || (cfg.property ? `\${${cfg.property}}` : "${status}");
        const rightVal = cfg.rightOperand ?? cfg.expected ?? "200";
        bodyHtml += `
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.condLeftOperandLabel"))}</label>
            <input type="text" id="insp-cond-left" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(leftVal)}" />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.condOperatorLabel"))}</label>
            <select id="insp-cond-op" class="etp-select">
              ${conditionOperators
                .map((op) => `<option value="${op.value}" ${cfg.operator === op.value ? "selected" : ""}>${escapeHtml(op.label)}</option>`)
                .join("")}
            </select>
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.condRightOperandLabel"))}</label>
            <input type="text" id="insp-cond-right" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(rightVal)}" />
          </div>
        `;
      } else if (selectedNode.type === NODE_TYPES.DELAY) {
        const delayMs =
          cfg.delayMs !== undefined ? Number(cfg.delayMs) : Math.round(Number(cfg.delaySec ?? 1) * 1000);
        bodyHtml += `
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.delayMsLabel"))}</label>
            <input type="number" id="insp-delay-ms" class="etp-input" min="0" max="60000" step="100" value="${delayMs}" />
          </div>
        `;
      } else if (selectedNode.type === NODE_TYPES.TRANSFORM) {
        const srcVar = cfg.sourceVariable ?? cfg.inputVariable ?? "";
        const tplVal = cfg.template ?? cfg.templateOrValue ?? "";
        const dstVar = cfg.targetVariable ?? cfg.outputVariable ?? "transformed_var";
        bodyHtml += `
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.transformOpLabel"))}</label>
            <select id="insp-trf-op" class="etp-select">
              ${["template", "upper", "lower", "trim", "default_if_empty", "math_add"]
                .map((op) => `<option value="${op}" ${cfg.operation === op ? "selected" : ""}>${op}</option>`)
                .join("")}
            </select>
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.transformSourceVarLabel"))}</label>
            <input type="text" id="insp-trf-src" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(srcVar)}" />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.transformTemplateLabel"))}</label>
            <input type="text" id="insp-trf-tpl" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(tplVal)}" placeholder="Bearer \${auth_token}" />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.transformTargetVarLabel"))}</label>
            <input type="text" id="insp-trf-dst" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(dstVar)}" />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.transformFallbackLabel"))}</label>
            <input type="text" id="insp-trf-fb" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(cfg.fallbackValue || "")}" />
          </div>
        `;
      } else if (selectedNode.type === NODE_TYPES.SUBFLOW) {
        const otherFlows = (state.customFlows || []).filter((f) => f.id !== activeFlow.id);
        const curSubflowId = cfg.subflowId || cfg.targetFlowId || "";
        bodyHtml += `
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.subflowTargetLabel"))}</label>
            <select id="insp-subflow-id" class="etp-select">
              <option value="">${escapeHtml(translate(lang, "flows.selectSubflowPlaceholder"))}</option>
              ${otherFlows
                .map((f) => `<option value="${escapeAttr(f.id)}" ${curSubflowId === f.id ? "selected" : ""}>${escapeHtml(f.name)}</option>`)
                .join("")}
            </select>
          </div>
        `;
      } else if (selectedNode.type === NODE_TYPES.GROUP_NOTE) {
        bodyHtml += `
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.groupNoteTextLabel"))}</label>
            <textarea id="insp-note-text" class="etp-input" style="height:68px;padding:6px;">${escapeHtml(cfg.noteText || "")}</textarea>
          </div>
        `;
      }

      bodyHtml += `
          <div style="padding-top:8px;border-top:1px solid var(--border-subtle);font-size:11.5px;display:flex;flex-direction:column;gap:4px;">
            <div><strong>⬇ ${escapeHtml(translate(lang, "flows.varsConsumed"))}:</strong> ${
              deps.consumedVars.length
                ? deps.consumedVars.map((v) => `<code>\${${escapeHtml(v)}}</code>`).join(", ")
                : `<span style="color:var(--text-muted);">${lang === "en" ? "None" : "Ninguna"}</span>`
            }</div>
            <div><strong>⬆ ${escapeHtml(translate(lang, "flows.varsProduced"))}:</strong> ${
              deps.producedVars.length
                ? deps.producedVars.map((v) => `<code style="color:var(--accent-secondary);">\${${escapeHtml(v)}}</code>`).join(", ")
                : `<span style="color:var(--text-muted);">${lang === "en" ? "None" : "Ninguna"}</span>`
            }</div>
            ${
              deps.consumedSecrets.length > 0
                ? `<div style="margin-top:2px;">
                    <strong>🔒 ${lang === "en" ? "Referenced Secrets" : "Secretos Referenciados"}:</strong>
                    ${deps.consumedSecrets
                      .map((sk) => {
                        const exists = secretKeys.includes(sk);
                        return `<span class="etp-secret-locked-mask">${escapeHtml(sk)}: ${exists ? (lang === "en" ? "🔒 Exists (hidden)" : "🔒 Existe (valor oculto)") : (lang === "en" ? "⚠ Missing in vault" : "⚠ No definido en bóveda")}</span>`;
                      })
                      .join(" ")}
                  </div>`
                : ""
            }
          </div>
        </div>
      `;
    } else if (selectedEdge) {
      bodyHtml += `
        <div class="etp-side-card">
          <div class="etp-side-card-title">
            <span>🔗 ${escapeHtml(translate(lang, "flows.selectedEdgeTitle"))}</span>
            <button type="button" class="etp-btn-xs" id="btn-delete-selected-edge" style="color:var(--status-danger);">🗑 ${lang === "en" ? "Delete" : "Eliminar"}</button>
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.edgePortLabel"))}</label>
            <select id="insp-edge-port" class="etp-select">
              ${["success", "failure", "timeout", "true", "false", "default"]
                .map((p) => `<option value="${p}" ${selectedEdge.sourcePort === p ? "selected" : ""}>${p}</option>`)
                .join("")}
            </select>
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.edgeCustomLabel"))}</label>
            <input type="text" id="insp-edge-label" class="etp-input" value="${escapeAttr(selectedEdge.label || selectedEdge.sourcePort)}" />
          </div>
        </div>
      `;
    }

    activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
    const flowVars = activeFlow.flowVariables;
    const maxConcurrencyVal = Number(graph.settings?.maxConcurrency ?? graph.settings?.concurrency ?? 2);

    bodyHtml += `
      <div class="etp-side-card">
        <div class="etp-side-card-title">
          <span>⚙ ${escapeHtml(translate(lang, "flows.graphParamsTitle"))}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="etp-form-group">
            <label class="etp-form-label">${escapeHtml(translate(lang, "flows.maxIterationsLabel"))}</label>
            <input type="number" id="insp-graph-max-iter" class="etp-input" min="1" max="50" value="${Number(graph.settings?.maxIterations ?? 10)}" />
          </div>
          <div class="etp-form-group">
            <label class="etp-form-label" title="${escapeAttr(translate(lang, "flows.concurrencyHint"))}">
              ${escapeHtml(translate(lang, "flows.concurrencyLabel"))} <span style="cursor:help;color:var(--accent-primary);">ⓘ</span>
            </label>
            <input type="number" id="insp-graph-concurrency" class="etp-input" min="1" max="6" value="${maxConcurrencyVal}" title="${escapeAttr(translate(lang, "flows.concurrencyHint"))}" />
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
          <strong style="font-size:11.5px;">${escapeHtml(translate(lang, "flows.initialFlowVarsTitle"))} (${flowVars.length})</strong>
          <button type="button" class="etp-btn-xs" id="btn-add-flow-init-var">${escapeHtml(translate(lang, "flows.btnAddFlowVar"))}</button>
        </div>
        ${
          flowVars.length > 0
            ? `<div class="etp-table-scroll-wrap">
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
                    ${flowVars
                      .map(
                        (fv, idx) => `
                      <tr>
                        <td><input type="checkbox" data-fvar-on="${idx}" ${fv.enabled !== false ? "checked" : ""} /></td>
                        <td><input class="etp-kv-input" data-fvar-key="${idx}" value="${escapeAttr(fv.key || "")}" /></td>
                        <td>
                          ${
                            fv.isSecret
                              ? `<input type="password" class="etp-kv-input" data-fvar-val="${idx}" value="${escapeAttr(fv.value || "")}" placeholder="${escapeAttr(translate(lang, "flows.secretActiveMask"))}" />`
                              : `<input class="etp-kv-input" data-fvar-val="${idx}" value="${escapeAttr(maskSecretsInString(fv.value || "", state))}" />`
                          }
                        </td>
                        <td><input type="checkbox" data-fvar-sec="${idx}" ${fv.isSecret ? "checked" : ""} /></td>
                        <td><button type="button" class="etp-icon-btn danger" data-fvar-del="${idx}">×</button></td>
                      </tr>
                    `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : ""
        }
      </div>
      ${buildFlowVariablesSummaryCardHtml(activeFlow, allRequests, state, lang)}
    `;
  } else if (tab === "variables") {
    activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
    const flowVars = activeFlow.flowVariables;
    bodyHtml += `
      ${buildFlowVariablesSummaryCardHtml(activeFlow, allRequests, state, lang)}
      <div class="etp-side-card">
        <div class="etp-side-card-title">
          <span>⚙ ${escapeHtml(translate(lang, "flows.initialFlowVarsTitle"))} (${flowVars.length})</span>
          <button type="button" class="etp-btn-xs" id="btn-add-flow-init-var">${escapeHtml(translate(lang, "flows.btnAddFlowVar"))}</button>
        </div>
        ${
          flowVars.length > 0
            ? `<div class="etp-table-scroll-wrap">
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
                    ${flowVars
                      .map(
                        (fv, idx) => `
                      <tr>
                        <td><input type="checkbox" data-fvar-on="${idx}" ${fv.enabled !== false ? "checked" : ""} /></td>
                        <td><input class="etp-kv-input" data-fvar-key="${idx}" value="${escapeAttr(fv.key || "")}" /></td>
                        <td>
                          ${
                            fv.isSecret
                              ? `<input type="password" class="etp-kv-input" data-fvar-val="${idx}" value="${escapeAttr(fv.value || "")}" placeholder="${escapeAttr(translate(lang, "flows.secretActiveMask"))}" />`
                              : `<input class="etp-kv-input" data-fvar-val="${idx}" value="${escapeAttr(maskSecretsInString(fv.value || "", state))}" />`
                          }
                        </td>
                        <td><input type="checkbox" data-fvar-sec="${idx}" ${fv.isSecret ? "checked" : ""} /></td>
                        <td><button type="button" class="etp-icon-btn danger" data-fvar-del="${idx}">×</button></td>
                      </tr>
                    `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(translate(lang, "flows.emptyFlowVariablesOverview"))}</div>`
        }
      </div>
    `;
  } else if (tab === "capture") {
    const targetReqId =
      selectedNode?.type === NODE_TYPES.HTTP_REQUEST
        ? selectedNode.config?.requestId
        : graph.nodes.find((n) => n.type === NODE_TYPES.HTTP_REQUEST)?.config?.requestId ||
          activeFlow.selectedRequestIds?.[0] ||
          null;
    const latestResp = targetReqId ? state.responsesByReqId?.[targetReqId] : null;
    let parsedJson = null;
    if (latestResp?.body) {
      try {
        parsedJson = JSON.parse(latestResp.body);
      } catch {}
    }
    const jsonFields = parsedJson ? flattenJsonPathsForVisualCapture(parsedJson) : [];

    bodyHtml += `
      <div class="etp-side-card">
        <div class="etp-side-card-title">
          <span>${escapeHtml(translate(lang, "flows.visualCaptureTitle"))}</span>
        </div>
        <p style="font-size:11.5px;color:var(--text-secondary);">${escapeHtml(translate(lang, "flows.visualCaptureJsonOnlyDesc"))}</p>
        ${
          !latestResp
            ? `<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px;border:1px dashed var(--border-strong);border-radius:6px;">${escapeHtml(translate(lang, "flows.visualCaptureNoResp"))}</div>`
            : `
          <div style="font-size:11.5px;font-weight:600;">${escapeHtml(translate(lang, "flows.visualCaptureJsonDetected"))} (${jsonFields.length}):</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;max-height:260px;overflow-y:auto;">
            ${
              jsonFields.length
                ? jsonFields
                    .map(
                      (f) =>
                        `<button type="button" class="etp-json-capture-chip" data-capture-source="json_path" data-capture-path="${escapeAttr(f.path)}"><code>${escapeHtml(f.path)}</code> <span style="color:var(--text-muted);">= ${escapeHtml(maskSecretsInString(f.preview, state))}</span></button>`
                    )
                    .join("")
                : `<span style="font-size:11px;color:var(--text-muted);">${escapeHtml(translate(lang, "flows.visualCaptureNoJsonFields"))}</span>`
            }
          </div>
        `
        }
      </div>
    `;
  } else if (tab === "diagnostic") {
    const report = activeFlow.lastReport;
    const failedStep = report?.steps?.find((s) => s.nodeId === report?.failedNodeId) || null;
    const handledFailedSteps = (report?.steps || []).filter(
      (s) => s.nodeType === NODE_TYPES.HTTP_REQUEST && s.passed === false
    );

    bodyHtml += `
      <div class="etp-side-card">
        <div class="etp-side-card-title">
          <span>🛡️ ${lang === "en" ? "Graph & Dataflow Pre-Validation" : "Validación Previa del Grafo y Datos"}</span>
          <span class="etp-status-badge ${validation.valid ? "status-2xx" : "status-4xx"}">${validation.valid ? (lang === "en" ? "VALID" : "VÁLIDO") : (lang === "en" ? "ISSUES" : "CON ERRORES")}</span>
        </div>
        ${
          validation.errors.length === 0 && validation.warnings.length === 0
            ? `<div style="font-size:12px;color:var(--status-success);">${escapeHtml(translate(lang, "flows.validationOk"))}</div>`
            : ""
        }
        ${validation.errors
          .map(
            (e) =>
              `<div class="etp-danger-banner" style="padding:6px 8px;font-size:11.5px;">✗ [${escapeHtml(e.code)}] ${escapeHtml(e.message)}</div>`
          )
          .join("")}
        ${validation.warnings
          .map(
            (w) =>
              `<div class="etp-warning-banner" style="padding:6px 8px;font-size:11.5px;">⚠ [${escapeHtml(w.code)}] ${escapeHtml(w.message)}</div>`
          )
          .join("")}
      </div>
      <div class="etp-side-card">
        <div class="etp-side-card-title">
          <span>🩺 ${lang === "en" ? "Step-by-Step Diagnostics" : "Diagnóstico Paso a Paso"}</span>
          ${
            report?.failedNodeId
              ? `<button type="button" class="etp-btn-xs" id="btn-retry-failed-node-diag" style="color:var(--status-warning);">↻ ${lang === "en" ? "Retry Failed" : "Repetir Fallido"}</button>`
              : ""
          }
        </div>
        ${
          report && !report.allPassed && failedStep
            ? `<div class="etp-danger-banner" style="padding:8px 10px;font-size:11.5px;">
                <strong>${escapeHtml(
                  translate(lang, "flows.diagFailedAtNodeBanner", {
                    node: failedStep.nodeLabel || failedStep.requestName || failedStep.nodeId,
                    reason: failedStep.failureReason || `HTTP ${failedStep.status || 0}`
                  })
                )}</strong>
              </div>`
            : report && report.allPassed && handledFailedSteps.length > 0
            ? `<div class="etp-warning-banner" style="padding:8px 10px;font-size:11.5px;">
                <strong>${escapeHtml(
                  translate(lang, "flows.diagRecoveredAfterNodeBanner", {
                    node: handledFailedSteps.map((hs) => `«${hs.nodeLabel || hs.requestName}»`).join(", ")
                  })
                )}</strong>
              </div>`
            : ""
        }
        ${
          !report || !Array.isArray(report.steps) || report.steps.length === 0
            ? `<div style="font-size:12px;color:var(--text-muted);">${lang === "en" ? "Run or simulate the flow to inspect transitions, attempts, and produced variables." : "Ejecuta o simula el flujo para inspeccionar transiciones, intentos y variables producidas."}</div>`
            : report.steps
                .map((s, idx) => {
                  const isStepSuccess = s.passed !== false && s.status !== "failed" && s.execState !== "failed";
                  const isHandledBranchError = !isStepSuccess && report.allPassed;
                  const borderColor = isStepSuccess
                    ? "var(--border-subtle)"
                    : isHandledBranchError
                    ? "var(--status-warning)"
                    : "var(--status-danger)";
                  const titleDisplay =
                    s.nodeLabel && s.requestName && s.nodeLabel !== s.requestName
                      ? `${s.nodeLabel} (${s.requestName})`
                      : s.nodeLabel || s.requestName || s.nodeId || "Paso";
                  const statusBadgeLabel = isStepSuccess
                    ? lang === "en"
                      ? "✓ SUCCESS"
                      : "✓ EXITOSO"
                    : isHandledBranchError
                    ? lang === "en"
                      ? "⚠ HANDLED BRANCH FAILURE"
                      : "⚠ FALLO EN RAMA (RECUPERADO)"
                    : lang === "en"
                    ? "✗ FAILED NODE"
                    : "✗ NODO FALLIDO";

                  return `
              <div style="padding:8px 10px;border-radius:6px;border:1.5px solid ${borderColor};background:var(--bg-input);font-size:11.5px;display:flex;flex-direction:column;gap:4px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                  <strong>#${idx + 1} ${escapeHtml(titleDisplay)} <code style="font-size:10px;color:var(--text-muted);">[${escapeHtml(s.nodeType || "step")}]</code></strong>
                  <span class="${isStepSuccess ? "etp-pass" : "etp-fail"}" style="${isHandledBranchError ? "color:var(--status-warning);" : ""}">${escapeHtml(statusBadgeLabel)} (${s.attempts || s.attemptsUsed || 1}/${s.maxAttempts || 1})</span>
                </div>
                ${
                  s.url || s.resolvedUrl
                    ? `<div style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted);">${escapeHtml(s.method || "GET")} ${escapeHtml(maskSecretsInString(s.url || s.resolvedUrl, state))} → HTTP ${Number(s.httpStatus ?? s.status) || 0} (${Number(s.durationMs) || 0} ms)</div>`
                    : ""
                }
                ${
                  s.failureReason
                    ? `<div style="font-size:11px;color:${isHandledBranchError ? "var(--status-warning)" : "var(--status-danger)"};font-weight:600;">${isHandledBranchError ? "↪" : "✗"} ${escapeHtml(translate(lang, "flows.diagFailureCause"))}: ${escapeHtml(maskSecretsInString(s.failureReason, state))}</div>`
                    : ""
                }
                ${
                  s.transitionPort
                    ? `<div style="font-size:10.5px;">${escapeHtml(translate(lang, "flows.diagTransitionTaken"))}: <code>out:${escapeHtml(s.transitionPort)}</code> ${s.detail || s.details ? `(${escapeHtml(maskSecretsInString(s.detail || s.details, state))})` : ""}</div>`
                    : ""
                }
                ${
                  Object.keys(s.extractedVariables || {}).length > 0
                    ? `<div style="font-size:10.5px;color:var(--accent-secondary);">${escapeHtml(translate(lang, "flows.varsProduced"))}: ${Object.entries(s.extractedVariables)
                        .map(([k, v]) => `<code>${escapeHtml(k)}=${escapeHtml(maskSecretsInString(String(v), state))}</code>`)
                        .join(", ")}</div>`
                    : ""
                }
              </div>
            `;
                })
                .join("")
        }
      </div>
    `;
  } else if (tab === "history") {
    const history = Array.isArray(activeFlow.executionHistory) ? activeFlow.executionHistory : [];
    const runA = history.find((h) => h.runId === ui.compareRunIdA) || history[0] || null;
    const runB = history.find((h) => h.runId === ui.compareRunIdB) || history[1] || history[0] || null;
    const comparison = runA && runB ? compareFlowExecutions(runA, runB) : null;

    bodyHtml += `
      <div class="etp-side-card">
        <div class="etp-side-card-title">
          <span>🕒 ${lang === "en" ? "Sanitized History" : "Historial Sanitizado"} (${history.length}/12)</span>
          <button type="button" class="etp-btn-xs" id="btn-export-safe-flow-report">${escapeHtml(translate(lang, "flows.btnExportReport"))}</button>
        </div>
        ${
          history.length === 0
            ? `<div style="font-size:12px;color:var(--text-muted);">${lang === "en" ? "No executions recorded yet for this flow." : "No hay ejecuciones registradas aún para este flujo."}</div>`
            : `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <div>
              <label class="etp-form-label">${lang === "en" ? "Base Run (A):" : "Ejecución Base (A):"}</label>
              <select id="insp-cmp-run-a" class="etp-select" style="width:100%;height:26px;font-size:11px;">
                ${history
                  .map(
                    (h, i) =>
                      `<option value="${escapeAttr(h.runId)}" ${runA?.runId === h.runId ? "selected" : ""}>#${i + 1} ${h.allPassed ? "✓" : "✗"} ${h.totalDurationMs}ms (${String(h.timestamp || h.finishedAt || "").slice(11, 19)})</option>`
                  )
                  .join("")}
              </select>
            </div>
            <div>
              <label class="etp-form-label">${lang === "en" ? "Compare with (B):" : "Comparar con (B):"}</label>
              <select id="insp-cmp-run-b" class="etp-select" style="width:100%;height:26px;font-size:11px;">
                ${history
                  .map(
                    (h, i) =>
                      `<option value="${escapeAttr(h.runId)}" ${runB?.runId === h.runId ? "selected" : ""}>#${i + 1} ${h.allPassed ? "✓" : "✗"} ${h.totalDurationMs}ms (${String(h.timestamp || h.finishedAt || "").slice(11, 19)})</option>`
                  )
                  .join("")}
              </select>
            </div>
          </div>
          ${
            comparison
              ? `<div style="margin-top:6px;font-size:11px;">
                  <div>Δ ${lang === "en" ? "Duration" : "Duración"}: <strong>${comparison.durationDiffMs >= 0 ? `+${comparison.durationDiffMs}` : comparison.durationDiffMs} ms</strong></div>
                  <div class="etp-table-scroll-wrap" style="margin-top:4px;">
                    <table class="etp-kv-table" style="font-size:10.5px;">
                      <thead><tr><th>${lang === "en" ? "Node / Step" : "Nodo / Paso"}</th><th>${lang === "en" ? "Status A→B" : "Estado A→B"}</th><th>HTTP A→B</th><th>Δ ms</th></tr></thead>
                      <tbody>
                        ${comparison.nodeDiffs
                          .map(
                            (d) => `
                          <tr>
                            <td>${escapeHtml(d.label)}</td>
                            <td>${escapeHtml(d.statusA)} → ${escapeHtml(d.statusB)}</td>
                            <td>${escapeHtml(d.httpStatusA)} → ${escapeHtml(d.httpStatusB)}</td>
                            <td>${d.durationDiffMs >= 0 ? `+${d.durationDiffMs}` : d.durationDiffMs}</td>
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
        `
        }
      </div>
    `;
  }

  const rightVisible = state.flowsRightInspectorVisible !== false;
  const rightPinned = state.flowsRightInspectorPinned !== false;
  const rightWidth = Math.min(580, Math.max(300, Number(state.flowsRightInspectorWidth) || 390));

  return `
    <aside
      class="etp-flow-inspector ${!rightVisible ? "collapsed" : ""} ${!rightPinned && rightVisible ? "unpinned-right" : ""}"
      id="flows-right-inspector"
      style="width:${rightVisible ? `${rightWidth}px` : "0px"};min-width:${rightVisible ? `${rightWidth}px` : "0px"};"
      aria-label="Inspector contextual del flujo"
    >
      <div class="etp-sidebar-header">
        <span>🔧 ${escapeHtml(translate(lang, "flows.inspectorPanelBtn"))}</span>
        <div style="display:flex;gap:4px;">
          <button type="button" class="etp-btn-xs" id="btn-pin-flows-right-inspector" title="${escapeAttr(translate(lang, "sidebar.pinTooltip"))}">
            📌 <span id="lbl-flows-right-pin-state">${escapeHtml(rightPinned ? translate(lang, "sidebar.pinFixed") : translate(lang, "sidebar.pinFloating"))}</span>
          </button>
          <button type="button" class="etp-btn-xs" id="btn-hide-flows-right-inspector" title="${escapeAttr(translate(lang, "flows.inspectorPanelTooltip"))}">
            <span>${escapeHtml(translate(lang, "flows.hideRightPanel"))}</span>
          </button>
        </div>
      </div>
      <nav class="etp-subtabs" style="padding:0 8px;">
        <button type="button" class="etp-subtab ${tab === "node" ? "active" : ""}" data-flow-insp-tab="node">${escapeHtml(translate(lang, "flows.inspectorTabNode"))}</button>
        <button type="button" class="etp-subtab ${tab === "variables" ? "active" : ""}" data-flow-insp-tab="variables">${escapeHtml(translate(lang, "flows.inspectorTabVariables"))}</button>
        <button type="button" class="etp-subtab ${tab === "capture" ? "active" : ""}" data-flow-insp-tab="capture">${escapeHtml(translate(lang, "flows.inspectorTabCapture"))}</button>
        <button type="button" class="etp-subtab ${tab === "diagnostic" ? "active" : ""}" data-flow-insp-tab="diagnostic">${escapeHtml(translate(lang, "flows.inspectorTabDiagnostic"))}</button>
        <button type="button" class="etp-subtab ${tab === "history" ? "active" : ""}" data-flow-insp-tab="history">${escapeHtml(translate(lang, "flows.inspectorTabHistory"))}</button>
      </nav>
      <div class="etp-flow-inspector-body">
        ${bodyHtml}
      </div>
    </aside>
  `;
}

export function attachFlowInspectorEvents(
  mainContentEl,
  state,
  activeFlow,
  allRequests,
  rerenderFlows,
  runFlowWithOptions
) {
  const lang = state.lang || "es";
  const ui = state.flowStudioUi;
  const graph = activeFlow.graph;
  const selectedNode = graph.nodes.find((n) => n.id === ui.selectedNodeId) || null;
  const selectedEdge = graph.edges.find((e) => e.id === ui.selectedEdgeId) || null;

  // Controles de fijar / flotante y ocultar del menú derecho (inspector)
  document.getElementById("btn-pin-flows-right-inspector")?.addEventListener("click", () => {
    state.flowsRightInspectorPinned = !(state.flowsRightInspectorPinned !== false);
    persistWorkspaceToLocalStorage(state);
    rerenderFlows();
  });
  document.getElementById("btn-hide-flows-right-inspector")?.addEventListener("click", () => {
    state.flowsRightInspectorVisible = false;
    persistWorkspaceToLocalStorage(state);
    rerenderFlows();
  });

  mainContentEl.querySelectorAll("[data-flow-insp-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ui.inspectorTab = btn.getAttribute("data-flow-insp-tab");
      rerenderFlows();
    });
  });

  if (selectedNode) {
    const cfg = selectedNode.config || (selectedNode.config = {});
    if (selectedNode.type === NODE_TYPES.HTTP_REQUEST && !Array.isArray(cfg.params)) {
      const assocReq = allRequests.find((r) => r.id === cfg.requestId);
      cfg.params = assocReq ? cloneRequestParamsForFlow(assocReq) : [];
    }

    document.getElementById("insp-node-label")?.addEventListener("input", (e) => {
      selectedNode.label = e.target.value;
      persistWorkspaceToLocalStorage(state);
      const titleEl = mainContentEl.querySelector(`[data-flow-node-id="${selectedNode.id}"] .etp-flow-node-title`);
      if (titleEl) {
        const icon = titleEl.textContent.split(" ")[0] || "🌐";
        titleEl.textContent = `${icon} ${selectedNode.label}`;
      }
    });

    document.getElementById("btn-delete-selected-node")?.addEventListener("click", () => {
      if (selectedNode.type === NODE_TYPES.START) return;
      pushFlowHistorySnapshot(activeFlow);
      graph.nodes = graph.nodes.filter((n) => n.id !== selectedNode.id);
      graph.edges = graph.edges.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id);
      ui.selectedNodeId = null;
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
      showToast(translate(lang, "toasts.deletedNode"));
    });

    document.getElementById("btn-run-from-this-node")?.addEventListener("click", () => {
      runFlowWithOptions({ startFromNodeId: selectedNode.id });
    });

    // Búsqueda sobre el combobox de Endpoint Asociado
    const reqSearchInp = document.getElementById("insp-node-req-search");
    if (reqSearchInp) {
      reqSearchInp.addEventListener("input", (e) => {
        ui.endpointSearchQuery = e.target.value;
        const selEl = document.getElementById("insp-node-req-id");
        if (!selEl) return;
        const q = String(ui.endpointSearchQuery || "").trim().toLowerCase();
        const filtered = allRequests.filter((r) => {
          if (r.id === cfg.requestId) return true;
          if (!q) return true;
          return (
            (r.name || "").toLowerCase().includes(q) ||
            (r.method || "").toLowerCase().includes(q) ||
            (r.collectionName || "").toLowerCase().includes(q) ||
            (r.url || "").toLowerCase().includes(q)
          );
        });
        selEl.innerHTML =
          `<option value="">${escapeHtml(translate(lang, "flows.selectEndpointPlaceholder"))}</option>` +
          filtered
            .map(
              (r) =>
                `<option value="${escapeAttr(r.id)}" ${cfg.requestId === r.id ? "selected" : ""}>[${escapeHtml(r.method)}] ${escapeHtml(r.name)} (${escapeHtml(r.collectionName)})</option>`
            )
            .join("");
      });
    }

    document.getElementById("insp-node-req-id")?.addEventListener("change", (e) => {
      pushFlowHistorySnapshot(activeFlow);
      cfg.requestId = e.target.value;
      const reqObj = allRequests.find((r) => r.id === cfg.requestId);
      if (reqObj) {
        selectedNode.label = reqObj.name;
        cfg.params = cloneRequestParamsForFlow(reqObj);
      } else {
        cfg.params = [];
      }
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });

    document.getElementById("insp-node-retries")?.addEventListener("change", (e) => {
      const val = Number(e.target.value);
      const clean = [0, 1, 3, 5].includes(val) ? val : 0;
      cfg.retries = clean;
      cfg.retryCount = clean;
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });

    document.getElementById("insp-node-retry-delay")?.addEventListener("input", (e) => {
      cfg.retryDelaySec = Math.min(60, Math.max(0.1, Number(e.target.value) || 1));
      persistWorkspaceToLocalStorage(state);
    });

    document.getElementById("insp-pol-http-err")?.addEventListener("change", (e) => {
      cfg.onHttpError = e.target.value;
      cfg.policies = cfg.policies || {};
      cfg.policies.onHttpError = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });

    document.getElementById("insp-pol-ast-err")?.addEventListener("change", (e) => {
      cfg.onAssertionFailure = e.target.value;
      cfg.policies = cfg.policies || {};
      cfg.policies.onAssertionFailure = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });

    // Eventos de Parámetros y Variables Consumidas (exclusivos del flujo en el nodo)
    document.getElementById("btn-insp-add-param")?.addEventListener("click", () => {
      cfg.params = Array.isArray(cfg.params) ? cfg.params : [];
      cfg.params.push({
        id: "nd_prm_" + Date.now(),
        enabled: true,
        key: "",
        value: "",
        description: "",
        isSecret: false
      });
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });

    document.getElementById("btn-insp-reset-params")?.addEventListener("click", () => {
      const origReq = allRequests.find((r) => r.id === cfg.requestId);
      cfg.params = origReq ? cloneRequestParamsForFlow(origReq) : [];
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
      showToast(translate(lang, "toasts.flowParamsReset"));
    });

    mainContentEl.querySelectorAll("[data-insp-prm-on]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const idx = Number(el.getAttribute("data-insp-prm-on"));
        if (cfg.params?.[idx]) cfg.params[idx].enabled = e.target.checked;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });

    mainContentEl.querySelectorAll("[data-insp-prm-key]").forEach((el) => {
      el.addEventListener("input", (e) => {
        const idx = Number(el.getAttribute("data-insp-prm-key"));
        if (cfg.params?.[idx]) cfg.params[idx].key = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });

    mainContentEl.querySelectorAll("[data-insp-prm-val]").forEach((el) => {
      el.addEventListener("input", (e) => {
        const idx = Number(el.getAttribute("data-insp-prm-val"));
        if (cfg.params?.[idx]) cfg.params[idx].value = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
      el.addEventListener("change", () => {
        rerenderFlows();
      });
    });

    mainContentEl.querySelectorAll("[data-insp-prm-varsel]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const idx = Number(el.getAttribute("data-insp-prm-varsel"));
        const chosenToken = e.target.value;
        if (chosenToken && cfg.params?.[idx]) {
          cfg.params[idx].value = chosenToken;
          persistWorkspaceToLocalStorage(state);
          rerenderFlows();
        }
      });
    });

    mainContentEl.querySelectorAll("[data-insp-prm-del]").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = Number(el.getAttribute("data-insp-prm-del"));
        cfg.params?.splice(idx, 1);
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });

    document.getElementById("insp-node-excl-ast")?.addEventListener("change", (e) => {
      cfg.useExclusiveAssertions = Boolean(e.target.checked);
      persistWorkspaceToLocalStorage(state);
    });

    document.getElementById("btn-insp-add-ast")?.addEventListener("click", () => {
      cfg.assertions = Array.isArray(cfg.assertions) ? cfg.assertions : [];
      cfg.assertions.push({
        id: "nd_ast_" + Date.now(),
        enabled: true,
        target: "status",
        property: "",
        operator: "equals",
        expected: "200"
      });
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });

    mainContentEl.querySelectorAll("[data-insp-ast-on]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const idx = Number(el.getAttribute("data-insp-ast-on"));
        if (cfg.assertions?.[idx]) cfg.assertions[idx].enabled = e.target.checked;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-insp-ast-target]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const idx = Number(el.getAttribute("data-insp-ast-target"));
        if (cfg.assertions?.[idx]) cfg.assertions[idx].target = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-insp-ast-prop]").forEach((el) => {
      el.addEventListener("input", (e) => {
        const idx = Number(el.getAttribute("data-insp-ast-prop"));
        if (cfg.assertions?.[idx]) cfg.assertions[idx].property = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-insp-ast-op]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const idx = Number(el.getAttribute("data-insp-ast-op"));
        if (cfg.assertions?.[idx]) cfg.assertions[idx].operator = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-insp-ast-exp]").forEach((el) => {
      el.addEventListener("input", (e) => {
        const idx = Number(el.getAttribute("data-insp-ast-exp"));
        if (cfg.assertions?.[idx]) cfg.assertions[idx].expected = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-insp-ast-del]").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = Number(el.getAttribute("data-insp-ast-del"));
        cfg.assertions?.splice(idx, 1);
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });

    document.getElementById("btn-insp-add-ext")?.addEventListener("click", () => {
      cfg.extractions = Array.isArray(cfg.extractions) ? cfg.extractions : [];
      cfg.extractions.push({
        id: "nd_ext_" + Date.now(),
        enabled: true,
        variableName: "captured_var",
        source: "json_path",
        path: "results[0].name",
        scope: "flow",
        fallbackValue: ""
      });
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });

    mainContentEl.querySelectorAll("[data-insp-ext-var]").forEach((el) => {
      el.addEventListener("input", (e) => {
        const idx = Number(el.getAttribute("data-insp-ext-var"));
        if (cfg.extractions?.[idx]) cfg.extractions[idx].variableName = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
      el.addEventListener("change", () => rerenderFlows());
    });
    mainContentEl.querySelectorAll("[data-insp-ext-src]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const idx = Number(el.getAttribute("data-insp-ext-src"));
        if (cfg.extractions?.[idx]) cfg.extractions[idx].source = e.target.value;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });
    mainContentEl.querySelectorAll("[data-insp-ext-path]").forEach((el) => {
      el.addEventListener("input", (e) => {
        const idx = Number(el.getAttribute("data-insp-ext-path"));
        if (cfg.extractions?.[idx]) {
          cfg.extractions[idx].path = e.target.value;
          const liveCell = mainContentEl.querySelector(`[data-insp-ext-live-val="${idx}"]`);
          if (liveCell) {
            const livePreview = resolveLiveNodeExtractionPreviewValue(cfg.extractions[idx], cfg.requestId, activeFlow, state);
            liveCell.textContent = livePreview.resolved
              ? livePreview.value
              : translate(lang, "flows.varPendingExecution");
            liveCell.style.color = livePreview.resolved ? "var(--accent-secondary)" : "var(--text-muted)";
          }
        }
        persistWorkspaceToLocalStorage(state);
      });
      el.addEventListener("change", () => rerenderFlows());
    });
    mainContentEl.querySelectorAll("[data-insp-ext-scope]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const idx = Number(el.getAttribute("data-insp-ext-scope"));
        if (cfg.extractions?.[idx]) cfg.extractions[idx].scope = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
    });
    mainContentEl.querySelectorAll("[data-insp-ext-fb]").forEach((el) => {
      el.addEventListener("input", (e) => {
        const idx = Number(el.getAttribute("data-insp-ext-fb"));
        if (cfg.extractions?.[idx]) cfg.extractions[idx].fallbackValue = e.target.value;
        persistWorkspaceToLocalStorage(state);
      });
      el.addEventListener("change", () => rerenderFlows());
    });
    mainContentEl.querySelectorAll("[data-insp-ext-del]").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = Number(el.getAttribute("data-insp-ext-del"));
        cfg.extractions?.splice(idx, 1);
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      });
    });

    document.getElementById("insp-cond-left")?.addEventListener("input", (e) => {
      cfg.leftOperand = e.target.value;
      cfg.source = "expression";
      persistWorkspaceToLocalStorage(state);
    });
    document.getElementById("insp-cond-op")?.addEventListener("change", (e) => {
      cfg.operator = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });
    document.getElementById("insp-cond-right")?.addEventListener("input", (e) => {
      cfg.rightOperand = e.target.value;
      cfg.expected = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });
    document.getElementById("insp-delay-ms")?.addEventListener("input", (e) => {
      const ms = Math.min(60000, Math.max(0, Number(e.target.value) || 0));
      cfg.delayMs = ms;
      cfg.delaySec = Math.round((ms / 1000) * 10) / 10;
      persistWorkspaceToLocalStorage(state);
    });
    document.getElementById("insp-trf-op")?.addEventListener("change", (e) => {
      cfg.operation = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });
    document.getElementById("insp-trf-src")?.addEventListener("input", (e) => {
      cfg.sourceVariable = e.target.value;
      cfg.inputVariable = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });
    document.getElementById("insp-trf-tpl")?.addEventListener("input", (e) => {
      cfg.template = e.target.value;
      cfg.templateOrValue = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });
    document.getElementById("insp-trf-dst")?.addEventListener("input", (e) => {
      cfg.targetVariable = e.target.value;
      cfg.outputVariable = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });
    document.getElementById("insp-trf-fb")?.addEventListener("input", (e) => {
      cfg.fallbackValue = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });
    document.getElementById("insp-subflow-id")?.addEventListener("change", (e) => {
      cfg.subflowId = e.target.value;
      cfg.targetFlowId = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });
    document.getElementById("insp-note-text")?.addEventListener("input", (e) => {
      cfg.noteText = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });
  }

  if (selectedEdge) {
    document.getElementById("btn-delete-selected-edge")?.addEventListener("click", () => {
      pushFlowHistorySnapshot(activeFlow);
      graph.edges = graph.edges.filter((e) => e.id !== selectedEdge.id);
      ui.selectedEdgeId = null;
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });
    document.getElementById("insp-edge-port")?.addEventListener("change", (e) => {
      selectedEdge.sourcePort = e.target.value;
      selectedEdge.label = e.target.value;
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });
    document.getElementById("insp-edge-label")?.addEventListener("input", (e) => {
      selectedEdge.label = e.target.value;
      persistWorkspaceToLocalStorage(state);
    });
  }

  document.getElementById("insp-graph-max-iter")?.addEventListener("input", (e) => {
    graph.settings = graph.settings || {};
    graph.settings.maxIterations = Math.min(50, Math.max(1, Number(e.target.value) || 10));
    persistWorkspaceToLocalStorage(state);
  });

  document.getElementById("insp-graph-concurrency")?.addEventListener("input", (e) => {
    graph.settings = graph.settings || {};
    const cVal = Math.min(6, Math.max(1, Number(e.target.value) || 2));
    graph.settings.maxConcurrency = cVal;
    graph.settings.concurrency = cVal;
    persistWorkspaceToLocalStorage(state);
  });

  // Botón + Variable en Variables Iniciales del Flujo (independientes por flujo)
  document.getElementById("btn-add-flow-init-var")?.addEventListener("click", () => {
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

  mainContentEl.querySelectorAll("[data-fvar-on]").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const idx = Number(chk.getAttribute("data-fvar-on"));
      activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
      if (activeFlow.flowVariables[idx]) {
        activeFlow.flowVariables[idx].enabled = e.target.checked;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      }
    });
  });

  mainContentEl.querySelectorAll("[data-fvar-key]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = Number(inp.getAttribute("data-fvar-key"));
      activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
      if (activeFlow.flowVariables[idx]) {
        activeFlow.flowVariables[idx].key = e.target.value;
        persistWorkspaceToLocalStorage(state);
      }
    });
    inp.addEventListener("change", () => rerenderFlows());
  });

  mainContentEl.querySelectorAll("[data-fvar-val]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = Number(inp.getAttribute("data-fvar-val"));
      activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
      if (activeFlow.flowVariables[idx]) {
        activeFlow.flowVariables[idx].value = e.target.value;
        persistWorkspaceToLocalStorage(state);
      }
    });
    inp.addEventListener("change", () => rerenderFlows());
  });

  mainContentEl.querySelectorAll("[data-fvar-sec]").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const idx = Number(chk.getAttribute("data-fvar-sec"));
      activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
      if (activeFlow.flowVariables[idx]) {
        activeFlow.flowVariables[idx].isSecret = e.target.checked;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      }
    });
  });

  mainContentEl.querySelectorAll("[data-fvar-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-fvar-del"));
      activeFlow.flowVariables = sanitizeFlowVariablesArray(activeFlow.flowVariables);
      activeFlow.flowVariables.splice(idx, 1);
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });
  });

  mainContentEl.querySelectorAll("[data-capture-source]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const src = chip.getAttribute("data-capture-source");
      const pathStr = chip.getAttribute("data-capture-path");
      const targetNode =
        selectedNode && selectedNode.type === NODE_TYPES.HTTP_REQUEST
          ? selectedNode
          : graph.nodes.find((n) => n.type === NODE_TYPES.HTTP_REQUEST);
      if (!targetNode) {
        showToast("⚠ Selecciona primero un nodo de Solicitud HTTP en el lienzo.", "warning");
        return;
      }
      targetNode.config.extractions = Array.isArray(targetNode.config.extractions)
        ? targetNode.config.extractions
        : [];
      const cleanVarName = pathStr.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "") || "captured_val";
      targetNode.config.extractions.push({
        id: "cap_ext_" + Date.now(),
        enabled: true,
        variableName: cleanVarName,
        source: src,
        path: pathStr,
        scope: "flow",
        fallbackValue: ""
      });
      ui.selectedNodeId = targetNode.id;
      ui.inspectorTab = "node";
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
      showToast(`✓ Variable «${cleanVarName}» vinculada desde JSON (${pathStr})`);
    });
  });

  document.getElementById("btn-retry-failed-node-diag")?.addEventListener("click", () => {
    const failedId = activeFlow.lastReport?.failedNodeId;
    if (failedId) {
      runFlowWithOptions({ onlyNodeId: failedId });
    }
  });

  document.getElementById("insp-cmp-run-a")?.addEventListener("change", (e) => {
    ui.compareRunIdA = e.target.value;
    rerenderFlows();
  });

  document.getElementById("insp-cmp-run-b")?.addEventListener("change", (e) => {
    ui.compareRunIdB = e.target.value;
    rerenderFlows();
  });

  // Exportar Reporte Seguro: abre el modal con el JSON sanitizado listo para copiar o guardar
  document.getElementById("btn-export-safe-flow-report")?.addEventListener("click", () => {
    const safeJson = exportSanitizedFlowReport(activeFlow, state);
    const modalTitle = document.getElementById("modal-import-title");
    const modalTextarea = document.getElementById("import-textarea");
    const reportBox = document.getElementById("import-report-box");
    const modalEl = document.getElementById("modal-import");
    if (modalTitle && modalTextarea && modalEl) {
      modalTitle.textContent = `${translate(lang, "flows.btnExportReport")} — ${activeFlow.name}`;
      modalTextarea.value = safeJson;
      if (reportBox) {
        reportBox.innerHTML = `<div style="padding:8px;background:var(--bg-elevated);border-radius:6px;color:var(--status-success);font-weight:600;">${escapeHtml(translate(lang, "toasts.reportReadyInModal"))}</div>`;
      }
      modalEl.classList.add("open");
    }
    showToast(translate(lang, "toasts.reportReadyInModal"));
  });
}
