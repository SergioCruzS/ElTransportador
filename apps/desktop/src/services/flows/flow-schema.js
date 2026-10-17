/**
 * Esquema Versionado de Flujos (v2), Sanitización Anti-Prototype-Pollution,
 * Flujos Independientes por Sección (Básico vs Avanzado) y Pila Undo/Redo — ElTransportador v1.2.0
 * Archivo: apps/desktop/src/services/flows/flow-schema.js
 */
import { generateUniqueEntityId } from "../storage/collection-sanitizer.js";

export const FLOW_SCHEMA_VERSION = 2;
export const MAX_FLOW_NODES = 80;
export const MAX_FLOW_EDGES = 160;
export const MAX_FLOW_HISTORY_RUNS = 12;
export const MAX_FLOW_UNDO_STACK = 25;
export const ALLOWED_RETRY_COUNTS = [0, 1, 3, 5];

export const NODE_TYPES = {
  START: "start",
  HTTP_REQUEST: "http_request",
  CONDITION: "condition",
  DELAY: "delay",
  TRANSFORM: "transform",
  SUBFLOW: "subflow",
  GROUP_NOTE: "group_note",
  END_SUCCESS: "end_success",
  END_ERROR: "end_error"
};

export const PORT_TYPES = {
  IN: "in",
  SUCCESS: "success",
  FAILURE: "failure",
  TIMEOUT: "timeout",
  TRUE: "true",
  FALSE: "false",
  DEFAULT: "default"
};

export const NODE_EXEC_STATES = {
  PENDING: "pending",
  QUEUED: "queued",
  RUNNING: "running",
  RETRYING: "retrying",
  SUCCESS: "success",
  WARNING: "warning",
  FAILED: "failed",
  SKIPPED: "skipped",
  CANCELLED: "cancelled"
};

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Clona y limpia recursivamente cualquier objeto eliminando claves peligrosas (Prototype Pollution).
 */
export function safeCloneAndSanitizeObject(input, depth = 0) {
  if (depth > 14 || input === null || input === undefined) return null;
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.slice(0, 300).map((item) => safeCloneAndSanitizeObject(item, depth + 1));
  }
  const clean = Object.create(null);
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    clean[k] = safeCloneAndSanitizeObject(v, depth + 1);
  }
  return JSON.parse(JSON.stringify(clean));
}

export function clampRetryCount(val) {
  const n = Number(val);
  if (ALLOWED_RETRY_COUNTS.includes(n)) return n;
  if (n <= 0 || Number.isNaN(n)) return 0;
  if (n === 2) return 3;
  if (n === 4) return 5;
  return n > 5 ? 5 : 1;
}

export function clampRetryDelaySec(val) {
  const n = Number(val);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.min(60, Math.round(n * 10) / 10);
}

export function clampDelayNodeSec(val) {
  const n = Number(val);
  if (Number.isNaN(n) || n < 0) return 0.5;
  return Math.min(60, Math.round(n * 10) / 10);
}

export function normalizePolicyValue(val) {
  const v = String(val || "follow_port").trim();
  if (v === "continue" || v === "continue_default") return "continue_default";
  if (v === "stop" || v === "stop_flow") return "stop_flow";
  if (v === "goto_error" || v === "goto_error_node") return "goto_error_node";
  return "follow_port";
}

export function getPortsForNodeType(type) {
  switch (type) {
    case NODE_TYPES.START:
      return { inputs: [], outputs: [PORT_TYPES.DEFAULT] };
    case NODE_TYPES.HTTP_REQUEST:
      return {
        inputs: [PORT_TYPES.IN],
        outputs: [PORT_TYPES.SUCCESS, PORT_TYPES.FAILURE, PORT_TYPES.TIMEOUT]
      };
    case NODE_TYPES.CONDITION:
      return {
        inputs: [PORT_TYPES.IN],
        outputs: [PORT_TYPES.TRUE, PORT_TYPES.FALSE]
      };
    case NODE_TYPES.DELAY:
    case NODE_TYPES.TRANSFORM:
      return {
        inputs: [PORT_TYPES.IN],
        outputs: [PORT_TYPES.DEFAULT]
      };
    case NODE_TYPES.SUBFLOW:
      return {
        inputs: [PORT_TYPES.IN],
        outputs: [PORT_TYPES.SUCCESS, PORT_TYPES.FAILURE]
      };
    case NODE_TYPES.END_SUCCESS:
    case NODE_TYPES.END_ERROR:
      return { inputs: [PORT_TYPES.IN], outputs: [] };
    case NODE_TYPES.GROUP_NOTE:
    default:
      return { inputs: [], outputs: [] };
  }
}

export function sanitizeFlowParamRule(p, idx = 0) {
  return {
    id: String(p?.id || `flw_prm_${Date.now()}_${idx}`).slice(0, 120),
    enabled: Boolean(p?.enabled ?? true),
    key: String(p?.key ?? "").slice(0, 300),
    value: String(p?.value ?? "").slice(0, 2000),
    description: String(p?.description ?? "").slice(0, 500),
    isSecret: Boolean(p?.isSecret)
  };
}

export function cloneRequestParamsForFlow(reqObj) {
  if (!reqObj || !Array.isArray(reqObj.params)) return [];
  return reqObj.params.slice(0, 80).map((p, idx) => sanitizeFlowParamRule(p, idx));
}

export function createDefaultNode(type, partial = {}) {
  const id = partial.id || generateUniqueEntityId("nd");
  const posX = Math.round(Number(partial.x ?? partial.position?.x ?? 100));
  const posY = Math.round(Number(partial.y ?? partial.position?.y ?? 140));
  const rawLabel = partial.label !== undefined ? String(partial.label) : defaultLabelForNodeType(type);
  const base = {
    id,
    type: Object.values(NODE_TYPES).includes(type) ? type : NODE_TYPES.HTTP_REQUEST,
    label: rawLabel.slice(0, 300),
    x: posX,
    y: posY,
    position: {
      x: posX,
      y: posY
    },
    config: {}
  };

  if (base.type === NODE_TYPES.HTTP_REQUEST) {
    const retriesVal = clampRetryCount(partial.config?.retries ?? partial.config?.retryCount ?? 0);
    const onSuccess = normalizePolicyValue(partial.config?.onSuccess ?? partial.config?.policies?.onSuccess ?? "follow_port");
    const onHttpError = normalizePolicyValue(partial.config?.onHttpError ?? partial.config?.policies?.onHttpError ?? "follow_port");
    const onTimeout = normalizePolicyValue(partial.config?.onTimeout ?? partial.config?.policies?.onTimeout ?? "follow_port");
    const onNetworkError = normalizePolicyValue(partial.config?.onNetworkError ?? partial.config?.policies?.onNetworkError ?? "follow_port");
    const onAssertionFailure = normalizePolicyValue(
      partial.config?.onAssertionFailure ?? partial.config?.policies?.onAssertionFailure ?? "follow_port"
    );
    const errorTargetNodeId = String(
      partial.config?.errorTargetNodeId ?? partial.config?.policies?.errorTargetNodeId ?? ""
    );

    base.config = {
      requestId: String(partial.config?.requestId ?? ""),
      retryCount: retriesVal,
      retries: retriesVal,
      useExclusiveAssertions: Boolean(partial.config?.useExclusiveAssertions),
      retryDelaySec: clampRetryDelaySec(partial.config?.retryDelaySec ?? 1),
      params: Array.isArray(partial.config?.params)
        ? partial.config.params.slice(0, 80).map(sanitizeFlowParamRule)
        : undefined,
      assertions: Array.isArray(partial.config?.assertions)
        ? partial.config.assertions.slice(0, 60).map(sanitizeAssertionRule)
        : [],
      extractions: Array.isArray(partial.config?.extractions)
        ? partial.config.extractions.slice(0, 60).map(sanitizeExtractionRule)
        : [],
      onSuccess,
      onHttpError,
      onTimeout,
      onNetworkError,
      onAssertionFailure,
      errorTargetNodeId,
      policies: {
        onSuccess,
        onHttpError,
        onTimeout,
        onNetworkError,
        onAssertionFailure,
        errorTargetNodeId
      }
    };
  } else if (base.type === NODE_TYPES.CONDITION) {
    const allowedOps = [
      "equals",
      "not_equals",
      "contains",
      "starts_with",
      "ends_with",
      "exists",
      "not_exists",
      "greater_than",
      "less_than",
      "is_empty",
      "not_empty"
    ];
    const rightVal =
      partial.config?.rightOperand !== undefined
        ? String(partial.config.rightOperand)
        : partial.config?.expected !== undefined
        ? String(partial.config.expected)
        : "200";
    const leftVal =
      partial.config?.leftOperand !== undefined
        ? String(partial.config.leftOperand)
        : partial.config?.source === "variable" && partial.config?.property
        ? `\${${partial.config.property}}`
        : "${status}";

    base.config = {
      source: ["status", "json_path", "variable", "header", "duration_ms", "expression"].includes(partial.config?.source)
        ? partial.config.source
        : partial.config?.leftOperand !== undefined
        ? "expression"
        : "status",
      property: String(partial.config?.property ?? "").slice(0, 500),
      operator: allowedOps.includes(partial.config?.operator) ? partial.config.operator : "equals",
      expected: rightVal.slice(0, 2000),
      leftOperand: leftVal.slice(0, 1000),
      rightOperand: rightVal.slice(0, 2000)
    };
  } else if (base.type === NODE_TYPES.DELAY) {
    const hasDelayMs = partial.config?.delayMs !== undefined && partial.config?.delayMs !== null;
    const delayMs = hasDelayMs
      ? Math.min(60000, Math.max(0, Number(partial.config.delayMs) || 0))
      : Math.round(clampDelayNodeSec(partial.config?.delaySec ?? 1) * 1000);
    const delaySec = clampDelayNodeSec(delayMs / 1000);
    base.config = {
      delayMs,
      delaySec,
      reason: String(partial.config?.reason ?? "Polling / Backoff").slice(0, 500)
    };
  } else if (base.type === NODE_TYPES.TRANSFORM) {
    const allowedTrfOps = [
      "template",
      "upper",
      "lower",
      "trim",
      "default_if_empty",
      "default",
      "math_add",
      "json_pick"
    ];
    const inVar = String(partial.config?.sourceVariable ?? partial.config?.inputVariable ?? "").slice(0, 500);
    const tplVal = String(partial.config?.template ?? partial.config?.templateOrValue ?? "").slice(0, 2000);
    const outVar = String(
      partial.config?.targetVariable ?? partial.config?.outputVariable ?? "transformed_var"
    ).slice(0, 500);
    base.config = {
      operation: allowedTrfOps.includes(partial.config?.operation) ? partial.config.operation : "template",
      inputVariable: inVar,
      sourceVariable: inVar,
      templateOrValue: tplVal,
      template: tplVal,
      outputVariable: outVar,
      targetVariable: outVar,
      fallbackValue: String(partial.config?.fallbackValue ?? "").slice(0, 2000),
      scope: partial.config?.scope === "runtime" ? "runtime" : "flow"
    };
  } else if (base.type === NODE_TYPES.SUBFLOW) {
    const subId = String(partial.config?.subflowId ?? partial.config?.targetFlowId ?? "").slice(0, 200);
    base.config = {
      targetFlowId: subId,
      subflowId: subId
    };
  } else if (base.type === NODE_TYPES.GROUP_NOTE) {
    base.config = {
      noteText: String(partial.config?.noteText ?? "Grupo / Anotación del flujo").slice(0, 2000),
      width: Math.min(800, Math.max(180, Number(partial.config?.width) || 280)),
      height: Math.min(600, Math.max(90, Number(partial.config?.height) || 140))
    };
  }

  return base;
}

function defaultLabelForNodeType(type) {
  switch (type) {
    case NODE_TYPES.START:
      return "Inicio";
    case NODE_TYPES.HTTP_REQUEST:
      return "Solicitud HTTP";
    case NODE_TYPES.CONDITION:
      return "Condición";
    case NODE_TYPES.DELAY:
      return "Espera / Delay";
    case NODE_TYPES.TRANSFORM:
      return "Transformación";
    case NODE_TYPES.SUBFLOW:
      return "Subflujo";
    case NODE_TYPES.GROUP_NOTE:
      return "Nota / Grupo";
    case NODE_TYPES.END_SUCCESS:
      return "Fin Exitoso";
    case NODE_TYPES.END_ERROR:
      return "Fin con Error";
    default:
      return "Nodo";
  }
}

export function sanitizeAssertionRule(a, idx = 0) {
  return {
    id: String(a?.id || `flw_ast_${Date.now()}_${idx}`).slice(0, 120),
    enabled: Boolean(a?.enabled ?? true),
    target: ["status", "json_path", "header", "body_text", "duration_ms"].includes(a?.target)
      ? a.target
      : "status",
    property: String(a?.property ?? "").slice(0, 1000),
    operator: [
      "equals",
      "not_equals",
      "contains",
      "starts_with",
      "ends_with",
      "exists",
      "not_exists",
      "less_than",
      "greater_than",
      "is_empty",
      "not_empty"
    ].includes(a?.operator)
      ? a.operator
      : "equals",
    expected: String(a?.expected !== undefined ? a.expected : "200").slice(0, 2000)
  };
}

export function sanitizeExtractionRule(ex, idx = 0) {
  const rawVar = ex?.variableName !== undefined ? String(ex.variableName) : `flow_var_${idx + 1}`;
  const rawPath = ex?.path !== undefined ? String(ex.path) : "id";
  return {
    id: String(ex?.id || `flw_ext_${Date.now()}_${idx}`).slice(0, 120),
    enabled: Boolean(ex?.enabled ?? true),
    source: ["json_path", "header", "cookie", "status"].includes(ex?.source) ? ex.source : "json_path",
    path: rawPath.slice(0, 1000),
    variableName: rawVar.slice(0, 300),
    scope: ex?.scope === "runtime" ? "runtime" : "flow",
    fallbackValue: String(ex?.fallbackValue ?? "").slice(0, 2000)
  };
}

export function sanitizeFlowVariablesArray(rawFlowVariables) {
  if (Array.isArray(rawFlowVariables)) {
    return rawFlowVariables.slice(0, 100).map((item, idx) => ({
      id: String(item?.id || `fvar_${Date.now()}_${idx}`),
      key: String(item?.key !== undefined ? item.key : `var_${idx + 1}`).slice(0, 300),
      value: String(item?.value ?? "").slice(0, 4000),
      enabled: Boolean(item?.enabled ?? true),
      isSecret: Boolean(item?.isSecret)
    }));
  }
  if (rawFlowVariables && typeof rawFlowVariables === "object") {
    const out = [];
    let idx = 0;
    for (const [k, v] of Object.entries(rawFlowVariables)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out.push({
        id: `fvar_${Date.now()}_${idx++}`,
        key: String(k).slice(0, 300),
        value: String(v ?? "").slice(0, 4000),
        enabled: true,
        isSecret: false
      });
    }
    return out;
  }
  return [];
}

export function flowVariablesToMap(flowVariables) {
  const map = {};
  if (Array.isArray(flowVariables)) {
    for (const item of flowVariables) {
      if (item && item.enabled !== false && item.key && !FORBIDDEN_KEYS.has(item.key)) {
        map[String(item.key).trim()] = String(item.value ?? "");
      }
    }
  } else if (flowVariables && typeof flowVariables === "object") {
    for (const [k, v] of Object.entries(flowVariables)) {
      if (!FORBIDDEN_KEYS.has(k) && k) {
        map[String(k).trim()] = String(v ?? "");
      }
    }
  }
  return map;
}

export function createDefaultEdge(source, sourcePort, target, targetPort = PORT_TYPES.IN, label = "") {
  return {
    id: generateUniqueEntityId("edg"),
    source: String(source),
    sourcePort: String(sourcePort || PORT_TYPES.DEFAULT),
    target: String(target),
    targetPort: String(targetPort || PORT_TYPES.IN),
    label: String(label || "").slice(0, 120)
  };
}

/**
 * Construye de forma determinista y no destructiva un grafo visual avanzado a partir
 * de los pasos secuenciales del modo básico (`selectedRequestIds` + `stepOverrides`).
 */
export function buildGraphFromBasicSteps(flow, allRequests = []) {
  const reqIds = Array.isArray(flow?.selectedRequestIds) ? flow.selectedRequestIds : [];
  const overrides = flow?.stepOverrides || {};
  const nodes = [];
  const edges = [];

  const startNode = createDefaultNode(NODE_TYPES.START, {
    id: "nd_start",
    label: "Inicio",
    position: { x: 60, y: 180 }
  });
  nodes.push(startNode);

  const endSuccessNode = createDefaultNode(NODE_TYPES.END_SUCCESS, {
    id: "nd_end_ok",
    label: "Fin Exitoso",
    position: { x: Math.max(460, 290 + reqIds.length * 250), y: 120 }
  });
  const endErrorNode = createDefaultNode(NODE_TYPES.END_ERROR, {
    id: "nd_end_err",
    label: "Fin con Error",
    position: { x: Math.max(460, 290 + reqIds.length * 250), y: 280 }
  });

  let prevNodeId = startNode.id;
  let prevPort = PORT_TYPES.DEFAULT;

  reqIds.slice(0, MAX_FLOW_NODES - 4).forEach((reqId, idx) => {
    const reqObj = allRequests.find((r) => r.id === reqId);
    const stepCfg = overrides[reqId] || {};
    const retriesVal = clampRetryCount(stepCfg.retryCount ?? stepCfg.retries ?? 0);
    const stepParams = Array.isArray(stepCfg.params)
      ? stepCfg.params.slice(0, 80).map(sanitizeFlowParamRule)
      : cloneRequestParamsForFlow(reqObj);
    const reqNode = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: `nd_req_${idx + 1}_${String(reqId).replace(/[^a-zA-Z0-9_]/g, "")}`,
      label: reqObj ? reqObj.name : `Paso ${idx + 1}`,
      position: { x: 250 + idx * 250, y: 165 },
      config: {
        requestId: reqId,
        retryCount: retriesVal,
        retries: retriesVal,
        useExclusiveAssertions: Boolean(stepCfg.useExclusiveAssertions),
        retryDelaySec: clampRetryDelaySec(stepCfg.retryDelaySec ?? 1),
        params: stepParams,
        assertions: Array.isArray(stepCfg.assertions) ? JSON.parse(JSON.stringify(stepCfg.assertions)) : [],
        extractions: Array.isArray(stepCfg.extractions) ? JSON.parse(JSON.stringify(stepCfg.extractions)) : [],
        onSuccess: "follow_port",
        onHttpError: "follow_port",
        onTimeout: "follow_port",
        onNetworkError: "follow_port",
        onAssertionFailure: "follow_port",
        errorTargetNodeId: endErrorNode.id,
        policies: {
          onSuccess: "follow_port",
          onHttpError: "follow_port",
          onTimeout: "follow_port",
          onNetworkError: "follow_port",
          onAssertionFailure: "follow_port",
          errorTargetNodeId: endErrorNode.id
        }
      }
    });
    nodes.push(reqNode);

    edges.push(createDefaultEdge(prevNodeId, prevPort, reqNode.id, PORT_TYPES.IN));
    edges.push(createDefaultEdge(reqNode.id, PORT_TYPES.FAILURE, endErrorNode.id, PORT_TYPES.IN, "error"));
    edges.push(createDefaultEdge(reqNode.id, PORT_TYPES.TIMEOUT, endErrorNode.id, PORT_TYPES.IN, "timeout"));

    prevNodeId = reqNode.id;
    prevPort = PORT_TYPES.SUCCESS;
  });

  edges.push(createDefaultEdge(prevNodeId, prevPort, endSuccessNode.id, PORT_TYPES.IN, "ok"));
  nodes.push(endSuccessNode, endErrorNode);

  return {
    nodes,
    edges,
    viewport: { x: 20, y: 20, zoom: 1 },
    settings: {
      maxIterations: 10,
      maxConcurrency: 2,
      concurrency: 2,
      defaultRetryDelaySec: 1
    }
  };
}

/**
 * Calcula un nombre único agregando sufijo consecutivo `(1)`, `(2)`, etc. cuando ya existe otro flujo con el mismo nombre.
 */
export function getNextConsecutiveFlowName(baseName, existingFlows = [], filterMode = null) {
  const cleanBase = String(baseName || "Flujo").trim();
  const pool = filterMode
    ? (existingFlows || []).filter((f) => (f?.mode === "advanced" ? "advanced" : "basic") === filterMode)
    : existingFlows || [];
  const existsName = (candidate) =>
    pool.some((f) => String(f?.name || "").trim().toLowerCase() === candidate.trim().toLowerCase());

  if (!existsName(cleanBase)) {
    return cleanBase;
  }
  let counter = 1;
  let candidate = `${cleanBase} (${counter})`;
  while (existsName(candidate)) {
    counter++;
    candidate = `${cleanBase} (${counter})`;
  }
  return candidate;
}

/**
 * Crea un NUEVO flujo avanzado independiente a partir de un flujo básico sin alterar el flujo básico original.
 * Si ya existe un flujo con el mismo nombre, agrega un identificador consecutivo: ej. `Flujo 1 (1)`, `Flujo 1 (2)`.
 */
export function createIndependentAdvancedFlowFromBasic(basicFlow, existingFlows = [], allRequests = []) {
  if (!basicFlow) return null;
  const baseName = String(basicFlow.name || "Flujo").trim();
  const hasAdvancedSameName = (existingFlows || []).some(
    (f) => f && f.mode === "advanced" && String(f.name || "").trim().toLowerCase() === baseName.toLowerCase()
  );
  const newName = hasAdvancedSameName
    ? getNextConsecutiveFlowName(baseName, existingFlows, null)
    : baseName;

  const builtGraph = buildGraphFromBasicSteps(basicFlow, allRequests);
  return migrateFlowToV2(
    {
      id: generateUniqueEntityId("flw_adv"),
      name: newName,
      mode: "advanced",
      selectedRequestIds: [],
      stepOverrides: {},
      graph: builtGraph,
      flowVariables: sanitizeFlowVariablesArray(basicFlow.flowVariables),
      lastReport: null,
      executionHistory: [],
      undoStack: [],
      redoStack: []
    },
    allRequests
  );
}

/**
 * Convierte el objeto de flujo proporcionado a grafo avanzado (mantenido por compatibilidad con suite unitaria).
 */
export function convertBasicFlowToAdvancedGraph(flow, allRequests = []) {
  if (!flow) return null;
  pushFlowHistorySnapshot(flow);
  flow.graph = buildGraphFromBasicSteps(flow, allRequests);
  flow.mode = "advanced";
  flow.schemaVersion = FLOW_SCHEMA_VERSION;
  return flow;
}

export function syncBasicStepsFromGraph(flow) {
  if (!flow || !flow.graph || !Array.isArray(flow.graph.nodes)) return;
  const httpNodes = flow.graph.nodes
    .filter((n) => n.type === NODE_TYPES.HTTP_REQUEST && n.config?.requestId)
    .sort((a, b) => (a.position?.x || 0) - (b.position?.x || 0));
  if (httpNodes.length > 0) {
    flow.selectedRequestIds = httpNodes.map((n) => n.config.requestId);
    flow.stepOverrides = flow.stepOverrides || {};
    for (const n of httpNodes) {
      const rCount = clampRetryCount(n.config.retryCount ?? n.config.retries ?? 0);
      flow.stepOverrides[n.config.requestId] = {
        retryCount: rCount,
        retries: rCount,
        useExclusiveAssertions: Boolean(n.config.useExclusiveAssertions),
        retryDelaySec: clampRetryDelaySec(n.config.retryDelaySec),
        params: Array.isArray(n.config.params)
          ? JSON.parse(JSON.stringify(n.config.params))
          : undefined,
        assertions: JSON.parse(JSON.stringify(n.config.assertions || [])),
        extractions: JSON.parse(JSON.stringify(n.config.extractions || []))
      };
    }
  }
}

/**
 * Migra de forma no destructiva cualquier flujo v1 o v2 hacia la estructura validada de `schemaVersion: 2`,
 * preservando `undoStack`, `redoStack`, `flowVariables` independientes y configuraciones de cada nodo.
 */
export function migrateFlowToV2(rawFlow, allRequests = []) {
  const sanitized = safeCloneAndSanitizeObject(rawFlow) || {};
  const id = String(sanitized.id || generateUniqueEntityId("flw")).slice(0, 120);
  const name = String(sanitized.name !== undefined ? sanitized.name : "Flujo API").slice(0, 300);
  const mode = sanitized.mode === "advanced" ? "advanced" : "basic";
  const selectedRequestIds = Array.isArray(sanitized.selectedRequestIds)
    ? sanitized.selectedRequestIds.slice(0, MAX_FLOW_NODES).map((r) => String(r))
    : [];

  const stepOverrides = {};
  if (sanitized.stepOverrides && typeof sanitized.stepOverrides === "object") {
    for (const [reqId, ov] of Object.entries(sanitized.stepOverrides)) {
      if (FORBIDDEN_KEYS.has(reqId)) continue;
      const rVal = clampRetryCount(ov?.retries ?? ov?.retryCount ?? 0);
      const reqObj = allRequests.find((r) => r.id === reqId);
      stepOverrides[reqId] = {
        retryCount: rVal,
        retries: rVal,
        useExclusiveAssertions: Boolean(ov?.useExclusiveAssertions),
        retryDelaySec: clampRetryDelaySec(ov?.retryDelaySec ?? 1),
        params: Array.isArray(ov?.params)
          ? ov.params.slice(0, 80).map(sanitizeFlowParamRule)
          : reqObj
          ? cloneRequestParamsForFlow(reqObj)
          : undefined,
        assertions: Array.isArray(ov?.assertions)
          ? ov.assertions.slice(0, 60).map(sanitizeAssertionRule)
          : [],
        extractions: Array.isArray(ov?.extractions)
          ? ov.extractions.slice(0, 60).map(sanitizeExtractionRule)
          : []
      };
    }
  }

  for (const reqId of selectedRequestIds) {
    if (!stepOverrides[reqId]) {
      const reqObj = allRequests.find((r) => r.id === reqId);
      if (reqObj) {
        stepOverrides[reqId] = {
          retryCount: 0,
          retries: 0,
          useExclusiveAssertions: false,
          retryDelaySec: 1,
          params: cloneRequestParamsForFlow(reqObj),
          assertions: [],
          extractions: []
        };
      }
    }
  }

  let graph = null;
  if (
    sanitized.graph &&
    typeof sanitized.graph === "object" &&
    Array.isArray(sanitized.graph.nodes) &&
    sanitized.graph.nodes.length > 0
  ) {
    const cleanNodes = sanitized.graph.nodes
      .slice(0, MAX_FLOW_NODES)
      .map((n) => {
        const created = createDefaultNode(n?.type || NODE_TYPES.HTTP_REQUEST, n);
        if (
          created.type === NODE_TYPES.HTTP_REQUEST &&
          !Array.isArray(created.config.params) &&
          created.config.requestId
        ) {
          const reqObj = allRequests.find((r) => r.id === created.config.requestId);
          if (reqObj) {
            created.config.params = cloneRequestParamsForFlow(reqObj);
          }
        }
        return created;
      });
    const validNodeIds = new Set(cleanNodes.map((n) => n.id));
    const cleanEdges = Array.isArray(sanitized.graph.edges)
      ? sanitized.graph.edges
          .slice(0, MAX_FLOW_EDGES)
          .filter((e) => e && validNodeIds.has(String(e.source)) && validNodeIds.has(String(e.target)))
          .map((e) => ({
            id: String(e.id || generateUniqueEntityId("edg")).slice(0, 120),
            source: String(e.source),
            sourcePort: String(e.sourcePort || PORT_TYPES.DEFAULT),
            target: String(e.target),
            targetPort: String(e.targetPort || PORT_TYPES.IN),
            label: String(e.label !== undefined ? e.label : "").slice(0, 120)
          }))
      : [];

    const maxConc = Math.max(
      1,
      Math.min(6, Number(sanitized.graph.settings?.maxConcurrency ?? sanitized.graph.settings?.concurrency) || 2)
    );
    graph = {
      nodes: cleanNodes,
      edges: cleanEdges,
      viewport: {
        x: Math.max(-2000, Math.min(2000, Number(sanitized.graph.viewport?.x) || 20)),
        y: Math.max(-2000, Math.min(2000, Number(sanitized.graph.viewport?.y) || 20)),
        zoom: Math.max(0.4, Math.min(1.8, Number(sanitized.graph.viewport?.zoom) || 1))
      },
      settings: {
        maxIterations: Math.max(1, Math.min(100, Number(sanitized.graph.settings?.maxIterations) || 10)),
        maxConcurrency: maxConc,
        concurrency: maxConc,
        defaultRetryDelaySec: clampRetryDelaySec(sanitized.graph.settings?.defaultRetryDelaySec ?? 1)
      }
    };
  } else if (mode === "advanced") {
    graph = buildGraphFromBasicSteps({ selectedRequestIds, stepOverrides }, allRequests);
  }

  const flowVariables = sanitizeFlowVariablesArray(sanitized.flowVariables);

  const executionHistory = Array.isArray(sanitized.executionHistory)
    ? sanitized.executionHistory.slice(0, MAX_FLOW_HISTORY_RUNS)
    : [];

  const undoStack = Array.isArray(sanitized.undoStack)
    ? sanitized.undoStack.filter((s) => typeof s === "string").slice(-MAX_FLOW_UNDO_STACK)
    : [];
  const redoStack = Array.isArray(sanitized.redoStack)
    ? sanitized.redoStack.filter((s) => typeof s === "string").slice(-MAX_FLOW_UNDO_STACK)
    : [];

  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    kind: "eltransportador.flow",
    id,
    name,
    mode,
    selectedRequestIds,
    stepOverrides,
    graph,
    flowVariables,
    lastReport: sanitized.lastReport || null,
    executionHistory,
    undoStack,
    redoStack
  };
}

export function pushFlowHistorySnapshot(flow) {
  if (!flow || !flow.graph) return;
  flow.undoStack = Array.isArray(flow.undoStack) ? flow.undoStack : [];
  flow.redoStack = Array.isArray(flow.redoStack) ? flow.redoStack : [];
  const snapshot = JSON.stringify({
    nodes: flow.graph.nodes,
    edges: flow.graph.edges,
    settings: flow.graph.settings
  });
  if (flow.undoStack.length > 0 && flow.undoStack[flow.undoStack.length - 1] === snapshot) {
    return;
  }
  flow.undoStack.push(snapshot);
  if (flow.undoStack.length > MAX_FLOW_UNDO_STACK) {
    flow.undoStack.shift();
  }
  flow.redoStack = [];
}

export function undoFlowGraphChange(flow) {
  if (!flow || !flow.graph || !Array.isArray(flow.undoStack) || flow.undoStack.length === 0) return false;
  flow.redoStack = Array.isArray(flow.redoStack) ? flow.redoStack : [];
  const currentSnap = JSON.stringify({
    nodes: flow.graph.nodes,
    edges: flow.graph.edges,
    settings: flow.graph.settings
  });
  flow.redoStack.push(currentSnap);
  const prevSnap = JSON.parse(flow.undoStack.pop());
  flow.graph.nodes = prevSnap.nodes || [];
  flow.graph.edges = prevSnap.edges || [];
  if (prevSnap.settings) flow.graph.settings = prevSnap.settings;
  return true;
}

export function redoFlowGraphChange(flow) {
  if (!flow || !flow.graph || !Array.isArray(flow.redoStack) || flow.redoStack.length === 0) return false;
  flow.undoStack = Array.isArray(flow.undoStack) ? flow.undoStack : [];
  const currentSnap = JSON.stringify({
    nodes: flow.graph.nodes,
    edges: flow.graph.edges,
    settings: flow.graph.settings
  });
  flow.undoStack.push(currentSnap);
  const nextSnap = JSON.parse(flow.redoStack.pop());
  flow.graph.nodes = nextSnap.nodes || [];
  flow.graph.edges = nextSnap.edges || [];
  if (nextSnap.settings) flow.graph.settings = nextSnap.settings;
  return true;
}
