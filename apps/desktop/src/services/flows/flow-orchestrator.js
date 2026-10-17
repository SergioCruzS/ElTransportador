/**
 * Orquestador y Motor de Ejecución Observable de Flujos (Modo Básico + Máquina de Estados Avanzada) — ElTransportador v1.2.0
 * Archivo: apps/desktop/src/services/flows/flow-orchestrator.js
 *
 * Garantías de Seguridad y Rendimiento:
 * - Cero evaluación de código arbitrario (`eval` / `new Function` prohibidos).
 * - Condiciones, extracciones y transformaciones 100% declarativas y acotadas.
 * - Redacción universal de secretos (`maskSecretsInString`) en variables visibles, reportes, diagnósticos e historial.
 * - Soporte de reintentos configurables (0, 1, 3, 5), esperas validadas, concurrencia paralela real por lotes (1 a 6), pausa, cancelación y simulación.
 */
import {
  NODE_TYPES,
  PORT_TYPES,
  NODE_EXEC_STATES,
  MAX_FLOW_HISTORY_RUNS,
  clampRetryCount,
  clampRetryDelaySec,
  clampDelayNodeSec,
  normalizePolicyValue,
  flowVariablesToMap
} from "./flow-schema.js";
import { validateFlowGraph } from "./flow-validator.js";
import {
  executeSingleRequestObject,
  localizeResponseForLang,
  getByDotPath,
  evaluateAssertions,
  resolveVariablesInString,
  buildFullResolvedUrlWithParams,
  maskSecretsInString
} from "../http/index.js";
import { REDACTED } from "../storage/constants.js";

/**
 * Evalúa una condición declarativa sin usar `eval`.
 */
export function evaluateDeclarativeCondition(config, context = {}, extraFlowVars = null) {
  if (extraFlowVars || (context && context.collections && !context.state)) {
    context = { state: context, flowVars: extraFlowVars || {}, lastResponse: context.lastResponse };
  }
  const src = config?.leftOperand ? "expression" : (config?.source || "status");
  const prop = String(config?.property || "").trim();
  const op = config?.operator || "equals";
  const rawExpected = String(config?.rightOperand ?? config?.expected ?? "");
  const tempState = context.state
    ? { ...context.state, runtimeVars: { ...(context.state.runtimeVars || {}), ...(context.flowVars || {}) } }
    : { runtimeVars: context.flowVars || {}, collections: [], environments: [], secretVault: {} };
  const expected = resolveVariablesInString(rawExpected, tempState).text;

  const lastResp = context.lastResponse || {};
  let actual = undefined;

  if (src === "status") {
    actual = lastResp.status !== undefined ? String(lastResp.status) : undefined;
  } else if (src === "duration_ms") {
    actual = lastResp.durationMs !== undefined ? String(lastResp.durationMs) : undefined;
  } else if (src === "header") {
    const hdrs = lastResp.headers || {};
    const lowerKey = prop.toLowerCase();
    for (const [k, v] of Object.entries(hdrs)) {
      if (k.toLowerCase() === lowerKey) {
        actual = String(v);
        break;
      }
    }
  } else if (src === "json_path") {
    let bodyObj = lastResp.bodyObj;
    if (!bodyObj && typeof lastResp.body === "string" && lastResp.body.trim()) {
      try {
        bodyObj = JSON.parse(lastResp.body);
      } catch {}
    }
    const val = getByDotPath(bodyObj, prop);
    actual = val === undefined || val === null ? undefined : typeof val === "object" ? JSON.stringify(val) : String(val);
  } else if (src === "variable") {
    if (context.flowVars && context.flowVars[prop] !== undefined) {
      actual = String(context.flowVars[prop]);
    } else if (context.state?.runtimeVars && context.state.runtimeVars[prop] !== undefined) {
      actual = String(context.state.runtimeVars[prop]);
    }
  } else if (src === "expression" || config?.leftOperand) {
    const leftContextVars = {
      status: lastResp.status !== undefined ? String(lastResp.status) : "",
      duration_ms: lastResp.durationMs !== undefined ? String(lastResp.durationMs) : "",
      ...(context.state?.runtimeVars || {}),
      ...(context.flowVars || {})
    };
    const exprState = context.state
      ? { ...context.state, runtimeVars: leftContextVars }
      : { runtimeVars: leftContextVars, collections: [], environments: [], secretVault: {} };
    const resolvedLeft = resolveVariablesInString(String(config?.leftOperand || ""), exprState);
    actual = resolvedLeft.unresolved.length > 0 ? undefined : resolvedLeft.text;
  }

  let passed = false;
  const actualStr = actual === undefined ? "" : String(actual);
  switch (op) {
    case "equals":
      passed = actual !== undefined && actualStr === expected;
      break;
    case "not_equals":
      passed = actualStr !== expected;
      break;
    case "contains":
      passed = actual !== undefined && actualStr.includes(expected);
      break;
    case "starts_with":
      passed = actual !== undefined && actualStr.startsWith(expected);
      break;
    case "ends_with":
      passed = actual !== undefined && actualStr.endsWith(expected);
      break;
    case "exists":
    case "not_empty":
      passed = actual !== undefined && actualStr !== "";
      break;
    case "not_exists":
    case "is_empty":
      passed = actual === undefined || actualStr === "";
      break;
    case "greater_than":
      passed = actual !== undefined && Number(actualStr) > Number(expected);
      break;
    case "less_than":
      passed = actual !== undefined && Number(actualStr) < Number(expected);
      break;
    default:
      passed = actualStr === expected;
  }

  return {
    passed,
    result: passed,
    source: src,
    property: prop,
    operator: op,
    expected,
    actual: actual === undefined ? "<undefined>" : actualStr
  };
}

/**
 * Ejecuta una transformación declarativa segura sin evaluar código arbitrario.
 */
export function executeDeclarativeTransform(config, context = {}) {
  const op = config?.operation || "template";
  const inVar = String(config?.inputVariable || config?.sourceVariable || "").trim();
  const outVar = String(config?.outputVariable || config?.targetVariable || "transformed_var")
    .trim()
    .replace(/[^a-zA-Z0-9_.\-]/g, "_");
  const scope = config?.scope === "runtime" ? "runtime" : "flow";
  const rawTpl = String(config?.templateOrValue || config?.template || "");
  const fallbackVal = String(config?.fallbackValue || "");

  const readVar = (name) => {
    if (!name) return "";
    if (context.flowVars && context.flowVars[name] !== undefined) return String(context.flowVars[name]);
    if (context.state?.runtimeVars && context.state.runtimeVars[name] !== undefined) {
      return String(context.state.runtimeVars[name]);
    }
    return "";
  };

  const baseVal = readVar(inVar);
  let resultVal = "";

  if (op === "upper") {
    resultVal = (baseVal || rawTpl || fallbackVal).toUpperCase();
  } else if (op === "lower") {
    resultVal = (baseVal || rawTpl || fallbackVal).toLowerCase();
  } else if (op === "trim") {
    resultVal = (baseVal || rawTpl || fallbackVal).trim();
  } else if (op === "default_if_empty" || op === "default") {
    resultVal = baseVal !== "" ? baseVal : (rawTpl || fallbackVal);
  } else if (op === "math_add") {
    const numA = Number(baseVal || 0);
    const numB = Number(rawTpl || 1);
    resultVal = String((Number.isFinite(numA) ? numA : 0) + (Number.isFinite(numB) ? numB : 0));
  } else {
    const tempState = context.state
      ? {
          ...context.state,
          runtimeVars: { ...(context.state.runtimeVars || {}), ...(context.flowVars || {}) }
        }
      : { runtimeVars: context.flowVars || {}, collections: [], environments: [], secretVault: {} };
    resultVal = resolveVariablesInString(rawTpl || baseVal || fallbackVal, tempState).text;
  }

  if (resultVal === "" && fallbackVal !== "") {
    resultVal = fallbackVal;
  }

  if (context.flowVars) {
    context.flowVars[outVar] = resultVal;
  }
  if (scope === "runtime" && context.state?.runtimeVars) {
    context.state.runtimeVars[outVar] = resultVal;
  }

  return {
    outputVariable: outVar,
    value: resultVal,
    scope
  };
}

/**
 * Extrae variables declarativas desde una respuesta HTTP hacia `flowVars` y/o `state.runtimeVars`.
 */
export function applyDeclarativeExtractions(extractions, resp, flowVars, state) {
  const produced = {};
  let parsedObj = resp?.bodyObj || null;
  if (!parsedObj && typeof resp?.body === "string" && resp.body.trim()) {
    try {
      parsedObj = JSON.parse(resp.body);
    } catch {}
  }

  for (const ext of extractions || []) {
    if (!ext || !ext.enabled || !ext.variableName) continue;
    const varName = String(ext.variableName).trim();
    const src = ext.source || "json_path";
    let rawVal = undefined;

    if (src === "status") {
      rawVal = resp?.status !== undefined ? String(resp.status) : undefined;
    } else if (src === "header") {
      const targetKey = String(ext.path || "").toLowerCase();
      for (const [hk, hv] of Object.entries(resp?.headers || {})) {
        if (hk.toLowerCase() === targetKey) {
          rawVal = String(hv);
          break;
        }
      }
    } else if (src === "cookie") {
      const targetCookie = String(ext.path || "").toLowerCase();
      const foundCookie = (resp?.cookies || []).find(
        (c) => String(c?.name || "").toLowerCase() === targetCookie
      );
      if (foundCookie) rawVal = String(foundCookie.value || "");
    } else {
      const v = getByDotPath(parsedObj, ext.path || "");
      if (v !== undefined && v !== null) {
        rawVal = typeof v === "object" ? JSON.stringify(v) : String(v);
      }
    }

    if (rawVal === undefined && ext.fallbackValue !== undefined && ext.fallbackValue !== "") {
      rawVal = String(ext.fallbackValue);
    }

    if (rawVal !== undefined) {
      produced[varName] = rawVal;
      if (flowVars) flowVars[varName] = rawVal;
      if (state?.runtimeVars) {
        state.runtimeVars[varName] = rawVal;
      }
    }
  }
  return produced;
}

/**
 * Sanitiza un mapa de variables redactando cualquier valor secreto.
 */
export function sanitizeVariablesMap(varsMap, state) {
  const out = {};
  for (const [k, v] of Object.entries(varsMap || {})) {
    const strVal = String(v ?? "");
    const masked = maskSecretsInString(strVal, state);
    if (/secret|password|token|apikey|api_key/i.test(k) && strVal.length > 0 && masked === strVal) {
      out[k] = REDACTED;
    } else {
      out[k] = masked;
    }
  }
  return out;
}

/**
 * Sanitiza una respuesta HTTP para que jamás contenga secretos en texto plano en reportes o diagnósticos.
 */
export function sanitizeResponseForFlowReport(resp, state) {
  if (!resp || typeof resp !== "object") return null;
  const cleanHeaders = {};
  for (const [k, v] of Object.entries(resp.headers || {})) {
    if (/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(k.trim())) {
      cleanHeaders[k] = REDACTED;
    } else {
      cleanHeaders[k] = maskSecretsInString(String(v || ""), state);
    }
  }
  const cleanCookies = (resp.cookies || []).map((c) => ({
    ...c,
    value: REDACTED
  }));
  const rawBody = String(resp.body || "").slice(0, 15000);
  return {
    status: Number(resp.status) || 0,
    statusText: String(resp.statusText || ""),
    durationMs: Number(resp.durationMs) || 0,
    sizeBytes: Number(resp.sizeBytes) || 0,
    headers: cleanHeaders,
    cookies: cleanCookies,
    body: maskSecretsInString(rawBody, state),
    isJson: Boolean(resp.isJson),
    error: resp.error ? { ...resp.error, message: maskSecretsInString(String(resp.error.message || ""), state) } : null
  };
}

function buildHumanFailureReason(stepExec, resp, reqName, nodeLabel) {
  if (!stepExec || stepExec.passed) return null;
  const status = resp?.status ?? 0;
  const failedAst = (resp?.assertionResults || []).filter((a) => !a.passed);
  if (stepExec.failureKind === "timeout") {
    return `Tiempo de espera agotado (Timeout) en «${nodeLabel || reqName}»`;
  }
  if (stepExec.failureKind === "network_error") {
    const detail = resp?.error?.message || resp?.statusText || "URL vacía, inválida o servidor inalcanzable";
    return `Error de red o URL en «${nodeLabel || reqName}»: ${detail}`;
  }
  if (stepExec.failureKind === "http_error") {
    return `Código de error HTTP ${status} (${resp?.statusText || "Error"}) en «${nodeLabel || reqName}»`;
  }
  if (stepExec.failureKind === "assertion_failure" && failedAst.length > 0) {
    return `Aserción fallida en «${nodeLabel || reqName}»: ${failedAst.map((a) => a.message).join("; ")}`;
  }
  return `Fallo en «${nodeLabel || reqName}» (HTTP ${status})`;
}

function sleepControllable(ms, controller) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (controller) {
      controller._onCancelCallbacks = controller._onCancelCallbacks || [];
      controller._onCancelCallbacks.push(() => {
        clearTimeout(timer);
        resolve();
      });
    }
  });
}

async function waitWhilePaused(controller) {
  while (controller && controller.paused && !controller.cancelled) {
    await new Promise((r) => setTimeout(r, 40));
  }
}

/**
 * Controlador de ejecución observable para pausar, reanudar o cancelar un flujo en curso.
 */
export function createFlowExecutionController() {
  return {
    paused: false,
    cancelled: false,
    _onCancelCallbacks: [],
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
    cancel() {
      this.cancelled = true;
      this.paused = false;
      for (const cb of this._onCancelCallbacks || []) {
        try {
          cb();
        } catch {}
      }
    }
  };
}

/**
 * Ejecuta una solicitud HTTP combinando sus parámetros (`flowParams`), aserciones y extracciones
 * EXCLUSIVAS del flujo (sin mutar jamás el endpoint original en la colección)
 * y aplicando la política de reintentos (`0, 1, 3, 5`).
 */
export async function executeRequestStepWithRetries({
  baseRequest,
  flowParams = null,
  useExclusiveAssertions = false,
  flowAssertions = [],
  flowExtractions = [],
  retryCount = 0,
  retryDelaySec = 1,
  state,
  flowVars,
  executorFn = null,
  controller = null,
  delayScale = 1,
  onAttemptUpdate = null
}) {
  const maxRetries = clampRetryCount(retryCount);
  const waitSec = clampRetryDelaySec(retryDelaySec);
  const totalAttemptsAllowed = 1 + maxRetries;
  const runRequest = executorFn || executeSingleRequestObject;

  // Clonar el endpoint sin mutar el original de la colección
  const clonedReq = JSON.parse(JSON.stringify(baseRequest));
  if (Array.isArray(flowParams)) {
    clonedReq.params = JSON.parse(JSON.stringify(flowParams));
  }
  const activeFlowAssertions = Array.isArray(flowAssertions) ? flowAssertions : [];
  const combinedAssertions = useExclusiveAssertions
    ? activeFlowAssertions
    : [
        ...(Array.isArray(clonedReq.assertions) ? clonedReq.assertions : []),
        ...activeFlowAssertions
      ];
  clonedReq.assertions = combinedAssertions;

  let attempt = 0;
  let lastResp = null;
  let passed = false;
  let failureKind = null; // "http_error" | "timeout" | "network_error" | "assertion_failure"
  let totalDurationMs = 0;

  while (attempt < totalAttemptsAllowed) {
    if (controller?.cancelled) break;
    await waitWhilePaused(controller);
    if (controller?.cancelled) break;

    attempt++;
    if (typeof onAttemptUpdate === "function") {
      onAttemptUpdate({
        attempt,
        maxAttempts: totalAttemptsAllowed,
        isRetry: attempt > 1
      });
    }

    // Crear un contexto de ejecución aislado para evitar colisiones en ejecuciones paralelas
    const stepState = {
      ...state,
      runtimeVars: { ...(state.runtimeVars || {}), ...(flowVars || {}) }
    };

    const resp = await runRequest(clonedReq, stepState);
    if (stepState.runtimeVars && state.runtimeVars) {
      Object.assign(state.runtimeVars, stepState.runtimeVars);
    }
    totalDurationMs += Number(resp.durationMs) || 0;

    // Evaluar aserciones combinadas
    let bodyObj = null;
    if (resp.body && typeof resp.body === "string") {
      try {
        bodyObj = JSON.parse(resp.body);
      } catch {}
    }
    const assertionResults = evaluateAssertions(
      combinedAssertions,
      {
        status: resp.status,
        durationMs: resp.durationMs,
        headers: resp.headers || {},
        body: resp.body || "",
        bodyObj
      },
      state.lang || "es"
    );
    resp.assertionResults = assertionResults;
    resp.bodyObj = bodyObj;

    const assertionsAllPassed = assertionResults.every((a) => a.passed);
    const isTimeout =
      resp.error?.code === "TIMEOUT" ||
      /timeout|timed out|abort/i.test(String(resp.error?.message || resp.statusText || ""));
    const isNetworkError = resp.status === 0 && !isTimeout;
    const isHttpError = resp.status >= 400;

    if (isTimeout) failureKind = "timeout";
    else if (isNetworkError) failureKind = "network_error";
    else if (isHttpError) failureKind = "http_error";
    else if (!assertionsAllPassed) failureKind = "assertion_failure";
    else failureKind = null;

    passed = failureKind === null;
    lastResp = resp;

    if (passed || attempt >= totalAttemptsAllowed) {
      break;
    }

    // Esperar antes del siguiente reintento
    const waitMs = Math.round(waitSec * 1000 * delayScale);
    if (waitMs > 0) {
      await sleepControllable(waitMs, controller);
    }
  }

  const allExtractions = [
    ...(Array.isArray(baseRequest.extractions) ? baseRequest.extractions : []),
    ...(Array.isArray(flowExtractions) ? flowExtractions : [])
  ];
  const extractedVars = lastResp
    ? applyDeclarativeExtractions(allExtractions, lastResp, flowVars, state)
    : {};

  return {
    response: lastResp,
    passed,
    failureKind,
    attemptsUsed: attempt,
    retriesPerformed: Math.max(0, attempt - 1),
    maxAttempts: totalAttemptsAllowed,
    totalDurationMs,
    extractedVariables: extractedVars
  };
}

/**
 * Ejecuta un flujo en Modo Básico respetando `selectedRequestIds` y `stepOverrides`
 * (parámetros, aserciones, extracciones y reintentos exclusivos del flujo sin tocar la colección).
 */
export async function executeBasicFlow(flow, allRequests, state, options = {}) {
  if (!Array.isArray(allRequests) && allRequests && typeof allRequests === "object") {
    options = state || {};
    state = allRequests;
    allRequests = [];
    for (const col of state.collections || []) {
      for (const r of col.requests || []) allRequests.push(r);
    }
  }
  const orderedReqs = (flow.selectedRequestIds || [])
    .map((id) => allRequests.find((r) => r.id === id))
    .filter(Boolean);

  const flowVars = flowVariablesToMap(flow.flowVariables);
  const steps = [];
  let passedAssertions = 0;
  let totalAssertions = 0;
  let totalDurationMs = 0;

  for (let i = 0; i < orderedReqs.length; i++) {
    const req = orderedReqs[i];
    const ov = flow.stepOverrides?.[req.id] || {};
    const stepParams = Array.isArray(ov.params) ? ov.params : null;
    const stepExec = await executeRequestStepWithRetries({
      baseRequest: req,
      flowParams: stepParams,
      useExclusiveAssertions: Boolean(ov.useExclusiveAssertions),
      flowAssertions: ov.assertions || [],
      flowExtractions: ov.extractions || [],
      retryCount: ov.retryCount ?? ov.retries ?? 0,
      retryDelaySec: ov.retryDelaySec ?? 1,
      state,
      flowVars,
      executorFn: options.executorFn || null,
      controller: options.controller || null,
      delayScale: options.delayScale ?? 1
    });

    const r = stepExec.response;
    if (r) {
      state.responsesByReqId[req.id] = r;
    }
    totalDurationMs += stepExec.totalDurationMs;

    for (const a of r?.assertionResults || []) {
      totalAssertions++;
      if (a.passed) passedAssertions++;
    }

    const tempState = {
      ...state,
      runtimeVars: { ...(state?.runtimeVars || {}), ...flowVars }
    };
    const effectiveReq = stepParams ? { ...req, params: stepParams } : req;
    const resolvedUrlInfo = buildFullResolvedUrlWithParams(effectiveReq, tempState);
    const humanReason = buildHumanFailureReason(stepExec, r, req.name, `Paso ${i + 1}: ${req.name}`);

    steps.push({
      stepIndex: i + 1,
      requestId: req.id,
      requestName: req.name,
      nodeLabel: `Paso ${i + 1}: ${req.name}`,
      method: req.method,
      url: maskSecretsInString(resolvedUrlInfo.text, state),
      resolvedUrl: maskSecretsInString(resolvedUrlInfo.text, state),
      status: r?.status ?? 0,
      durationMs: stepExec.totalDurationMs,
      attempts: stepExec.attemptsUsed,
      attemptsUsed: stepExec.attemptsUsed,
      maxAttempts: stepExec.maxAttempts,
      retriesPerformed: stepExec.retriesPerformed,
      passed: stepExec.passed,
      execState: stepExec.passed ? NODE_EXEC_STATES.SUCCESS : NODE_EXEC_STATES.FAILED,
      nodeExecStatus: stepExec.passed ? NODE_EXEC_STATES.SUCCESS : NODE_EXEC_STATES.FAILED,
      failureKind: stepExec.failureKind,
      failureReason: humanReason ? maskSecretsInString(humanReason, state) : null,
      error: humanReason ? { code: stepExec.failureKind || "STEP_FAILED", message: maskSecretsInString(humanReason, state) } : null,
      assertionResults: r?.assertionResults || [],
      extractedVariables: sanitizeVariablesMap(stepExec.extractedVariables, state),
      responsePreview: sanitizeResponseForFlowReport(r, state)
    });
  }

  const firstFailedStep = steps.find((s) => !s.passed) || null;
  const report = {
    runId: "run_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    mode: "basic",
    timestamp: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    totalRequests: steps.length,
    totalAssertions,
    passedAssertions,
    totalDurationMs,
    allPassed: steps.length > 0 && steps.every((s) => s.passed),
    failedNodeLabel: firstFailedStep ? firstFailedStep.nodeLabel : null,
    failureReason: firstFailedStep ? firstFailedStep.failureReason : null,
    steps,
    finalFlowVariables: sanitizeVariablesMap(flowVars, state)
  };

  flow.lastReport = report;
  recordExecutionInFlowHistory(flow, report);
  return report;
}

/**
 * Ejecuta o simula el grafo de un flujo en Modo Avanzado como una máquina de estados observable.
 */
export async function executeAdvancedFlowGraph(flow, allRequests, state, options = {}) {
  if (!Array.isArray(allRequests) && allRequests && typeof allRequests === "object") {
    options = state || {};
    state = allRequests;
    allRequests = [];
    for (const col of state.collections || []) {
      for (const r of col.requests || []) allRequests.push(r);
    }
  }
  const simulateOnly = Boolean(options.simulateOnly);
  const controller = options.controller || createFlowExecutionController();
  const delayScale = options.delayScale ?? 1;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const subflowDepth = Number(options.subflowDepth || 0);
  const singleTargetNodeId = options.onlyNodeId || options.retrySingleNodeId || null;

  const validation = validateFlowGraph(flow, allRequests, state);
  if (!validation.valid && !singleTargetNodeId) {
    return {
      ok: false,
      validation,
      report: null
    };
  }

  const nodes = flow.graph?.nodes || [];
  const edges = flow.graph?.edges || [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const requestMap = new Map(allRequests.map((r) => [r.id, r]));

  const maxIterations = Math.max(1, Math.min(100, Number(flow.graph?.settings?.maxIterations) || 10));
  const maxConcurrency = Math.max(
    1,
    Math.min(6, Number(flow.graph?.settings?.maxConcurrency ?? flow.graph?.settings?.concurrency) || 2)
  );

  const nodeStates = {};
  for (const n of nodes) {
    if (n.type !== NODE_TYPES.GROUP_NOTE) {
      nodeStates[n.id] = {
        status: NODE_EXEC_STATES.PENDING,
        attempt: 0,
        maxAttempts: 1,
        durationMs: 0,
        visits: 0,
        lastTransitionPort: null,
        error: null
      };
    }
  }

  const takenEdgeIds = new Set();
  const visitCounts = new Map();
  const flowVars = flowVariablesToMap(flow.flowVariables);
  const stepLogs = [];
  let lastHttpResponse = null;
  let failedNodeId = null;
  let failedNodeLabel = null;
  let failedEdgeId = null;
  let lastFailureReason = null;
  const handledFailedNodes = [];
  let terminalOutcome = null; // "success" | "error"
  let totalAssertions = 0;
  let passedAssertions = 0;
  const startTime = performance.now();

  const notify = (activeNodeId = null) => {
    if (onProgress) {
      onProgress({
        activeNodeId,
        nodeStates: JSON.parse(JSON.stringify(nodeStates)),
        takenEdgeIds: Array.from(takenEdgeIds),
        failedNodeId,
        failedEdgeId,
        stepLogs: stepLogs.slice(),
        flowVars: sanitizeVariablesMap(flowVars, state)
      });
    }
  };

  // Determinar nodo inicial
  let entryNodeIds = [];
  if (singleTargetNodeId && nodeMap.has(singleTargetNodeId)) {
    entryNodeIds = [singleTargetNodeId];
  } else if (options.startFromNodeId && nodeMap.has(options.startFromNodeId)) {
    entryNodeIds = [options.startFromNodeId];
  } else {
    const startNode = nodes.find((n) => n.type === NODE_TYPES.START);
    if (startNode) entryNodeIds = [startNode.id];
  }

  let currentFrontier = entryNodeIds.map((id) => ({ nodeId: id, viaEdgeId: null }));
  let totalStepsExecuted = 0;
  const maxTotalStepsGuard = Math.min(400, nodes.length * maxIterations + 25);

  while (currentFrontier.length > 0 && totalStepsExecuted < maxTotalStepsGuard) {
    if (controller.cancelled) break;
    await waitWhilePaused(controller);
    if (controller.cancelled) break;

    // Tomar hasta `maxConcurrency` nodos listos para ejecutarse simultáneamente en paralelo
    const batch = currentFrontier.splice(0, maxConcurrency);
    for (const item of batch) {
      if (nodeStates[item.nodeId]) {
        nodeStates[item.nodeId].status = NODE_EXEC_STATES.QUEUED;
        if (typeof options.onNodeStateChange === "function") {
          options.onNodeStateChange(item.nodeId, NODE_EXEC_STATES.QUEUED, { attempt: 1, maxAttempts: 1 });
        }
      }
    }
    notify(batch[0]?.nodeId || null);

    const nextFrontierItems = [];
    const parallelBatchSize = batch.length;

    const executeBatchItem = async ({ nodeId, viaEdgeId }) => {
      const node = nodeMap.get(nodeId);
      if (!node || node.type === NODE_TYPES.GROUP_NOTE) return;

      const visits = (visitCounts.get(nodeId) || 0) + 1;
      visitCounts.set(nodeId, visits);
      if (visits > maxIterations + 1) {
        const errMsg = `Límite máximo de iteraciones alcanzado (${maxIterations}) en el nodo «${node.label}».`;
        nodeStates[nodeId].status = NODE_EXEC_STATES.FAILED;
        nodeStates[nodeId].error = errMsg;
        failedNodeId = nodeId;
        failedNodeLabel = node.label;
        failedEdgeId = viaEdgeId;
        lastFailureReason = errMsg;
        terminalOutcome = "error";
        return;
      }

      totalStepsExecuted++;
      if (viaEdgeId) {
        takenEdgeIds.add(viaEdgeId);
        if (typeof options.onEdgeTaken === "function") options.onEdgeTaken(viaEdgeId);
      }

      const nState = nodeStates[nodeId];
      nState.visits = visits;
      nState.status = NODE_EXEC_STATES.RUNNING;
      if (typeof options.onNodeStateChange === "function") {
        options.onNodeStateChange(nodeId, NODE_EXEC_STATES.RUNNING, { attempt: 1, maxAttempts: 1 });
      }
      notify(nodeId);

      let chosenPort = PORT_TYPES.DEFAULT;
      let explicitTargetNodeId = null;
      let stepFailedUnrecovered = false;
      const nodeStartMs = performance.now();

      if (node.type === NODE_TYPES.START) {
        nState.status = NODE_EXEC_STATES.SUCCESS;
        chosenPort = PORT_TYPES.DEFAULT;
        stepLogs.push({
          stepIndex: stepLogs.length + 1,
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: node.label,
          requestName: node.label,
          status: NODE_EXEC_STATES.SUCCESS,
          execState: NODE_EXEC_STATES.SUCCESS,
          durationMs: 1,
          attempts: 1,
          attemptsUsed: 1,
          maxAttempts: 1,
          passed: true,
          transitionPort: chosenPort,
          parallelBatchSize
        });
      } else if (node.type === NODE_TYPES.END_SUCCESS) {
        nState.status = NODE_EXEC_STATES.SUCCESS;
        terminalOutcome = "success";
        stepLogs.push({
          stepIndex: stepLogs.length + 1,
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: node.label,
          requestName: node.label,
          status: NODE_EXEC_STATES.SUCCESS,
          execState: NODE_EXEC_STATES.SUCCESS,
          durationMs: 1,
          attempts: 1,
          attemptsUsed: 1,
          maxAttempts: 1,
          passed: true,
          transitionPort: "end_success",
          parallelBatchSize
        });
        return;
      } else if (node.type === NODE_TYPES.END_ERROR) {
        nState.status = NODE_EXEC_STATES.FAILED;
        terminalOutcome = "error";
        if (!failedNodeId) {
          failedNodeId = node.id;
          failedNodeLabel = node.label;
        }
        if (!failedEdgeId && viaEdgeId) failedEdgeId = viaEdgeId;
        stepLogs.push({
          stepIndex: stepLogs.length + 1,
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: node.label,
          requestName: node.label,
          status: NODE_EXEC_STATES.FAILED,
          execState: NODE_EXEC_STATES.FAILED,
          durationMs: 1,
          attempts: 1,
          attemptsUsed: 1,
          maxAttempts: 1,
          passed: false,
          transitionPort: "end_error",
          detail: lastFailureReason || `El flujo finalizó en el nodo de error «${node.label}»`,
          error: { code: "END_ERROR_REACHED", message: lastFailureReason || `Fin con Error alcanzado en «${node.label}»` },
          parallelBatchSize
        });
        return;
      } else if (node.type === NODE_TYPES.DELAY) {
        const rawSec =
          node.config?.delaySec !== undefined
            ? Number(node.config.delaySec)
            : node.config?.delayMs !== undefined
            ? Number(node.config.delayMs) / 1000
            : 1;
        const delaySec = clampDelayNodeSec(rawSec);
        if (!simulateOnly) {
          await sleepControllable(Math.round(delaySec * 1000 * delayScale), controller);
        }
        nState.durationMs = Math.max(1, Math.round(performance.now() - nodeStartMs));
        nState.status = NODE_EXEC_STATES.SUCCESS;
        chosenPort = PORT_TYPES.DEFAULT;
        stepLogs.push({
          stepIndex: stepLogs.length + 1,
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: node.label,
          requestName: node.label,
          status: NODE_EXEC_STATES.SUCCESS,
          execState: NODE_EXEC_STATES.SUCCESS,
          durationMs: nState.durationMs,
          attempts: 1,
          attemptsUsed: 1,
          maxAttempts: 1,
          passed: true,
          transitionPort: chosenPort,
          detail: `Espera ${delaySec}s (${Math.round(delaySec * 1000)} ms)`,
          details: `Delay ${delaySec}s`,
          parallelBatchSize
        });
      } else if (node.type === NODE_TYPES.TRANSFORM) {
        const trRes = executeDeclarativeTransform(node.config, { flowVars, state });
        nState.durationMs = Math.max(1, Math.round(performance.now() - nodeStartMs));
        nState.status = NODE_EXEC_STATES.SUCCESS;
        chosenPort = PORT_TYPES.DEFAULT;
        stepLogs.push({
          stepIndex: stepLogs.length + 1,
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: node.label,
          requestName: node.label,
          status: NODE_EXEC_STATES.SUCCESS,
          execState: NODE_EXEC_STATES.SUCCESS,
          durationMs: nState.durationMs,
          attempts: 1,
          attemptsUsed: 1,
          maxAttempts: 1,
          passed: true,
          transitionPort: chosenPort,
          detail: `${node.config?.operation || "template"} → \${${trRes.outputVariable}}`,
          extractedVariables: sanitizeVariablesMap({ [trRes.outputVariable]: trRes.value }, state),
          parallelBatchSize
        });
      } else if (node.type === NODE_TYPES.CONDITION) {
        const condRes = evaluateDeclarativeCondition(node.config, {
          lastResponse: lastHttpResponse,
          flowVars,
          state
        });
        nState.durationMs = Math.max(1, Math.round(performance.now() - nodeStartMs));
        nState.status = condRes.passed ? NODE_EXEC_STATES.SUCCESS : NODE_EXEC_STATES.WARNING;
        chosenPort = condRes.passed ? PORT_TYPES.TRUE : PORT_TYPES.FALSE;
        const condSummary = `${condRes.actual} ${condRes.operator} ${condRes.expected} → ${chosenPort.toUpperCase()}`;
        stepLogs.push({
          stepIndex: stepLogs.length + 1,
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: node.label,
          requestName: node.label,
          status: nState.status,
          execState: nState.status,
          durationMs: nState.durationMs,
          attempts: 1,
          attemptsUsed: 1,
          maxAttempts: 1,
          passed: true,
          transitionPort: chosenPort,
          detail: condSummary,
          conditionEvaluation: {
            ...condRes,
            expected: maskSecretsInString(String(condRes.expected || ""), state),
            actual: maskSecretsInString(String(condRes.actual || ""), state)
          },
          parallelBatchSize
        });
      } else if (node.type === NODE_TYPES.SUBFLOW) {
        const subflowTargetId = node.config?.targetFlowId || node.config?.subflowId;
        const targetFlow = (state?.customFlows || []).find((f) => f.id === subflowTargetId);
        if (!targetFlow || subflowDepth >= 3) {
          nState.status = NODE_EXEC_STATES.FAILED;
          chosenPort = PORT_TYPES.FAILURE;
          stepFailedUnrecovered = true;
          failedNodeId = node.id;
          failedNodeLabel = node.label;
          failedEdgeId = viaEdgeId;
          lastFailureReason = `Subflujo «${node.label}» no encontrado o límite de recursión excedido`;
        } else {
          const subRes = await executeAdvancedFlowGraph(targetFlow, allRequests, state, {
            ...options,
            subflowDepth: subflowDepth + 1
          });
          const subPassed = Boolean(subRes?.report?.allPassed ?? subRes?.allPassed);
          nState.status = subPassed ? NODE_EXEC_STATES.SUCCESS : NODE_EXEC_STATES.FAILED;
          chosenPort = subPassed ? PORT_TYPES.SUCCESS : PORT_TYPES.FAILURE;
          if (!subPassed) {
            stepFailedUnrecovered = true;
            failedNodeId = node.id;
            failedNodeLabel = node.label;
            failedEdgeId = viaEdgeId;
            lastFailureReason = `El subflujo «${targetFlow.name}» invocado en «${node.label}» falló`;
          }
        }
        nState.durationMs = Math.max(1, Math.round(performance.now() - nodeStartMs));
        stepLogs.push({
          stepIndex: stepLogs.length + 1,
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: node.label,
          requestName: node.label,
          status: nState.status,
          execState: nState.status,
          durationMs: nState.durationMs,
          attempts: 1,
          attemptsUsed: 1,
          maxAttempts: 1,
          passed: nState.status === NODE_EXEC_STATES.SUCCESS,
          transitionPort: chosenPort,
          error: nState.status === NODE_EXEC_STATES.FAILED ? { code: "SUBFLOW_FAILED", message: lastFailureReason } : null,
          parallelBatchSize
        });
      } else if (node.type === NODE_TYPES.HTTP_REQUEST) {
        const reqObj = requestMap.get(node.config?.requestId);
        const nodeFlowParams = Array.isArray(node.config?.params) ? node.config.params : null;
        if (!reqObj) {
          const errMsg = `El nodo «${node.label}» no tiene un endpoint válido asociado.`;
          nState.status = NODE_EXEC_STATES.FAILED;
          nState.error = errMsg;
          chosenPort = PORT_TYPES.FAILURE;
          stepFailedUnrecovered = true;
          failedNodeId = node.id;
          failedNodeLabel = node.label;
          failedEdgeId = viaEdgeId;
          lastFailureReason = errMsg;
          stepLogs.push({
            stepIndex: stepLogs.length + 1,
            nodeId: node.id,
            nodeType: node.type,
            nodeLabel: node.label,
            requestName: node.label,
            status: NODE_EXEC_STATES.FAILED,
            execState: NODE_EXEC_STATES.FAILED,
            httpStatus: 0,
            durationMs: 1,
            attempts: 1,
            attemptsUsed: 1,
            maxAttempts: 1,
            passed: false,
            transitionPort: chosenPort,
            failureReason: errMsg,
            error: { code: "MISSING_ENDPOINT", message: errMsg },
            parallelBatchSize
          });
        } else if (simulateOnly) {
          const tempState = {
            ...state,
            runtimeVars: { ...(state?.runtimeVars || {}), ...flowVars }
          };
          const effectiveReq = nodeFlowParams ? { ...reqObj, params: nodeFlowParams } : reqObj;
          const resolvedUrlInfo = buildFullResolvedUrlWithParams(effectiveReq, tempState);
          const simResp = {
            status: 200,
            statusText: "SIMULATED OK",
            durationMs: 1,
            sizeBytes: 64,
            headers: { "x-etp-simulated": "true" },
            cookies: [],
            body: JSON.stringify({ simulated: true, requestId: reqObj.id, order: { id: "sim_101" } }, null, 2),
            bodyObj: { simulated: true, requestId: reqObj.id, order: { id: "sim_101" } },
            isJson: true,
            assertionResults: []
          };
          const extracted = applyDeclarativeExtractions(
            [...(reqObj.extractions || []), ...(node.config?.extractions || [])],
            simResp,
            flowVars,
            state
          );
          lastHttpResponse = simResp;
          nState.status = resolvedUrlInfo.unresolved.length > 0 ? NODE_EXEC_STATES.WARNING : NODE_EXEC_STATES.SUCCESS;
          nState.attempt = 1;
          nState.maxAttempts = 1 + clampRetryCount(node.config?.retryCount ?? node.config?.retries ?? 0);
          nState.durationMs = 1;
          chosenPort = PORT_TYPES.SUCCESS;
          stepLogs.push({
            stepIndex: stepLogs.length + 1,
            nodeId: node.id,
            nodeType: node.type,
            nodeLabel: node.label,
            requestId: reqObj.id,
            requestName: reqObj.name,
            method: reqObj.method,
            url: maskSecretsInString(resolvedUrlInfo.text, state),
            resolvedUrl: maskSecretsInString(resolvedUrlInfo.text, state),
            unresolvedVariables: resolvedUrlInfo.unresolved,
            status: nState.status,
            execState: nState.status,
            httpStatus: 200,
            durationMs: 1,
            attempts: 1,
            attemptsUsed: 1,
            retriesPerformed: 0,
            maxAttempts: nState.maxAttempts,
            passed: true,
            transitionPort: chosenPort,
            detail: "Modo Simulación (Dry-Run)",
            assertionResults: [],
            extractedVariables: sanitizeVariablesMap(extracted, state),
            responsePreview: sanitizeResponseForFlowReport(simResp, state),
            parallelBatchSize
          });
        } else {
          // Ejecución real con reintentos configurables y parámetros exclusivos del flujo
          const stepExec = await executeRequestStepWithRetries({
            baseRequest: reqObj,
            flowParams: nodeFlowParams,
            useExclusiveAssertions: Boolean(node.config?.useExclusiveAssertions),
            flowAssertions: node.config?.assertions || [],
            flowExtractions: node.config?.extractions || [],
            retryCount: node.config?.retryCount ?? node.config?.retries ?? 0,
            retryDelaySec: node.config?.retryDelaySec ?? 1,
            state,
            flowVars,
            executorFn: options.executorFn || null,
            controller,
            delayScale,
            onAttemptUpdate: ({ attempt, maxAttempts, isRetry }) => {
              nState.attempt = attempt;
              nState.maxAttempts = maxAttempts;
              nState.status = isRetry ? NODE_EXEC_STATES.RETRYING : NODE_EXEC_STATES.RUNNING;
              if (typeof options.onNodeStateChange === "function") {
                options.onNodeStateChange(nodeId, nState.status, { attempt, maxAttempts });
              }
              notify(nodeId);
            }
          });

          const r = stepExec.response;
          lastHttpResponse = r;
          if (r) {
            state.responsesByReqId[reqObj.id] = r;
          }

          for (const a of r?.assertionResults || []) {
            totalAssertions++;
            if (a.passed) passedAssertions++;
          }

          nState.durationMs = stepExec.totalDurationMs;
          nState.attempt = stepExec.attemptsUsed;
          nState.maxAttempts = stepExec.maxAttempts;

          const policies = node.config?.policies || {};
          const humanFailure = buildHumanFailureReason(stepExec, r, reqObj.name, node.label);

          if (stepExec.passed) {
            nState.status = NODE_EXEC_STATES.SUCCESS;
            chosenPort = PORT_TYPES.SUCCESS;
            const onSuccessPol = normalizePolicyValue(policies.onSuccess ?? node.config?.onSuccess ?? "follow_port");
            if (onSuccessPol === "stop_flow") {
              chosenPort = "__STOP__";
            }
          } else {
            const policyKey =
              stepExec.failureKind === "timeout"
                ? "onTimeout"
                : stepExec.failureKind === "network_error"
                ? "onNetworkError"
                : stepExec.failureKind === "assertion_failure"
                ? "onAssertionFailure"
                : "onHttpError";
            const chosenPolicy = normalizePolicyValue(
              policies[policyKey] ?? node.config?.[policyKey] ?? "follow_port"
            );

            if (chosenPolicy === "continue_default") {
              nState.status = NODE_EXEC_STATES.WARNING;
              chosenPort = PORT_TYPES.SUCCESS;
              handledFailedNodes.push({
                nodeId: node.id,
                nodeLabel: node.label,
                requestName: reqObj.name,
                reason: humanFailure
              });
            } else if (chosenPolicy === "stop_flow") {
              nState.status = NODE_EXEC_STATES.FAILED;
              chosenPort = "__STOP__";
              stepFailedUnrecovered = true;
              failedNodeId = node.id;
              failedNodeLabel = node.label;
              failedEdgeId = viaEdgeId;
              lastFailureReason = humanFailure;
              terminalOutcome = "error";
            } else if (chosenPolicy === "goto_error_node") {
              nState.status = NODE_EXEC_STATES.FAILED;
              const fallbackErrNode =
                nodeMap.get(policies.errorTargetNodeId) ||
                nodes.find((n) => n.type === NODE_TYPES.END_ERROR);
              explicitTargetNodeId = fallbackErrNode ? fallbackErrNode.id : null;
              stepFailedUnrecovered = true;
              failedNodeId = node.id;
              failedNodeLabel = node.label;
              failedEdgeId = viaEdgeId;
              lastFailureReason = humanFailure;
              if (!explicitTargetNodeId) terminalOutcome = "error";
            } else {
              // follow_port: sale por puerto failure o timeout
              nState.status = NODE_EXEC_STATES.FAILED;
              chosenPort = stepExec.failureKind === "timeout" ? PORT_TYPES.TIMEOUT : PORT_TYPES.FAILURE;
              stepFailedUnrecovered = true;
              failedNodeId = node.id;
              failedNodeLabel = node.label;
              failedEdgeId = viaEdgeId;
              lastFailureReason = humanFailure;
            }
          }

          const tempState = {
            ...state,
            runtimeVars: { ...(state?.runtimeVars || {}), ...flowVars }
          };
          const effectiveReq = nodeFlowParams ? { ...reqObj, params: nodeFlowParams } : reqObj;
          const resolvedUrlInfo = buildFullResolvedUrlWithParams(effectiveReq, tempState);
          const safeFailureReason = humanFailure ? maskSecretsInString(humanFailure, state) : null;

          stepLogs.push({
            stepIndex: stepLogs.length + 1,
            nodeId: node.id,
            nodeType: node.type,
            nodeLabel: node.label,
            requestId: reqObj.id,
            requestName: reqObj.name,
            method: reqObj.method,
            url: maskSecretsInString(resolvedUrlInfo.text, state),
            resolvedUrl: maskSecretsInString(resolvedUrlInfo.text, state),
            status: nState.status,
            execState: nState.status,
            httpStatus: r?.status ?? 0,
            durationMs: stepExec.totalDurationMs,
            attempts: stepExec.attemptsUsed,
            attemptsUsed: stepExec.attemptsUsed,
            retriesPerformed: stepExec.retriesPerformed,
            maxAttempts: stepExec.maxAttempts,
            passed: stepExec.passed || nState.status === NODE_EXEC_STATES.WARNING,
            rawStepPassed: stepExec.passed,
            failureKind: stepExec.failureKind,
            failureReason: safeFailureReason,
            detail: safeFailureReason || `HTTP ${r?.status ?? 0} OK`,
            error: safeFailureReason
              ? { code: stepExec.failureKind || "HTTP_STEP_FAILED", message: safeFailureReason }
              : null,
            transitionPort: chosenPort,
            assertionResults: (r?.assertionResults || []).map((a) => ({
              ...a,
              expected: maskSecretsInString(String(a.expected || ""), state),
              actual: maskSecretsInString(String(a.actual || ""), state),
              message: maskSecretsInString(String(a.message || ""), state)
            })),
            extractedVariables: sanitizeVariablesMap(stepExec.extractedVariables, state),
            responsePreview: sanitizeResponseForFlowReport(r, state),
            parallelBatchSize
          });
        }
      }

      nState.lastTransitionPort = chosenPort;
      if (typeof options.onNodeStateChange === "function") {
        options.onNodeStateChange(nodeId, nState.status, {
          attempt: nState.attempt || 1,
          maxAttempts: nState.maxAttempts || 1
        });
      }
      if (singleTargetNodeId) return;
      if (chosenPort === "__STOP__") return;

      if (explicitTargetNodeId && nodeMap.has(explicitTargetNodeId)) {
        nextFrontierItems.push({ nodeId: explicitTargetNodeId, viaEdgeId: null });
        return;
      }

      // Buscar aristas salientes que coincidan con el puerto elegido
      const nodeOutEdges = edges.filter((e) => e.source === node.id);
      let matchingEdges = nodeOutEdges.filter((e) => e.sourcePort === chosenPort);
      if (matchingEdges.length === 0 && chosenPort === PORT_TYPES.TIMEOUT) {
        matchingEdges = nodeOutEdges.filter((e) => e.sourcePort === PORT_TYPES.FAILURE);
      }
      if (matchingEdges.length === 0 && chosenPort !== PORT_TYPES.FAILURE && chosenPort !== PORT_TYPES.FALSE) {
        matchingEdges = nodeOutEdges.filter((e) => e.sourcePort === PORT_TYPES.DEFAULT);
      }

      if (matchingEdges.length === 0 && stepFailedUnrecovered) {
        terminalOutcome = "error";
      }

      for (const edge of matchingEdges) {
        if (stepFailedUnrecovered) {
          failedEdgeId = edge.id;
          const targetNodeObj = nodeMap.get(edge.target);
          if (targetNodeObj && targetNodeObj.type !== NODE_TYPES.END_ERROR) {
            handledFailedNodes.push({
              nodeId: node.id,
              nodeLabel: node.label,
              requestName: node.config?.requestId ? requestMap.get(node.config.requestId)?.name : node.label,
              reason: lastFailureReason
            });
          }
        }
        nextFrontierItems.push({ nodeId: edge.target, viaEdgeId: edge.id });
      }
    };

    await Promise.all(batch.map(executeBatchItem));

    for (const item of nextFrontierItems) {
      if (!currentFrontier.some((existing) => existing.nodeId === item.nodeId && existing.viaEdgeId === item.viaEdgeId)) {
        currentFrontier.push(item);
      }
    }
  }

  if (terminalOutcome === "success" && handledFailedNodes.length > 0) {
    failedNodeId = null;
    failedEdgeId = null;
  }

  for (const n of nodes) {
    if (n.type === NODE_TYPES.GROUP_NOTE) continue;
    const st = nodeStates[n.id];
    if (st && (st.status === NODE_EXEC_STATES.PENDING || st.status === NODE_EXEC_STATES.QUEUED)) {
      st.status = controller.cancelled ? NODE_EXEC_STATES.CANCELLED : NODE_EXEC_STATES.SKIPPED;
    }
    if (st && typeof options.onNodeStateChange === "function") {
      options.onNodeStateChange(n.id, st.status, { attempt: st.attempt || 1, maxAttempts: st.maxAttempts || 1 });
    }
  }
  for (const eid of takenEdgeIds) {
    if (typeof options.onEdgeTaken === "function") options.onEdgeTaken(eid);
  }

  const httpSteps = stepLogs.filter((s) => s.nodeType === NODE_TYPES.HTTP_REQUEST);
  const allPassed =
    !controller.cancelled &&
    terminalOutcome !== "error" &&
    !failedNodeId &&
    (terminalOutcome === "success" || httpSteps.every((s) => s.passed !== false));

  const totalDurationMs = Math.max(1, Math.round(performance.now() - startTime));
  const nowIso = new Date().toISOString();
  const report = {
    runId: "run_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    mode: simulateOnly ? "simulation" : "advanced",
    simulated: simulateOnly,
    simulateOnly,
    cancelled: controller.cancelled,
    timestamp: nowIso,
    finishedAt: nowIso,
    totalRequests: httpSteps.length,
    totalNodesVisited: stepLogs.length,
    totalAssertions,
    passedAssertions,
    totalDurationMs,
    allPassed,
    failedNodeId,
    failedNodeLabel: failedNodeId ? (failedNodeLabel || nodeMap.get(failedNodeId)?.label || failedNodeId) : null,
    failedEdgeId,
    failureReason: !allPassed && lastFailureReason ? maskSecretsInString(lastFailureReason, state) : null,
    handledFailedNodes: handledFailedNodes.map((h) => ({
      ...h,
      reason: h.reason ? maskSecretsInString(h.reason, state) : null
    })),
    takenEdgeIds: Array.from(takenEdgeIds),
    nodeStates,
    steps: stepLogs.map((s) => ({
      ...s,
      status: s.httpStatus !== undefined ? s.httpStatus : s.status === NODE_EXEC_STATES.SUCCESS ? 200 : 0,
      nodeExecStatus: s.status,
      execState: s.execState || s.status,
      attempts: s.attemptsUsed || s.attempts || 1,
      requestName: s.requestName || s.nodeLabel,
      method: s.method || s.nodeType.toUpperCase(),
      passed: s.passed ?? s.status === NODE_EXEC_STATES.SUCCESS,
      assertionResults: s.assertionResults || []
    })),
    finalFlowVariables: sanitizeVariablesMap(flowVars, state)
  };

  flow.lastReport = report;
  if (!simulateOnly) {
    recordExecutionInFlowHistory(flow, report);
  }
  notify(null);

  Object.defineProperty(report, "ok", { value: true, enumerable: false });
  Object.defineProperty(report, "validation", { value: validation, enumerable: false });
  Object.defineProperty(report, "report", { value: report, enumerable: false });
  return report;
}

export function recordExecutionInFlowHistory(flow, report) {
  if (!flow || !report) return;
  flow.executionHistory = Array.isArray(flow.executionHistory) ? flow.executionHistory : [];
  const ts = report.timestamp || report.finishedAt || new Date().toISOString();
  const compactEntry = {
    runId: report.runId || "run_" + Date.now(),
    mode: report.mode || flow.mode || "basic",
    timestamp: ts,
    finishedAt: ts,
    allPassed: Boolean(report.allPassed),
    totalRequests: Number(report.totalRequests) || 0,
    totalAssertions: Number(report.totalAssertions) || 0,
    passedAssertions: Number(report.passedAssertions) || 0,
    totalDurationMs: Number(report.totalDurationMs) || 0,
    failedNodeId: report.failedNodeId || null,
    failedNodeLabel: report.failedNodeLabel || null,
    failedEdgeId: report.failedEdgeId || null,
    failureReason: report.failureReason || null,
    finalFlowVariables: report.finalFlowVariables || {},
    steps: (report.steps || []).slice(0, 60).map((s) => ({
      nodeId: s.nodeId || null,
      nodeLabel: s.nodeLabel || s.requestName || "Step",
      requestId: s.requestId || null,
      requestName: s.requestName || s.nodeLabel || "Step",
      method: s.method || "GET",
      status: s.status,
      nodeExecStatus: s.nodeExecStatus || (s.passed ? "success" : "failed"),
      execState: s.execState || s.nodeExecStatus || (s.passed ? "success" : "failed"),
      durationMs: s.durationMs || 0,
      attempts: s.attemptsUsed || s.attempts || 1,
      attemptsUsed: s.attemptsUsed || s.attempts || 1,
      retriesPerformed: s.retriesPerformed || 0,
      passed: Boolean(s.passed),
      failureReason: s.failureReason || null,
      transitionPort: s.transitionPort || "default",
      extractedVariables: s.extractedVariables || {}
    }))
  };
  flow.executionHistory.unshift(compactEntry);
  if (flow.executionHistory.length > MAX_FLOW_HISTORY_RUNS) {
    flow.executionHistory.length = MAX_FLOW_HISTORY_RUNS;
  }
}

/**
 * Compara dos ejecuciones del historial (`runA` y `runB`) devolviendo diferencias por paso y métricas.
 */
export function compareFlowExecutions(runA, runB) {
  if (!runA || !runB) return null;
  const maxLen = Math.max((runA.steps || []).length, (runB.steps || []).length);
  const stepDiffs = [];
  for (let i = 0; i < maxLen; i++) {
    const sA = runA.steps?.[i] || null;
    const sB = runB.steps?.[i] || null;
    stepDiffs.push({
      index: i + 1,
      nameA: sA?.nodeLabel || sA?.requestName || "—",
      nameB: sB?.nodeLabel || sB?.requestName || "—",
      statusA: sA ? `${sA.status} (${sA.passed ? "PASS" : "FAIL"})` : "—",
      statusB: sB ? `${sB.status} (${sB.passed ? "PASS" : "FAIL"})` : "—",
      durationDiffMs: (sB?.durationMs || 0) - (sA?.durationMs || 0),
      retriesA: sA?.retriesPerformed || 0,
      retriesB: sB?.retriesPerformed || 0,
      changedOutcome: Boolean(sA?.passed) !== Boolean(sB?.passed)
    });
  }
  return {
    runAId: runA.runId,
    runBId: runB.runId,
    timestampA: runA.timestamp || runA.finishedAt,
    timestampB: runB.timestamp || runB.finishedAt,
    passedChanged: Boolean(runA.allPassed) !== Boolean(runB.allPassed),
    durationDeltaMs: (runA.totalDurationMs || 0) - (runB.totalDurationMs || 0),
    durationDiffMs: (runB.totalDurationMs || 0) - (runA.totalDurationMs || 0),
    nodeDiffs: stepDiffs.map((d) => ({
      label: d.nameB !== "—" ? d.nameB : d.nameA,
      statusA: d.statusA,
      statusB: d.statusB,
      httpStatusA: d.statusA,
      httpStatusB: d.statusB,
      durationDiffMs: d.durationDiffMs
    })),
    stepDiffs
  };
}

/**
 * Genera un reporte JSON 100% sanitizado (sin secretos) listo para exportar.
 */
export function exportSanitizedFlowReport(flow, state) {
  const rawJson = JSON.stringify(
    {
      kind: "eltransportador.flow.report",
      schemaVersion: 2,
      flowId: flow?.id,
      flowName: flow?.name,
      mode: flow?.mode,
      exportedAt: new Date().toISOString(),
      lastReport: flow?.lastReport || null,
      executionHistory: (flow?.executionHistory || []).slice(0, 12)
    },
    null,
    2
  );
  return maskSecretsInString(rawJson, state);
}
