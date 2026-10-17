/**
 * Validador Estático de Grafos de Flujo y Analizador de Flujo de Datos (Variables y Secretos) — ElTransportador v1.2.0
 * Archivo: apps/desktop/src/services/flows/flow-validator.js
 */
import { NODE_TYPES, MAX_FLOW_NODES, MAX_FLOW_EDGES, flowVariablesToMap, normalizePolicyValue } from "./flow-schema.js";
import { getByDotPath } from "../http/assertions-evaluator.js";
import { maskSecretsInString } from "../http/variable-interpolation.js";
import { REDACTED } from "../storage/constants.js";

/**
 * Extrae las variables `${var}` y secretos `${secret:key}` que un nodo consume y produce.
 * Respeta los `params` exclusivos del flujo (`node.config.params`) cuando existen, manteniendo
 * independencia con la solicitud original del editor HTTP.
 */
export function extractNodeVariableDependencies(node, allRequests = []) {
  const consumedVars = new Set();
  const consumedSecrets = new Set();
  const producedVars = new Set();

  if (!node || !node.type) {
    return { consumedVars: [], consumedSecrets: [], producedVars: [] };
  }

  const scanString = (str) => {
    if (!str || typeof str !== "string") return;
    const regex = /\$\{\s*(secret:)?([a-zA-Z0-9_.\-]+)\s*\}/g;
    let m;
    while ((m = regex.exec(str)) !== null) {
      if (m[1]) consumedSecrets.add(m[2]);
      else consumedVars.add(m[2]);
    }
  };

  if (node.type === NODE_TYPES.HTTP_REQUEST) {
    const req = allRequests.find((r) => r.id === node.config?.requestId);
    const effectiveParams = Array.isArray(node.config?.params)
      ? node.config.params
      : req?.params || [];
    for (const p of effectiveParams) {
      if (p && p.enabled !== false) {
        scanString(p.key);
        scanString(p.value);
      }
    }
    if (req) {
      scanString(req.url);
      for (const h of req.headers || []) {
        if (h?.enabled) {
          scanString(h.key);
          scanString(h.value);
        }
      }
      if (req.auth) {
        scanString(req.auth.bearerToken);
        scanString(req.auth.basicUsername);
        scanString(req.auth.basicPassword);
        scanString(req.auth.apiKeyName);
        scanString(req.auth.apiKeyValue);
      }
      if (req.body) {
        scanString(req.body.raw);
        for (const u of req.body.urlencoded || []) {
          if (u?.enabled) {
            scanString(u.key);
            scanString(u.value);
          }
        }
        for (const mp of req.body.multipart || []) {
          if (mp?.enabled) {
            scanString(mp.key);
            scanString(mp.value);
          }
        }
      }
      for (const ext of req.extractions || []) {
        if (ext?.enabled && ext.variableName) {
          producedVars.add(ext.variableName);
        }
      }
    }
    for (const ext of node.config?.extractions || []) {
      if (ext?.enabled && ext.variableName) {
        producedVars.add(ext.variableName);
      }
    }
    for (const ast of node.config?.assertions || []) {
      if (ast?.enabled) {
        scanString(ast.expected);
      }
    }
  } else if (node.type === NODE_TYPES.CONDITION) {
    if (node.config?.source === "variable" && node.config?.property) {
      consumedVars.add(node.config.property.trim());
    }
    scanString(node.config?.leftOperand);
    scanString(node.config?.rightOperand);
    scanString(node.config?.expected);
  } else if (node.type === NODE_TYPES.TRANSFORM) {
    const inV = node.config?.inputVariable || node.config?.sourceVariable;
    if (inV) consumedVars.add(String(inV).trim());
    scanString(node.config?.templateOrValue || node.config?.template);
    const outV = node.config?.outputVariable || node.config?.targetVariable;
    if (outV) producedVars.add(String(outV).trim());
  }

  return {
    consumedVars: Array.from(consumedVars),
    consumedSecrets: Array.from(consumedSecrets),
    producedVars: Array.from(producedVars)
  };
}

/**
 * Recopila todas las variables disponibles para ser consumidas en un endpoint del flujo
 * (variables iniciales del flujo, variables producidas por pasos/nodos, variables de entorno,
 * variables de colección/runtime y claves de la bóveda de secretos).
 */
export function collectAvailableVariablesForFlow(flow, allRequests = [], state = null) {
  const flowInit = new Set();
  const flowProduced = new Set();
  const envVars = new Set();
  const colVars = new Set();
  const secrets = new Set();

  const fVarsMap = flowVariablesToMap(flow?.flowVariables);
  for (const k of Object.keys(fVarsMap)) {
    if (k) flowInit.add(k);
  }

  // Variables producidas en Modo Básico (stepOverrides + requests seleccionados)
  if (Array.isArray(flow?.selectedRequestIds)) {
    for (const reqId of flow.selectedRequestIds) {
      const reqObj = allRequests.find((r) => r.id === reqId);
      for (const ext of reqObj?.extractions || []) {
        if (ext?.enabled !== false && ext.variableName) {
          flowProduced.add(String(ext.variableName).trim());
        }
      }
      const ov = flow.stepOverrides?.[reqId];
      for (const ext of ov?.extractions || []) {
        if (ext?.enabled !== false && ext.variableName) {
          flowProduced.add(String(ext.variableName).trim());
        }
      }
    }
  }

  // Variables producidas en Modo Avanzado (nodos del grafo)
  if (Array.isArray(flow?.graph?.nodes)) {
    for (const n of flow.graph.nodes) {
      const deps = extractNodeVariableDependencies(n, allRequests);
      for (const pv of deps.producedVars) {
        if (pv) flowProduced.add(pv);
      }
    }
  }

  if (state) {
    if (state.activeEnvId && state.activeEnvId !== "none") {
      const activeEnv = (state.environments || []).find((e) => e.id === state.activeEnvId);
      for (const v of activeEnv?.variables || []) {
        if (v?.enabled !== false && v.key) envVars.add(String(v.key).trim());
      }
    } else {
      for (const env of state.environments || []) {
        for (const v of env?.variables || []) {
          if (v?.enabled !== false && v.key) envVars.add(String(v.key).trim());
        }
      }
    }

    for (const col of state.collections || []) {
      for (const v of col.variables || []) {
        if (v?.enabled !== false && v.key) colVars.add(String(v.key).trim());
      }
    }
    for (const k of Object.keys(state.runtimeVars || {})) {
      if (k && !flowProduced.has(k) && !flowInit.has(k)) colVars.add(k);
    }

    for (const sk of Object.keys(state.secretVault || {})) {
      if (sk) secrets.add(sk);
    }
  }

  return {
    flowInit: Array.from(flowInit),
    flowProduced: Array.from(flowProduced),
    envVars: Array.from(envVars),
    colVars: Array.from(colVars),
    secrets: Array.from(secrets)
  };
}

/**
 * Construye el inventario completo de variables del flujo junto con su valor actual resuelto,
 * origen (Producida en el Flujo, Inicial del Flujo, Entorno Activo, Colección/Sesión o Bóveda de Secretos)
 * y ruta de extracción (incluyendo rutas con índice de lista como `results[0].name`).
 * Todos los secretos se redactan/ocultan automáticamente.
 */
export function buildFlowVariablesSummaryEntries(flow, allRequests = [], state = null) {
  const entries = [];
  const seenKeysByCat = new Set();

  const evaluateLiveFromCachedResp = (ext, reqId) => {
    if (!state?.responsesByReqId || !reqId) return undefined;
    const resp = state.responsesByReqId[reqId];
    if (!resp) return undefined;
    const src = ext?.source || "json_path";
    if (src === "status") {
      return resp.status !== undefined ? String(resp.status) : undefined;
    }
    if (src === "header") {
      const targetKey = String(ext?.path || "").toLowerCase();
      for (const [hk, hv] of Object.entries(resp.headers || {})) {
        if (hk.toLowerCase() === targetKey) return String(hv);
      }
      return undefined;
    }
    if (src === "cookie") {
      const targetCookie = String(ext?.path || "").toLowerCase();
      const found = (resp.cookies || []).find((c) => String(c?.name || "").toLowerCase() === targetCookie);
      return found ? String(found.value || "") : undefined;
    }
    let parsedObj = resp.bodyObj || null;
    if (!parsedObj && typeof resp.body === "string" && resp.body.trim()) {
      try {
        parsedObj = JSON.parse(resp.body);
      } catch {}
    }
    if (!parsedObj) return undefined;
    const val = getByDotPath(parsedObj, ext?.path || "");
    if (val === undefined || val === null) return undefined;
    return typeof val === "object" ? JSON.stringify(val) : String(val);
  };

  const resolveProducedVarValue = (varName, ext = null, reqId = null) => {
    if (ext && reqId) {
      const liveVal = evaluateLiveFromCachedResp(ext, reqId);
      if (liveVal !== undefined) return liveVal;
    }
    if (flow?.lastReport?.finalFlowVariables?.[varName] !== undefined) {
      return flow.lastReport.finalFlowVariables[varName];
    }
    if (Array.isArray(flow?.lastReport?.steps)) {
      for (let i = flow.lastReport.steps.length - 1; i >= 0; i--) {
        const s = flow.lastReport.steps[i];
        if (s?.extractedVariables?.[varName] !== undefined) {
          return s.extractedVariables[varName];
        }
      }
    }
    if (state?.runtimeVars?.[varName] !== undefined) {
      return state.runtimeVars[varName];
    }
    if (ext && ext.fallbackValue !== undefined && ext.fallbackValue !== "") {
      return String(ext.fallbackValue);
    }
    return undefined;
  };

  const pushEntry = (rawItem) => {
    const item = {
      ...rawItem,
      name: rawItem.name || rawItem.key,
      isResolved: Boolean(rawItem.isResolved ?? rawItem.hasResolvedValue),
      sourceLabel: rawItem.sourceLabel || rawItem.sourceDetail || ""
    };
    const dedupKey = `${item.category}::${item.key}`;
    if (seenKeysByCat.has(dedupKey)) {
      const idx = entries.findIndex((e) => e.category === item.category && e.key === item.key);
      if (idx >= 0) entries[idx] = item;
      return;
    }
    seenKeysByCat.add(dedupKey);
    entries.push(item);
  };

  // 1. Variables Producidas / Extraídas en el Flujo
  if (flow?.mode === "advanced" && Array.isArray(flow?.graph?.nodes)) {
    for (const node of flow.graph.nodes) {
      if (node.type === NODE_TYPES.HTTP_REQUEST) {
        const reqId = node.config?.requestId;
        const reqObj = (allRequests || []).find((r) => r.id === reqId);
        const allExts = [...(reqObj?.extractions || []), ...(node.config?.extractions || [])];
        for (const ext of allExts) {
          if (!ext || ext.enabled === false || !ext.variableName) continue;
          const varName = String(ext.variableName).trim();
          const rawVal = resolveProducedVarValue(varName, ext, reqId);
          pushEntry({
            key: varName,
            token: `\${${varName}}`,
            value: rawVal !== undefined ? maskSecretsInString(String(rawVal), state || {}) : null,
            hasResolvedValue: rawVal !== undefined,
            isSecret: false,
            category: "flow_produced",
            sourceDetail: `${node.label} • ${ext.source || "json_path"}: ${ext.path || "id"}`
          });
        }
      } else if (node.type === NODE_TYPES.TRANSFORM) {
        const outVar = String(node.config?.targetVariable || node.config?.outputVariable || "").trim();
        if (outVar) {
          const rawVal = resolveProducedVarValue(outVar, null, null);
          pushEntry({
            key: outVar,
            token: `\${${outVar}}`,
            value: rawVal !== undefined ? maskSecretsInString(String(rawVal), state || {}) : null,
            hasResolvedValue: rawVal !== undefined,
            isSecret: false,
            category: "flow_produced",
            sourceDetail: `${node.label} • transform (${node.config?.operation || "template"})`
          });
        }
      }
    }
  } else if (Array.isArray(flow?.selectedRequestIds)) {
    flow.selectedRequestIds.forEach((reqId, idx) => {
      const reqObj = (allRequests || []).find((r) => r.id === reqId);
      const ov = flow?.stepOverrides?.[reqId] || {};
      const allExts = [...(reqObj?.extractions || []), ...(ov?.extractions || [])];
      for (const ext of allExts) {
        if (!ext || ext.enabled === false || !ext.variableName) continue;
        const varName = String(ext.variableName).trim();
        const rawVal = resolveProducedVarValue(varName, ext, reqId);
        pushEntry({
          key: varName,
          token: `\${${varName}}`,
          value: rawVal !== undefined ? maskSecretsInString(String(rawVal), state || {}) : null,
          hasResolvedValue: rawVal !== undefined,
          isSecret: false,
          category: "flow_produced",
          sourceDetail: `#${idx + 1} ${reqObj?.name || reqId} • ${ext.source || "json_path"}: ${ext.path || "id"}`
        });
      }
    });
  }

  // Incluir también cualquier variable extraída registrada en el último reporte que no esté listada arriba
  const initVarKeys = new Set(
    (Array.isArray(flow?.flowVariables) ? flow.flowVariables : [])
      .map((fv) => String(fv?.key || "").trim())
      .filter(Boolean)
  );
  for (const [k, v] of Object.entries(flow?.lastReport?.finalFlowVariables || {})) {
    if (!k || initVarKeys.has(k) || seenKeysByCat.has(`flow_produced::${k}`)) continue;
    pushEntry({
      key: k,
      token: `\${${k}}`,
      value: maskSecretsInString(String(v ?? ""), state || {}),
      hasResolvedValue: true,
      isSecret: false,
      category: "flow_produced",
      sourceDetail: "Última ejecución del flujo"
    });
  }

  // 2. Variables Iniciales del Flujo
  for (const fv of Array.isArray(flow?.flowVariables) ? flow.flowVariables : []) {
    if (!fv || !fv.key) continue;
    const varName = String(fv.key).trim();
    if (!varName) continue;
    const isSec = Boolean(fv.isSecret);
    const rawVal = flow?.lastReport?.finalFlowVariables?.[varName] ?? fv.value ?? "";
    pushEntry({
      key: varName,
      token: `\${${varName}}`,
      value: isSec ? REDACTED : maskSecretsInString(String(rawVal), state || {}),
      hasResolvedValue: true,
      isSecret: isSec,
      enabled: fv.enabled !== false,
      category: "flow_init",
      sourceDetail: "Inicial del Flujo"
    });
  }

  // 3. Variables del Entorno Activo
  if (state) {
    if (state.activeEnvId && state.activeEnvId !== "none") {
      const activeEnv = (state.environments || []).find((e) => e.id === state.activeEnvId);
      for (const v of activeEnv?.variables || []) {
        if (!v || v.enabled === false || !v.key) continue;
        const varName = String(v.key).trim();
        const isSec = Boolean(v.isSecret);
        pushEntry({
          key: varName,
          token: `\${${varName}}`,
          value: isSec ? REDACTED : maskSecretsInString(String(v.value ?? ""), state),
          hasResolvedValue: true,
          isSecret: isSec,
          category: "environment",
          sourceDetail: `Entorno: ${activeEnv.name}`
        });
      }
    }

    // 4. Variables de Colección y Sesión (runtimeVars)
    for (const col of state.collections || []) {
      for (const v of col?.variables || []) {
        if (!v || v.enabled === false || !v.key) continue;
        const varName = String(v.key).trim();
        const isSec = Boolean(v.isSecret);
        pushEntry({
          key: varName,
          token: `\${${varName}}`,
          value: isSec ? REDACTED : maskSecretsInString(String(v.value ?? ""), state),
          hasResolvedValue: true,
          isSecret: isSec,
          category: "collection",
          sourceDetail: `Colección: ${col.metadata?.name || "Col"}`
        });
      }
    }
    for (const [rk, rv] of Object.entries(state.runtimeVars || {})) {
      if (
        !rk ||
        seenKeysByCat.has(`flow_produced::${rk}`) ||
        seenKeysByCat.has(`flow_init::${rk}`) ||
        seenKeysByCat.has(`collection::${rk}`)
      ) {
        continue;
      }
      pushEntry({
        key: rk,
        token: `\${${rk}}`,
        value: maskSecretsInString(String(rv ?? ""), state),
        hasResolvedValue: true,
        isSecret: false,
        category: "collection",
        sourceDetail: "Sesión (Runtime)"
      });
    }

    // 5. Secretos de la Bóveda
    for (const sk of Object.keys(state.secretVault || {})) {
      if (!sk) continue;
      pushEntry({
        key: sk,
        token: `\${secret:${sk}}`,
        value: REDACTED,
        hasResolvedValue: true,
        isSecret: true,
        category: "secret",
        sourceDetail: "Bóveda de Secretos"
      });
    }
  }

  return entries;
}

/**
 * Obtiene el conjunto de variables ya definidas en el entorno global/colección/flujo antes de iniciar.
 */
export function getInitiallyDefinedVariables(flow, state) {
  const defined = new Set();
  if (state) {
    for (const k of Object.keys(state.runtimeVars || {})) defined.add(k);
    for (const col of state.collections || []) {
      for (const v of col.variables || []) {
        if (v?.enabled && v.key) defined.add(v.key);
      }
    }
    if (state.activeEnvId && state.activeEnvId !== "none") {
      const env = (state.environments || []).find((e) => e.id === state.activeEnvId);
      for (const v of env?.variables || []) {
        if (v?.enabled && v.key) defined.add(v.key);
      }
    }
  }
  const fVarsMap = flowVariablesToMap(flow?.flowVariables);
  for (const k of Object.keys(fVarsMap)) {
    defined.add(k);
  }
  return defined;
}

/**
 * Valida exhaustivamente un grafo de flujo antes de su ejecución o simulación.
 * Retorna `{ valid, errors, warnings, nodeIssues, edgeIssues, dataflowByNode }`.
 */
export function validateFlowGraph(flow, allRequests = [], state = null) {
  if (!Array.isArray(allRequests) && allRequests && typeof allRequests === "object") {
    state = allRequests;
    allRequests = [];
    for (const col of state.collections || []) {
      for (const r of col.requests || []) allRequests.push(r);
    }
  }
  const errors = [];
  const warnings = [];
  const nodeIssues = {};
  const edgeIssues = {};
  const dataflowByNode = {};

  const addNodeIssue = (nodeId, severity, code, message) => {
    if (!nodeIssues[nodeId]) nodeIssues[nodeId] = [];
    nodeIssues[nodeId].push({ severity, code, message });
    if (severity === "error") errors.push({ nodeId, code, message });
    else warnings.push({ nodeId, code, message });
  };

  const addEdgeIssue = (edgeId, severity, code, message) => {
    if (!edgeIssues[edgeId]) edgeIssues[edgeId] = [];
    edgeIssues[edgeId].push({ severity, code, message });
    if (severity === "error") errors.push({ edgeId, code, message });
    else warnings.push({ edgeId, code, message });
  };

  if (!flow || !flow.graph || !Array.isArray(flow.graph.nodes)) {
    errors.push({ code: "INVALID_GRAPH", message: "El flujo no contiene una definición de grafo válida." });
    return { valid: false, errors, warnings, nodeIssues, edgeIssues, dataflowByNode };
  }

  const nodes = flow.graph.nodes;
  const edges = Array.isArray(flow.graph.edges) ? flow.graph.edges : [];

  if (nodes.length > MAX_FLOW_NODES) {
    errors.push({
      code: "MAX_NODES_EXCEEDED",
      message: `El grafo excede el límite seguro de ${MAX_FLOW_NODES} nodos.`
    });
  }
  if (edges.length > MAX_FLOW_EDGES) {
    errors.push({
      code: "MAX_EDGES_EXCEEDED",
      message: `El grafo excede el límite seguro de ${MAX_FLOW_EDGES} conexiones.`
    });
  }

  const nodeMap = new Map();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  const startNodes = nodes.filter((n) => n.type === NODE_TYPES.START);
  if (startNodes.length === 0) {
    errors.push({
      code: "MISSING_START_NODE",
      message: "Falta el nodo de Inicio ('start'). Todo flujo avanzado debe tener exactamente un nodo de Inicio."
    });
  } else if (startNodes.length > 1) {
    for (const sn of startNodes.slice(1)) {
      addNodeIssue(
        sn.id,
        "error",
        "MULTIPLE_START_NODES",
        "Existe más de un nodo de Inicio. Conserva únicamente un nodo 'start'."
      );
    }
  }

  const endNodes = nodes.filter(
    (n) => n.type === NODE_TYPES.END_SUCCESS || n.type === NODE_TYPES.END_ERROR
  );
  if (endNodes.length === 0) {
    errors.push({
      code: "MISSING_END_NODE",
      message: "El grafo no tiene ningún nodo de finalización ('Fin Exitoso' o 'Fin con Error')."
    });
  }

  const outgoingByNode = new Map();
  const incomingByNode = new Map();
  for (const n of nodes) {
    outgoingByNode.set(n.id, []);
    incomingByNode.set(n.id, []);
  }

  for (const e of edges) {
    const srcNode = nodeMap.get(e.source);
    const tgtNode = nodeMap.get(e.target);
    if (!srcNode || !tgtNode) {
      addEdgeIssue(
        e.id,
        "error",
        "BROKEN_EDGE_REFERENCE",
        `Conexión rota (${e.id}): el nodo origen o destino no existe.`
      );
      continue;
    }
    if (e.source === e.target) {
      addEdgeIssue(
        e.id,
        "error",
        "SELF_LOOP_EDGE",
        `El nodo «${srcNode.label}» está conectado directamente a sí mismo sin condición de salida.`
      );
    }
    outgoingByNode.get(e.source).push(e);
    incomingByNode.get(e.target).push(e);
  }

  const requestMap = new Map(allRequests.map((r) => [r.id, r]));
  const allFlows = state?.customFlows || [];

  for (const n of nodes) {
    const deps = extractNodeVariableDependencies(n, allRequests);
    dataflowByNode[n.id] = {
      ...deps,
      undefinedInSomePaths: [],
      missingSecrets: []
    };

    if (n.type === NODE_TYPES.GROUP_NOTE) continue;

    const outs = outgoingByNode.get(n.id) || [];
    const onSuccessPol = normalizePolicyValue(n.config?.policies?.onSuccess ?? n.config?.onSuccess);
    if (
      n.type !== NODE_TYPES.END_SUCCESS &&
      n.type !== NODE_TYPES.END_ERROR &&
      outs.length === 0 &&
      !(n.type === NODE_TYPES.HTTP_REQUEST && onSuccessPol === "stop_flow")
    ) {
      addNodeIssue(
        n.id,
        "error",
        "NODE_WITHOUT_OUTPUT",
        `El nodo «${n.label}» no tiene conexiones de salida hacia otro paso o nodo de fin.`
      );
    }

    if (n.type === NODE_TYPES.HTTP_REQUEST) {
      const reqId = n.config?.requestId;
      if (!reqId || !requestMap.has(reqId)) {
        addNodeIssue(
          n.id,
          "error",
          "INVALID_REQUEST_REF",
          `El nodo «${n.label}» no tiene un endpoint válido asociado.`
        );
      }
    } else if (n.type === NODE_TYPES.SUBFLOW) {
      const targetFlowId = n.config?.targetFlowId || n.config?.subflowId;
      if (!targetFlowId) {
        addNodeIssue(
          n.id,
          "error",
          "INVALID_SUBFLOW_REF",
          `El nodo de subflujo «${n.label}» no especifica un flujo destino.`
        );
      } else if (targetFlowId === flow.id) {
        addNodeIssue(
          n.id,
          "error",
          "RECURSIVE_SUBFLOW",
          `El subflujo «${n.label}» se referencia a sí mismo recursivamente.`
        );
      } else if (allFlows.length > 0 && !allFlows.some((f) => f.id === targetFlowId)) {
        addNodeIssue(
          n.id,
          "error",
          "SUBFLOW_NOT_FOUND",
          `El subflujo referenciado (${targetFlowId}) no existe.`
        );
      }
    }

    if (state && state.secretVault) {
      for (const secKey of deps.consumedSecrets) {
        if (state.secretVault[secKey] === undefined || state.secretVault[secKey] === "") {
          dataflowByNode[n.id].missingSecrets.push(secKey);
          addNodeIssue(
            n.id,
            "warning",
            "MISSING_SECRET_REF",
            `El nodo «${n.label}» usa \${secret:${secKey}}, pero ese secreto no está registrado en la bóveda.`
          );
        }
      }
    }
  }

  if (startNodes.length > 0) {
    const startId = startNodes[0].id;
    const reachable = new Set();
    const queue = [startId];
    while (queue.length > 0) {
      const curr = queue.shift();
      if (reachable.has(curr)) continue;
      reachable.add(curr);
      for (const edge of outgoingByNode.get(curr) || []) {
        if (!reachable.has(edge.target)) {
          queue.push(edge.target);
        }
      }
    }

    for (const n of nodes) {
      if (n.type === NODE_TYPES.GROUP_NOTE) continue;
      if (!reachable.has(n.id)) {
        addNodeIssue(
          n.id,
          "error",
          "UNREACHABLE_NODE",
          `El nodo «${n.label}» es inaccesible desde el nodo de Inicio.`
        );
      }
    }

    const color = new Map();
    let cycleFound = false;
    const cycleNodes = new Set();

    const dfsCycle = (u) => {
      color.set(u, 1);
      for (const edge of outgoingByNode.get(u) || []) {
        const v = edge.target;
        const c = color.get(v) || 0;
        if (c === 1) {
          cycleFound = true;
          cycleNodes.add(u);
          cycleNodes.add(v);
        } else if (c === 0) {
          dfsCycle(v);
        }
      }
      color.set(u, 2);
    };
    dfsCycle(startId);

    if (cycleFound) {
      const maxIter = Number(flow.graph.settings?.maxIterations ?? 0);
      if (!Number.isFinite(maxIter) || maxIter <= 0 || maxIter > 100) {
        for (const cnId of cycleNodes) {
          addNodeIssue(
            cnId,
            "error",
            "UNBOUNDED_CYCLE",
            "Se detectó un ciclo sin un límite máximo de iteraciones válido (1–100)."
          );
        }
      } else {
        let hasExitFromCycle = false;
        for (const cnId of cycleNodes) {
          for (const edge of outgoingByNode.get(cnId) || []) {
            if (!cycleNodes.has(edge.target)) {
              hasExitFromCycle = true;
            }
          }
        }
        if (!hasExitFromCycle) {
          for (const cnId of cycleNodes) {
            addNodeIssue(
              cnId,
              "error",
              "INFINITE_CYCLE_NO_EXIT",
              "Ciclo cerrado infinito: los nodos del bucle no tienen ninguna rama de salida hacia un nodo de fin."
            );
          }
        } else {
          warnings.push({
            code: "BOUNDED_CYCLE_INFO",
            message: `Bucle controlado detectado (límite configurado: máx. ${maxIter} iteraciones).`
          });
        }
      }
    }

    const allPossibleVars = new Set(getInitiallyDefinedVariables(flow, state));
    for (const n of nodes) {
      for (const pv of dataflowByNode[n.id]?.producedVars || []) {
        allPossibleVars.add(pv);
      }
    }

    const mustDefined = new Map();
    const initialSet = getInitiallyDefinedVariables(flow, state);
    for (const n of nodes) {
      if (n.id === startId) {
        mustDefined.set(n.id, new Set(initialSet));
      } else {
        mustDefined.set(n.id, new Set(allPossibleVars));
      }
    }

    let changed = true;
    let passes = 0;
    while (changed && passes < nodes.length + 4) {
      changed = false;
      passes++;
      for (const n of nodes) {
        if (n.id === startId || !reachable.has(n.id) || n.type === NODE_TYPES.GROUP_NOTE) continue;
        const inEdges = (incomingByNode.get(n.id) || []).filter((e) => reachable.has(e.source));
        if (inEdges.length === 0) continue;

        let intersection = null;
        for (const edge of inEdges) {
          const predSet = mustDefined.get(edge.source) || new Set();
          const predProduced = dataflowByNode[edge.source]?.producedVars || [];
          const combined = new Set([...predSet, ...predProduced]);
          if (intersection === null) {
            intersection = combined;
          } else {
            intersection = new Set([...intersection].filter((x) => combined.has(x)));
          }
        }
        if (intersection) {
          const current = mustDefined.get(n.id);
          if (current.size !== intersection.size || [...current].some((x) => !intersection.has(x))) {
            mustDefined.set(n.id, intersection);
            changed = true;
          }
        }
      }
    }

    for (const n of nodes) {
      if (!reachable.has(n.id) || n.type === NODE_TYPES.GROUP_NOTE) continue;
      const availableBeforeNode = mustDefined.get(n.id) || initialSet;
      const deps = dataflowByNode[n.id];
      for (const reqVar of deps.consumedVars) {
        if (!availableBeforeNode.has(reqVar)) {
          deps.undefinedInSomePaths.push(reqVar);
          addNodeIssue(
            n.id,
            "warning",
            "VAR_NOT_DEFINED_ON_ALL_PATHS",
            `La variable \${${reqVar}} se usa en «${n.label}» antes de estar definida en todas las rutas posibles.`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    nodeIssues,
    edgeIssues,
    dataflowByNode
  };
}
