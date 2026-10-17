import { translate } from "../../../lang/i18n.js";
import { persistWorkspaceToLocalStorage } from "../../../services/storage/index.js";
import { maskSecretsInString } from "../../../services/http/index.js";
import {
  NODE_TYPES,
  PORT_TYPES,
  NODE_EXEC_STATES,
  FLOW_TEMPLATES_CATALOG,
  createDefaultNode,
  createFlowFromTemplate,
  pushFlowHistorySnapshot,
  undoFlowGraphChange,
  redoFlowGraphChange
} from "../../../services/flows/index.js";
import { escapeHtml, escapeAttr, showToast, openConfirmMoveModal } from "../dom-utils.js";
import { renderFlowInspectorHtml, attachFlowInspectorEvents } from "./flows-inspector-view.js";

const NODE_WIDTH = 224;
const NODE_HEIGHT = 86;

function getOutputPortsForNodeType(type) {
  if (type === NODE_TYPES.START || type === NODE_TYPES.DELAY || type === NODE_TYPES.TRANSFORM) {
    return [PORT_TYPES.DEFAULT];
  }
  if (type === NODE_TYPES.HTTP_REQUEST) {
    return [PORT_TYPES.SUCCESS, PORT_TYPES.FAILURE, PORT_TYPES.TIMEOUT];
  }
  if (type === NODE_TYPES.CONDITION) {
    return [PORT_TYPES.TRUE, PORT_TYPES.FALSE];
  }
  if (type === NODE_TYPES.SUBFLOW) {
    return [PORT_TYPES.SUCCESS, PORT_TYPES.FAILURE];
  }
  return [];
}

function formatExecStatusLabel(execState, attemptInfo, lang = "es") {
  const attSuffix =
    attemptInfo && attemptInfo.maxAttempts > 1
      ? ` (${attemptInfo.attempt}/${attemptInfo.maxAttempts})`
      : "";
  const isEn = lang === "en";
  switch (execState) {
    case NODE_EXEC_STATES.QUEUED:
      return isEn ? "🕒 QUEUED" : "🕒 EN COLA";
    case NODE_EXEC_STATES.RUNNING:
      return `${isEn ? "▶ RUNNING" : "▶ EJECUTANDO"}${attSuffix}`;
    case NODE_EXEC_STATES.RETRYING:
      return `${isEn ? "↻ RETRY" : "↻ REINTENTO"}${attSuffix}`;
    case NODE_EXEC_STATES.SUCCESS:
      return `${isEn ? "✓ SUCCESS" : "✓ EXITOSO"}${attSuffix}`;
    case NODE_EXEC_STATES.WARNING:
      return isEn ? "⚠ WARNING" : "⚠ ADVERTENCIA";
    case NODE_EXEC_STATES.FAILED:
      return `${isEn ? "✗ FAILED" : "✗ FALLIDO"}${attSuffix}`;
    case NODE_EXEC_STATES.SKIPPED:
      return isEn ? "⏭ SKIPPED" : "⏭ OMITIDO";
    case NODE_EXEC_STATES.CANCELLED:
      return isEn ? "⏹ CANCELLED" : "⏹ CANCELADO";
    default:
      return isEn ? "⏳ PENDING" : "⏳ PENDIENTE";
  }
}

function getNodeTypeIcon(type) {
  switch (type) {
    case NODE_TYPES.START:
      return "🚀";
    case NODE_TYPES.HTTP_REQUEST:
      return "🌐";
    case NODE_TYPES.CONDITION:
      return "🔀";
    case NODE_TYPES.DELAY:
      return "⏱";
    case NODE_TYPES.TRANSFORM:
      return "⚗";
    case NODE_TYPES.SUBFLOW:
      return "🧩";
    case NODE_TYPES.GROUP_NOTE:
      return "📝";
    case NODE_TYPES.END_SUCCESS:
      return "✅";
    case NODE_TYPES.END_ERROR:
      return "🛑";
    default:
      return "⚡";
  }
}

function computeBezierEdgePath(srcNode, dstNode, portIndex = 0) {
  const sx = (Number(srcNode.x ?? srcNode.position?.x) || 0) + NODE_WIDTH;
  const sy = (Number(srcNode.y ?? srcNode.position?.y) || 0) + 34 + portIndex * 18;
  const tx = Number(dstNode.x ?? dstNode.position?.x) || 0;
  const ty = (Number(dstNode.y ?? dstNode.position?.y) || 0) + 42;
  const dx = Math.max(48, Math.abs(tx - sx) * 0.48);
  const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
  const midX = Math.round((sx + tx) / 2);
  const midY = Math.round((sy + ty) / 2) - 6;
  return { d, midX, midY };
}

export function renderAdvancedFlowCanvasHtml(state, activeFlow, allRequests) {
  const lang = state.lang || "es";
  const ui = state.flowStudioUi || {};
  const graph = activeFlow.graph || {
    nodes: [],
    edges: [],
    viewport: { x: 24, y: 24, zoom: 1 },
    settings: {}
  };
  const vp = graph.viewport || { x: 24, y: 24, zoom: 1 };
  const zoomPct = Math.round((vp.zoom || 1) * 100);
  const nodesMap = new Map((graph.nodes || []).map((n) => [n.id, n]));

  let edgesSvgHtml = "";
  for (const edge of graph.edges || []) {
    const sNode = nodesMap.get(edge.source);
    const tNode = nodesMap.get(edge.target);
    if (!sNode || !tNode) continue;
    const outPorts = getOutputPortsForNodeType(sNode.type);
    const pIdx = Math.max(0, outPorts.indexOf(edge.sourcePort));
    const { d, midX, midY } = computeBezierEdgePath(sNode, tNode, pIdx);
    const isSelected = ui.selectedEdgeId === edge.id;
    const isTaken = (ui.takenEdgeIds || []).includes(edge.id);
    const isFailedEdge = ui.focusedErrorEdgeId === edge.id;
    const edgeColor = isFailedEdge
      ? "var(--status-danger)"
      : edge.sourcePort === PORT_TYPES.FAILURE || edge.sourcePort === PORT_TYPES.FALSE
      ? "var(--status-danger)"
      : edge.sourcePort === PORT_TYPES.TIMEOUT
      ? "var(--status-warning)"
      : edge.sourcePort === PORT_TYPES.SUCCESS || edge.sourcePort === PORT_TYPES.TRUE
      ? "var(--status-success)"
      : "var(--text-muted)";

    edgesSvgHtml += `
      <g data-flow-edge-id="${escapeAttr(edge.id)}">
        <path
          d="${d}"
          class="etp-flow-edge-path ${isSelected ? "selected" : ""} ${isTaken ? "taken" : ""} ${isFailedEdge ? "failed-edge" : ""}"
          style="stroke:${edgeColor};"
          marker-end="url(#etp-flow-arrow)"
        />
        <text x="${midX}" y="${midY}" text-anchor="middle" class="etp-flow-edge-label">${escapeHtml(edge.label || edge.sourcePort)}</text>
      </g>
    `;
  }

  const deleteNodeTooltip = escapeAttr(translate(lang, "flows.nodeDeleteTooltip"));

  const nodesHtml = (graph.nodes || [])
    .map((node) => {
      const isSelected = ui.selectedNodeId === node.id;
      const execState = ui.execStatusByNode?.[node.id] || NODE_EXEC_STATES.PENDING;
      const attemptInfo = ui.execAttemptByNode?.[node.id] || null;
      const statusLabel = formatExecStatusLabel(execState, attemptInfo, lang);
      const outPorts = getOutputPortsForNodeType(node.type);
      const hasInputPort = node.type !== NODE_TYPES.START && node.type !== NODE_TYPES.GROUP_NOTE;
      const canDeleteNode = node.type !== NODE_TYPES.START;
      const nx = Math.round(Number(node.x ?? node.position?.x) || 0);
      const ny = Math.round(Number(node.y ?? node.position?.y) || 0);

      let summaryHtml = "";
      if (node.type === NODE_TYPES.HTTP_REQUEST) {
        const reqObj = allRequests.find((r) => r.id === node.config?.requestId);
        const method = (reqObj?.method || "GET").toUpperCase();
        const urlPreview = reqObj
          ? maskSecretsInString(reqObj.url || "", state)
          : lang === "en"
          ? "(No endpoint)"
          : "(Sin endpoint)";
        const retries = Number(node.config?.retries ?? node.config?.retryCount) || 0;
        summaryHtml = `
          <div style="display:flex;align-items:center;gap:4px;">
            <span class="etp-method-badge etp-method-${escapeAttr(method.toLowerCase())}">${escapeHtml(method)}</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);font-size:10px;">${escapeHtml(urlPreview)}</span>
          </div>
          ${
            retries > 0
              ? `<div style="font-size:9.5px;color:var(--status-warning);">↻ ${lang === "en" ? "Retries" : "Reintentos"}: ${retries} (${Number(node.config?.retryDelaySec ?? 1)}s)</div>`
              : ""
          }
        `;
      } else if (node.type === NODE_TYPES.CONDITION) {
        const left = node.config?.leftOperand || (node.config?.property ? `\${${node.config.property}}` : "${status}");
        const right = node.config?.rightOperand ?? node.config?.expected ?? "200";
        summaryHtml = `<div style="font-family:var(--font-mono);font-size:10px;">${escapeHtml(left)} ${escapeHtml(node.config?.operator || "equals")} ${escapeHtml(right)}</div>`;
      } else if (node.type === NODE_TYPES.DELAY) {
        const delayMs =
          node.config?.delayMs !== undefined
            ? Number(node.config.delayMs)
            : Math.round(Number(node.config?.delaySec ?? 1) * 1000);
        summaryHtml = `<div style="font-family:var(--font-mono);font-size:10px;">⏱ ${delayMs} ms</div>`;
      } else if (node.type === NODE_TYPES.TRANSFORM) {
        const outVar = node.config?.targetVariable || node.config?.outputVariable || "out";
        summaryHtml = `<div style="font-family:var(--font-mono);font-size:10px;">${escapeHtml(node.config?.operation || "template")} → \${${escapeHtml(outVar)}}</div>`;
      } else if (node.type === NODE_TYPES.GROUP_NOTE) {
        summaryHtml = `<div style="font-size:10.5px;">${escapeHtml(node.config?.noteText || "")}</div>`;
      }

      return `
        <div
          class="etp-flow-node type-${escapeAttr(node.type)} exec-${escapeAttr(execState)} ${isSelected ? "selected" : ""}"
          data-flow-node-id="${escapeAttr(node.id)}"
          data-node-type="${escapeAttr(node.type)}"
          style="left:${nx}px;top:${ny}px;"
          tabindex="0"
          role="button"
          aria-label="${escapeAttr(`${node.label} (${node.type}) — ${statusLabel}`)}"
        >
          <div class="etp-flow-node-header">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" class="etp-flow-node-title">${getNodeTypeIcon(node.type)} ${escapeHtml(node.label)}</span>
            <div style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;">
              <span class="etp-flow-node-status-pill">${escapeHtml(statusLabel)}</span>
              ${
                canDeleteNode
                  ? `<button type="button" class="etp-node-delete-btn" data-delete-node-id="${escapeAttr(node.id)}" title="${deleteNodeTooltip}" aria-label="${deleteNodeTooltip}">✕</button>`
                  : ""
              }
            </div>
          </div>
          <div class="etp-flow-node-body">
            ${summaryHtml}
          </div>
          <div class="etp-flow-ports-row">
            <div>
              ${
                hasInputPort
                  ? `<button type="button" class="etp-flow-port" data-port-in="${escapeAttr(node.id)}" title="${lang === "en" ? "Connect input to this node" : "Conectar entrada hacia este nodo"}" aria-label="Puerto de entrada">⊕ in</button>`
                  : ""
              }
            </div>
            <div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:flex-end;">
              ${outPorts
                .map((p) => {
                  const isConnectingSource =
                    ui.connectingFrom && ui.connectingFrom.nodeId === node.id && ui.connectingFrom.port === p;
                  return `<button type="button" class="etp-flow-port port-${escapeAttr(p)} ${isConnectingSource ? "connecting-source" : ""}" data-port-out="${escapeAttr(p)}" data-port-node="${escapeAttr(node.id)}" title="${lang === "en" ? "Click here and then click '⊕ in' on target node" : "Haz clic aquí y luego en '⊕ in' del nodo destino"}" aria-label="Puerto de salida ${escapeAttr(p)}">${escapeHtml(p)} →</button>`;
                })
                .join("")}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  const miniNodesSvg = (graph.nodes || [])
    .map((n) => {
      const mx = Math.max(2, Math.min(160, Math.round((Number(n.x ?? n.position?.x) || 0) * 0.1)));
      const my = Math.max(2, Math.min(98, Math.round((Number(n.y ?? n.position?.y) || 0) * 0.1)));
      const fill =
        ui.selectedNodeId === n.id
          ? "var(--accent-primary)"
          : ui.execStatusByNode?.[n.id] === NODE_EXEC_STATES.FAILED
          ? "var(--status-danger)"
          : ui.execStatusByNode?.[n.id] === NODE_EXEC_STATES.SUCCESS
          ? "var(--status-success)"
          : "var(--text-muted)";
      return `<rect x="${mx}" y="${my}" width="18" height="8" rx="2" fill="${fill}" />`;
    })
    .join("");

  const undoDisabled = !Array.isArray(activeFlow.undoStack) || activeFlow.undoStack.length === 0;
  const redoDisabled = !Array.isArray(activeFlow.redoStack) || activeFlow.redoStack.length === 0;

  return `
    <div class="etp-flows-advanced-layout">
      <!-- Paleta Izquierda de Nodos y Plantillas -->
      <aside class="etp-flow-palette" aria-label="${escapeAttr(translate(lang, "flows.paletteTitle"))}">
        <strong style="font-size:12px;color:var(--text-secondary);">➕ ${escapeHtml(translate(lang, "flows.paletteTitle"))}</strong>
        <button type="button" class="etp-palette-node-btn" data-add-node-type="${NODE_TYPES.HTTP_REQUEST}"><span>🌐 ${escapeHtml(translate(lang, "flows.nodeHttp"))}</span><span>+</span></button>
        <button type="button" class="etp-palette-node-btn" data-add-node-type="${NODE_TYPES.CONDITION}"><span>🔀 ${escapeHtml(translate(lang, "flows.nodeCondition"))}</span><span>+</span></button>
        <button type="button" class="etp-palette-node-btn" data-add-node-type="${NODE_TYPES.DELAY}"><span>⏱ ${escapeHtml(translate(lang, "flows.nodeDelay"))}</span><span>+</span></button>
        <button type="button" class="etp-palette-node-btn" data-add-node-type="${NODE_TYPES.TRANSFORM}"><span>⚗ ${escapeHtml(translate(lang, "flows.nodeTransform"))}</span><span>+</span></button>
        <button type="button" class="etp-palette-node-btn" data-add-node-type="${NODE_TYPES.SUBFLOW}"><span>🧩 ${escapeHtml(translate(lang, "flows.nodeSubflow"))}</span><span>+</span></button>
        <button type="button" class="etp-palette-node-btn" data-add-node-type="${NODE_TYPES.GROUP_NOTE}"><span>📝 ${escapeHtml(translate(lang, "flows.nodeGroup"))}</span><span>+</span></button>
        <button type="button" class="etp-palette-node-btn" data-add-node-type="${NODE_TYPES.END_SUCCESS}"><span>✅ ${escapeHtml(translate(lang, "flows.nodeEndSuccess"))}</span><span>+</span></button>
        <button type="button" class="etp-palette-node-btn" data-add-node-type="${NODE_TYPES.END_ERROR}"><span>🛑 ${escapeHtml(translate(lang, "flows.nodeEndError"))}</span><span>+</span></button>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);display:flex;flex-direction:column;gap:6px;">
          <strong style="font-size:12px;color:var(--text-secondary);">${escapeHtml(translate(lang, "flows.btnTemplates"))}</strong>
          <select id="flow-template-picker" class="etp-select" style="height:28px;font-size:11.5px;">
            <option value="">${escapeHtml(translate(lang, "flows.templatePlaceholder"))}</option>
            ${FLOW_TEMPLATES_CATALOG.map(
              (t) => `<option value="${escapeAttr(t.id)}">${escapeHtml(lang === "en" ? t.nameEn : t.nameEs)}</option>`
            ).join("")}
          </select>
        </div>
        <div style="margin-top:auto;font-size:10.5px;color:var(--text-muted);line-height:1.45;">
          💡 <strong>${escapeHtml(translate(lang, "flows.connectNodesHintTitle"))}</strong> ${escapeHtml(translate(lang, "flows.connectNodesHintDesc"))}<br/>
          ⌨️ <strong>${escapeHtml(translate(lang, "flows.keyboardHintTitle"))}</strong> ${escapeHtml(translate(lang, "flows.keyboardHintDesc"))}
        </div>
      </aside>
      <!-- Lienzo Central con Zoom, Paneo y Minimapa -->
      <div class="etp-flow-canvas-wrap" id="flow-canvas-wrap" tabindex="0" role="region" aria-label="Lienzo visual del orquestador de APIs">
        <div class="etp-flow-canvas-toolbar">
          <div class="etp-flow-canvas-toolbar-group">
            <button type="button" class="etp-btn-xs" id="btn-canvas-zoom-out" title="${lang === "en" ? "Zoom out (-)" : "Alejar (-)"}">−</button>
            <span class="etp-search-badge" id="lbl-canvas-zoom">${zoomPct}%</span>
            <button type="button" class="etp-btn-xs" id="btn-canvas-zoom-in" title="${lang === "en" ? "Zoom in (+)" : "Acercar (+)"}">+</button>
            <button type="button" class="etp-btn-xs" id="btn-canvas-fit">${escapeHtml(translate(lang, "flows.btnFitView"))}</button>
            <button type="button" class="etp-btn-xs" id="btn-canvas-center">${escapeHtml(translate(lang, "flows.btnCenterView"))}</button>
          </div>
          <div class="etp-flow-canvas-toolbar-group">
            <button type="button" class="etp-btn-xs" id="btn-canvas-undo" title="Ctrl+Z" ${undoDisabled ? 'style="opacity:0.55;"' : ""}>${escapeHtml(translate(lang, "flows.btnUndo"))}</button>
            <button type="button" class="etp-btn-xs" id="btn-canvas-redo" title="Ctrl+Y" ${redoDisabled ? 'style="opacity:0.55;"' : ""}>${escapeHtml(translate(lang, "flows.btnRedo"))}</button>
          </div>
        </div>
        <div
          class="etp-flow-viewport"
          id="flow-canvas-viewport"
          style="transform: translate(${Math.round(vp.x || 0)}px, ${Math.round(vp.y || 0)}px) scale(${Number(vp.zoom || 1).toFixed(2)});"
        >
          <svg class="etp-flow-edges-svg" id="flow-edges-svg">
            <defs>
              <marker id="etp-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--text-secondary)" />
              </marker>
            </defs>
            ${edgesSvgHtml}
          </svg>
          ${nodesHtml}
        </div>
        <div class="etp-flow-minimap" title="Minimapa de nodos del flujo" aria-label="Minimapa del lienzo">
          <svg width="170" height="108" viewBox="0 0 170 108">
            ${miniNodesSvg}
          </svg>
        </div>
      </div>
      <!-- Divisor redimensionable del Inspector Contextual Derecho -->
      <div class="etp-inspector-resizer ${state.flowsRightInspectorVisible === false || state.flowsRightInspectorPinned === false ? "hidden" : ""}" id="flows-right-inspector-resizer" title="Arrastra con el mouse para redimensionar el inspector derecho"></div>
      <!-- Inspector Contextual Derecho -->
      ${renderFlowInspectorHtml(state, activeFlow, allRequests)}
    </div>
  `;
}

export function attachAdvancedFlowCanvasEvents(
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
  const vp = graph.viewport || (graph.viewport = { x: 24, y: 24, zoom: 1 });
  const canvasWrap = document.getElementById("flow-canvas-wrap");
  const viewportEl = document.getElementById("flow-canvas-viewport");

  const deleteNodeById = (nodeIdToDelete) => {
    const targetNode = graph.nodes.find((n) => n.id === nodeIdToDelete);
    if (!targetNode || targetNode.type === NODE_TYPES.START) return false;
    pushFlowHistorySnapshot(activeFlow);
    graph.nodes = graph.nodes.filter((n) => n.id !== nodeIdToDelete);
    graph.edges = graph.edges.filter(
      (ed) => ed.source !== nodeIdToDelete && ed.target !== nodeIdToDelete
    );
    if (ui.selectedNodeId === nodeIdToDelete) {
      ui.selectedNodeId = null;
    }
    persistWorkspaceToLocalStorage(state);
    rerenderFlows();
    showToast(translate(lang, "toasts.deletedNode"));
    return true;
  };

  mainContentEl.querySelectorAll("[data-add-node-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nType = btn.getAttribute("data-add-node-type");
      pushFlowHistorySnapshot(activeFlow);
      const count = graph.nodes.length;
      const nx = 120 + (count % 4) * 260;
      const ny = 120 + Math.floor(count / 4) * 140;
      const newNode = createDefaultNode(nType, {
        id: `node_${nType}_${Date.now()}_${count}`,
        label:
          nType === NODE_TYPES.HTTP_REQUEST
            ? allRequests[0]?.name || translate(lang, "flows.nodeHttp")
            : nType === NODE_TYPES.CONDITION
            ? translate(lang, "flows.nodeCondition")
            : nType === NODE_TYPES.DELAY
            ? translate(lang, "flows.nodeDelay")
            : nType === NODE_TYPES.TRANSFORM
            ? translate(lang, "flows.nodeTransform")
            : nType === NODE_TYPES.SUBFLOW
            ? translate(lang, "flows.nodeSubflow")
            : nType === NODE_TYPES.GROUP_NOTE
            ? translate(lang, "flows.nodeGroup")
            : nType === NODE_TYPES.END_SUCCESS
            ? translate(lang, "flows.nodeEndSuccess")
            : translate(lang, "flows.nodeEndError"),
        x: nx,
        y: ny,
        position: { x: nx, y: ny },
        config: {
          requestId: nType === NODE_TYPES.HTTP_REQUEST ? allRequests[0]?.id || "" : "",
          retries: 0,
          retryCount: 0,
          retryDelaySec: 1,
          leftOperand: "${status}",
          operator: "equals",
          rightOperand: "200",
          delayMs: 1000,
          delaySec: 1,
          operation: "template",
          targetVariable: "transformed_var",
          outputVariable: "transformed_var",
          template: "${status}",
          templateOrValue: "${status}"
        }
      });
      graph.nodes.push(newNode);
      ui.selectedNodeId = newNode.id;
      ui.selectedEdgeId = null;
      ui.inspectorTab = "node";
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
    });
  });

  // Botón eliminar (✕) en la esquina superior derecha de cada nodo
  mainContentEl.querySelectorAll("[data-delete-node-id]").forEach((delBtn) => {
    delBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetId = delBtn.getAttribute("data-delete-node-id");
      deleteNodeById(targetId);
    });
  });

  // Confirmación antes de cargar una plantilla (ya que reemplazará el grafo actual)
  const templateSelect = document.getElementById("flow-template-picker");
  if (templateSelect) {
    templateSelect.addEventListener("change", (e) => {
      const tplId = e.target.value;
      if (!tplId) return;
      const tplMeta =
        FLOW_TEMPLATES_CATALOG.find((t) => t.id === tplId) || FLOW_TEMPLATES_CATALOG[0];
      const tplTitle = lang === "en" ? tplMeta.nameEn : tplMeta.nameEs;
      e.target.value = "";
      openConfirmMoveModal(
        translate(lang, "flows.templateConfirmMessage", { name: tplTitle }),
        () => {
          const tplFlow = createFlowFromTemplate(tplId, allRequests, lang);
          pushFlowHistorySnapshot(activeFlow);
          activeFlow.graph = tplFlow.graph;
          activeFlow.flowVariables = tplFlow.flowVariables;
          ui.selectedNodeId = activeFlow.graph.nodes[0]?.id || null;
          ui.selectedEdgeId = null;
          persistWorkspaceToLocalStorage(state);
          rerenderFlows();
          showToast(translate(lang, "toasts.templateLoaded", { name: tplFlow.name }));
        },
        translate(lang, "flows.templateConfirmTitle"),
        lang,
        { isDanger: true, acceptLabel: translate(lang, "flows.templateConfirmAccept") }
      );
    });
  }

  const applyZoom = (nextZoom) => {
    vp.zoom = Math.min(1.8, Math.max(0.4, Number(nextZoom.toFixed(2))));
    persistWorkspaceToLocalStorage(state);
    rerenderFlows();
  };

  document.getElementById("btn-canvas-zoom-in")?.addEventListener("click", () => applyZoom((vp.zoom || 1) + 0.15));
  document.getElementById("btn-canvas-zoom-out")?.addEventListener("click", () => applyZoom((vp.zoom || 1) - 0.15));
  document.getElementById("btn-canvas-center")?.addEventListener("click", () => {
    vp.x = 24;
    vp.y = 24;
    vp.zoom = 1;
    persistWorkspaceToLocalStorage(state);
    rerenderFlows();
  });
  document.getElementById("btn-canvas-fit")?.addEventListener("click", () => {
    if (graph.nodes.length === 0 || !canvasWrap) return;
    const maxX = Math.max(...graph.nodes.map((n) => (Number(n.x ?? n.position?.x) || 0) + NODE_WIDTH), 400);
    const maxY = Math.max(...graph.nodes.map((n) => (Number(n.y ?? n.position?.y) || 0) + NODE_HEIGHT), 300);
    const rect = canvasWrap.getBoundingClientRect();
    const fitZ = Math.min((rect.width - 60) / maxX, (rect.height - 60) / maxY, 1.2);
    vp.x = 24;
    vp.y = 44;
    vp.zoom = Math.max(0.45, Number(fitZ.toFixed(2)));
    persistWorkspaceToLocalStorage(state);
    rerenderFlows();
  });

  document.getElementById("btn-canvas-undo")?.addEventListener("click", () => {
    if (undoFlowGraphChange(activeFlow)) {
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
      showToast(translate(lang, "toasts.undoSuccess"));
    }
  });

  document.getElementById("btn-canvas-redo")?.addEventListener("click", () => {
    if (redoFlowGraphChange(activeFlow)) {
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
      showToast(translate(lang, "toasts.redoSuccess"));
    }
  });

  mainContentEl.querySelectorAll("[data-port-out]").forEach((portBtn) => {
    portBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nodeId = portBtn.getAttribute("data-port-node");
      const port = portBtn.getAttribute("data-port-out");
      ui.connectingFrom = { nodeId, port };
      rerenderFlows();
    });
  });

  mainContentEl.querySelectorAll("[data-port-in]").forEach((inBtn) => {
    inBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetNodeId = inBtn.getAttribute("data-port-in");
      if (ui.connectingFrom && ui.connectingFrom.nodeId && ui.connectingFrom.nodeId !== targetNodeId) {
        pushFlowHistorySnapshot(activeFlow);
        graph.edges.push({
          id: `edge_${Date.now()}_${graph.edges.length}`,
          source: ui.connectingFrom.nodeId,
          sourcePort: ui.connectingFrom.port,
          target: targetNodeId,
          targetPort: PORT_TYPES.IN,
          label: ui.connectingFrom.port
        });
        ui.connectingFrom = null;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
      }
    });
  });

  mainContentEl.querySelectorAll("[data-flow-edge-id]").forEach((edgeEl) => {
    edgeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      ui.selectedEdgeId = edgeEl.getAttribute("data-flow-edge-id");
      ui.selectedNodeId = null;
      ui.inspectorTab = "node";
      rerenderFlows();
      setTimeout(() => document.getElementById("flow-canvas-wrap")?.focus(), 10);
    });
  });

  const handleCanvasKeyboardAction = (e) => {
    const activeTag = document.activeElement?.tagName || "";
    if (["INPUT", "SELECT", "TEXTAREA"].includes(activeTag)) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (undoFlowGraphChange(activeFlow)) {
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
        showToast(translate(lang, "toasts.undoSuccess"));
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      if (redoFlowGraphChange(activeFlow)) {
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
        showToast(translate(lang, "toasts.redoSuccess"));
      }
      return;
    }

    const selNodeId = ui.selectedNodeId;
    const selEdgeId = ui.selectedEdgeId;

    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key) && selNodeId) {
      const nodeObj = graph.nodes.find((n) => n.id === selNodeId);
      if (!nodeObj) return;
      e.preventDefault();
      e.stopPropagation();
      pushFlowHistorySnapshot(activeFlow);
      let nx = Number(nodeObj.x ?? nodeObj.position?.x) || 0;
      let ny = Number(nodeObj.y ?? nodeObj.position?.y) || 0;
      if (e.key === "ArrowRight") nx += 16;
      if (e.key === "ArrowLeft") nx = Math.max(0, nx - 16);
      if (e.key === "ArrowDown") ny += 16;
      if (e.key === "ArrowUp") ny = Math.max(0, ny - 16);
      nodeObj.x = nx;
      nodeObj.y = ny;
      nodeObj.position = { x: nx, y: ny };
      persistWorkspaceToLocalStorage(state);
      rerenderFlows();
      setTimeout(() => {
        const focusedNode = document.querySelector(`[data-flow-node-id="${selNodeId}"]`);
        if (focusedNode) focusedNode.focus();
        else document.getElementById("flow-canvas-wrap")?.focus();
      }, 10);
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (selNodeId) {
        const nodeObj = graph.nodes.find((n) => n.id === selNodeId);
        if (nodeObj && nodeObj.type !== NODE_TYPES.START) {
          e.preventDefault();
          e.stopPropagation();
          deleteNodeById(selNodeId);
          setTimeout(() => document.getElementById("flow-canvas-wrap")?.focus(), 10);
        }
      } else if (selEdgeId) {
        e.preventDefault();
        e.stopPropagation();
        pushFlowHistorySnapshot(activeFlow);
        graph.edges = graph.edges.filter((ed) => ed.id !== selEdgeId);
        ui.selectedEdgeId = null;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
        setTimeout(() => document.getElementById("flow-canvas-wrap")?.focus(), 10);
      }
    }
  };

  let dragNodeObj = null;
  let dragStartPointer = { x: 0, y: 0 };
  let dragStartPos = { x: 0, y: 0 };
  let didMoveDuringDrag = false;
  let isPanningCanvas = false;

  mainContentEl.querySelectorAll("[data-flow-node-id]").forEach((nodeEl) => {
    const nodeId = nodeEl.getAttribute("data-flow-node-id");
    nodeEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      e.stopPropagation();
      const nodeObj = graph.nodes.find((n) => n.id === nodeId);
      if (!nodeObj) return;
      ui.selectedNodeId = nodeId;
      ui.selectedEdgeId = null;
      pushFlowHistorySnapshot(activeFlow);
      dragNodeObj = nodeObj;
      didMoveDuringDrag = false;
      dragStartPointer = { x: e.clientX, y: e.clientY };
      dragStartPos = {
        x: Number(nodeObj.x ?? nodeObj.position?.x) || 0,
        y: Number(nodeObj.y ?? nodeObj.position?.y) || 0
      };
      try {
        nodeEl.setPointerCapture(e.pointerId);
      } catch {}
    });

    nodeEl.addEventListener("pointermove", (e) => {
      if (!dragNodeObj || dragNodeObj.id !== nodeId) return;
      const dx = e.clientX - dragStartPointer.x;
      const dy = e.clientY - dragStartPointer.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        didMoveDuringDrag = true;
      }
      const scale = vp.zoom || 1;
      const nx = Math.max(0, Math.round(dragStartPos.x + dx / scale));
      const ny = Math.max(0, Math.round(dragStartPos.y + dy / scale));
      dragNodeObj.x = nx;
      dragNodeObj.y = ny;
      dragNodeObj.position = { x: nx, y: ny };
      nodeEl.style.left = `${nx}px`;
      nodeEl.style.top = `${ny}px`;
    });

    nodeEl.addEventListener("pointerup", () => {
      if (dragNodeObj && dragNodeObj.id === nodeId) {
        if (!didMoveDuringDrag && Array.isArray(activeFlow.undoStack) && activeFlow.undoStack.length > 0) {
          activeFlow.undoStack.pop();
        }
        dragNodeObj = null;
        persistWorkspaceToLocalStorage(state);
        rerenderFlows();
        setTimeout(() => {
          const updatedEl = document.querySelector(`[data-flow-node-id="${nodeId}"]`);
          if (updatedEl) updatedEl.focus();
        }, 10);
      }
    });

    nodeEl.addEventListener("keydown", handleCanvasKeyboardAction);
  });

  if (canvasWrap && viewportEl) {
    canvasWrap.addEventListener("keydown", handleCanvasKeyboardAction);

    canvasWrap.addEventListener("pointerdown", (e) => {
      if (
        e.target.closest(".etp-flow-node") ||
        e.target.closest(".etp-flow-canvas-toolbar") ||
        e.target.closest(".etp-flow-minimap")
      ) {
        return;
      }
      isPanningCanvas = true;
      dragStartPointer = { x: e.clientX, y: e.clientY };
      dragStartPos = { x: vp.x || 0, y: vp.y || 0 };
      ui.connectingFrom = null;
      canvasWrap.focus();
    });

    canvasWrap.addEventListener("pointermove", (e) => {
      if (!isPanningCanvas) return;
      vp.x = Math.round(dragStartPos.x + (e.clientX - dragStartPointer.x));
      vp.y = Math.round(dragStartPos.y + (e.clientY - dragStartPointer.y));
      viewportEl.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${Number(vp.zoom || 1).toFixed(2)})`;
    });

    canvasWrap.addEventListener("pointerup", () => {
      if (isPanningCanvas) {
        isPanningCanvas = false;
        persistWorkspaceToLocalStorage(state);
      }
    });

    canvasWrap.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        vp.zoom = Math.min(1.8, Math.max(0.4, Number(((vp.zoom || 1) + delta).toFixed(2))));
        viewportEl.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom.toFixed(2)})`;
        const lbl = document.getElementById("lbl-canvas-zoom");
        if (lbl) lbl.textContent = `${Math.round(vp.zoom * 100)}%`;
        persistWorkspaceToLocalStorage(state);
      },
      { passive: false }
    );
  }

  attachFlowInspectorEvents(mainContentEl, state, activeFlow, allRequests, rerenderFlows, runFlowWithOptions);
}
