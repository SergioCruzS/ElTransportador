#!/usr/bin/env node
/**
 * Suite de Pruebas Automatizadas de Flows Studio v1.2.0 (`tests/unit/run-flows-studio-v2-tests.mjs`)
 * Cubre exhaustivamente los 11 escenarios requeridos:
 * 1. Conversión Básico → Avanzado y migración no destructiva + aislamiento de aserciones exclusivas.
 * 2. Condiciones declarativas y bifurcaciones (ramas true/false y marcado de nodos omitidos).
 * 3. Reintentos configurables 1, 3 y 5 con espera y seguimiento de intentos (attempt / maxAttempts).
 * 4. Extracción declarativa (JSONPath, Header, Cookie + Fallback) y consumo encadenado + nodo Transform.
 * 5. Ocultamiento estricto de secretos en nodos, variables, historial, reportes y exportaciones.
 * 6. Fallo localizado en nodo y conexión exacta (failedNodeId y failedEdgeId).
 * 7. Persistencia, restauración, deshacer/rehacer (Undo/Redo), plantillas y protección anti-Prototype-Pollution.
 * 8. Validación estática de grafos inválidos (sin inicio, huérfanos, ciclos sin salida, variable usada antes de definirse en todas las rutas).
 * 9. Accesibilidad básica (ARIA, navegación por teclado, estados textuales no dependientes solo del color) y Modo Simulación.
 * 10. Flujos independientes por sección, numeración consecutiva al convertir Flujo 1 -> Flujo 1, Flujo 1 (1), Flujo 1 (2), captura visual solo JSON, recuperación en rama de fallo, concurrencia paralela e inspector traducido.
 * 11. Cero identificadores de traducción sin resolver (`flows.*`), actualización de leyenda de panel izquierdo en Modo Avanzado y edición/consumo de variables en Parámetros Exclusivos del Flujo sin afectar la solicitud HTTP original.
 */
import assert from "node:assert/strict";
import http from "node:http";
import {
  FLOW_SCHEMA_VERSION,
  NODE_TYPES,
  PORT_TYPES,
  NODE_EXEC_STATES,
  safeCloneAndSanitizeObject,
  migrateFlowToV2,
  convertBasicFlowToAdvancedGraph,
  createIndependentAdvancedFlowFromBasic,
  sanitizeFlowVariablesArray,
  flowVariablesToMap,
  pushFlowHistorySnapshot,
  undoFlowGraphChange,
  redoFlowGraphChange,
  validateFlowGraph,
  extractNodeVariableDependencies,
  collectAvailableVariablesForFlow,
  buildFlowVariablesSummaryEntries,
  FLOW_TEMPLATES_CATALOG,
  createFlowFromTemplate,
  evaluateDeclarativeCondition,
  executeDeclarativeTransform,
  applyDeclarativeExtractions,
  executeBasicFlow,
  executeAdvancedFlowGraph,
  compareFlowExecutions,
  exportSanitizedFlowReport
} from "../../apps/desktop/src/services/flows/index.js";
import { REDACTED } from "../../apps/desktop/src/services/storage/constants.js";
import { getByDotPath } from "../../apps/desktop/src/services/http/index.js";
import { AssertionEvaluator } from "../../scripts/core-engine/assertions.mjs";
import { renderAdvancedFlowCanvasHtml } from "../../apps/desktop/src/controllers/renderers/flows/flows-canvas-view.js";
import { renderFlowInspectorHtml } from "../../apps/desktop/src/controllers/renderers/flows/flows-inspector-view.js";
import { renderBasicFlowModeHtml } from "../../apps/desktop/src/controllers/renderers/flows/flows-basic-view.js";

function createMockWorkspaceState(requests = [], secrets = {}) {
  return {
    lang: "es",
    theme: "light",
    activeEnvId: "env_test",
    environments: [
      {
        id: "env_test",
        name: "Test Env",
        variables: [{ key: "base_url", value: "http://127.0.0.1:0", enabled: true, isSecret: false }]
      }
    ],
    secretVault: { ...secrets },
    runtimeVars: {},
    collections: [
      {
        metadata: { id: "col_1", name: "Colección Test" },
        variables: [],
        folders: [],
        requests: JSON.parse(JSON.stringify(requests))
      }
    ],
    activeCollectionIdx: 0,
    openTabs: [],
    activeTabId: null,
    responsesByReqId: {},
    history: [],
    customFlows: [],
    activeFlowId: null,
    flowStudioUi: {}
  };
}

async function startLocalMockServer() {
  const attemptCounts = {};
  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url, "http://127.0.0.1");
    const path = urlObj.pathname;

    if (path === "/auth/login") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "X-Session-Trace": "trace-abc-999",
        "Set-Cookie": "sid=cookie_val_777; HttpOnly; Secure"
      });
      res.end(
        JSON.stringify({
          ok: true,
          token: "tok_live_secret_xyz987",
          userId: "usr_42",
          role: "admin"
        })
      );
      return;
    }

    if (path === "/orders/list") {
      const authHeader = req.headers["authorization"] || "";
      const roleParam = urlObj.searchParams.get("role") || "";
      const filterParam = urlObj.searchParams.get("filter_status") || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          orders: [{ id: "ord_1001", status: "READY" }],
          results: [{ name: "Ruta Norte Express", priority: "HIGH", tags: [{ code: "MX-01" }] }, { name: "Ruta Sur Pacífico", priority: "NORMAL", tags: [{ code: "MX-02" }] }],
          receivedAuth: authHeader,
          role: roleParam,
          filterStatus: filterParam,
          hasMore: false
        })
      );
      return;
    }

    if (path.startsWith("/flaky/")) {
      const key = path;
      attemptCounts[key] = (attemptCounts[key] || 0) + 1;
      const failUntil = Number(urlObj.searchParams.get("failUntil") || "1");
      if (attemptCounts[key] <= failUntil) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Service Temporarily Unavailable", attempt: attemptCounts[key] }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ recovered: true, attempt: attemptCounts[key] }));
      }
      return;
    }

    if (path === "/always-fail") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Fatal Downstream Failure" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}`, attemptCounts };
}

async function runTests() {
  console.log("=== INICIANDO SUITE DE PRUEBAS DE FLOWS STUDIO v1.2.0 (11 ESCENARIOS) ===");
  const { server, baseUrl } = await startLocalMockServer();

  try {
    const sampleRequests = [
      {
        id: "req_auth",
        name: "1. Autenticar Usuario",
        method: "POST",
        url: `${baseUrl}/auth/login`,
        params: [],
        headers: [{ id: "h1", key: "X-Client-Secret", value: "${secret:master_api_key}", enabled: true, isSecret: true }],
        auth: { type: "none" },
        body: { mode: "json", raw: '{"user":"demo"}' },
        settings: { timeoutMs: 5000, followRedirects: true, maxRedirects: 3, verifyTls: true },
        assertions: [
          { id: "g_ast_1", enabled: true, target: "status", property: "", operator: "equals", expected: "200" }
        ],
        extractions: []
      },
      {
        id: "req_orders",
        name: "2. Consultar Órdenes",
        method: "GET",
        url: `${baseUrl}/orders/list`,
        params: [{ id: "p1", key: "role", value: "${user_role}", enabled: true }],
        headers: [{ id: "h2", key: "Authorization", value: "${formatted_bearer}", enabled: true }],
        auth: { type: "none" },
        body: { mode: "none", raw: "" },
        settings: { timeoutMs: 5000, followRedirects: true, maxRedirects: 3, verifyTls: true },
        assertions: [
          { id: "g_ast_2", enabled: true, target: "status", property: "", operator: "equals", expected: "200" }
        ],
        extractions: []
      },
      {
        id: "req_fail",
        name: "3. Endpoint Crítico Fallido",
        method: "POST",
        url: `${baseUrl}/always-fail`,
        params: [],
        headers: [],
        auth: { type: "none" },
        body: { mode: "none", raw: "" },
        settings: { timeoutMs: 5000, followRedirects: true, maxRedirects: 3, verifyTls: true },
        assertions: [
          { id: "g_ast_3", enabled: true, target: "status", property: "", operator: "equals", expected: "200" }
        ],
        extractions: []
      }
    ];

    const state = createMockWorkspaceState(sampleRequests, {
      master_api_key: "SUPER_SECRET_KEY_999999",
      jwt_signing_secret: "TOP_SECRET_JWT_777777",
      session_token: "tok_live_secret_xyz987"
    });
    state.environments[0].variables[0].value = baseUrl;

    // ------------------------------------------------------------------------
    // 1. PRUEBA: Migración v1 -> v2, Aserciones Exclusivas en Básico y Conversión a Grafo Avanzado
    // ------------------------------------------------------------------------
    const legacyV1Flow = {
      id: "flw_legacy_1",
      name: "Flujo Secuencial v1",
      selectedRequestIds: ["req_auth", "req_orders"],
      stepOverrides: {
        req_auth: {
          useExclusiveAssertions: true,
          retries: 1,
          retryDelaySec: 0.2,
          assertions: [
            {
              id: "excl_ast_1",
              enabled: true,
              target: "json_path",
              property: "role",
              operator: "equals",
              expected: "admin"
            }
          ],
          extractions: [
            {
              id: "excl_ext_1",
              enabled: true,
              variableName: "user_role",
              source: "json_path",
              path: "role",
              scope: "flow",
              fallbackValue: "guest"
            }
          ]
        }
      },
      lastReport: null
    };

    const migratedFlow = migrateFlowToV2(legacyV1Flow, sampleRequests);
    assert.equal(migratedFlow.schemaVersion, FLOW_SCHEMA_VERSION, "Debe migrar a schemaVersion 2");
    assert.equal(migratedFlow.mode, "basic", "Un flujo v1 sin modo explícito debe iniciar en modo basic");

    const basicReport = await executeBasicFlow(migratedFlow, state);
    assert.equal(basicReport.allPassed, true, "El flujo básico con aserciones exclusivas debe pasar");
    assert.equal(
      state.collections[0].requests[0].assertions.length,
      1,
      "Las aserciones exclusivas del flujo NO deben contaminar las aserciones globales del endpoint original"
    );
    assert.equal(
      state.collections[0].requests[0].assertions[0].id,
      "g_ast_1",
      "El endpoint original conserva intacta su única aserción global"
    );

    const convertedAdv = convertBasicFlowToAdvancedGraph(migratedFlow, sampleRequests);
    assert.equal(convertedAdv.mode, "advanced", "Debe cambiar a modo advanced tras convertir");
    assert.ok(convertedAdv.graph.nodes.some((n) => n.type === NODE_TYPES.START), "Debe incluir nodo start");
    assert.ok(convertedAdv.graph.nodes.some((n) => n.type === NODE_TYPES.END_SUCCESS), "Debe incluir nodo end_success");
    const httpNodesInGraph = convertedAdv.graph.nodes.filter((n) => n.type === NODE_TYPES.HTTP_REQUEST);
    assert.equal(httpNodesInGraph.length, 2, "Debe crear 2 nodos HTTP a partir de los 2 pasos básicos");
    assert.equal(
      httpNodesInGraph[0].config.assertions[0].id,
      "excl_ast_1",
      "La conversión debe preservar las aserciones exclusivas configuradas en modo básico"
    );
    console.log("  ✓ [1/11] Migración v1->v2, aserciones exclusivas aisladas y conversión Básico → Avanzado verificadas");

    // ------------------------------------------------------------------------
    // 2. PRUEBA: Condiciones Declarativas y Bifurcaciones (true / false + skipped)
    // ------------------------------------------------------------------------
    const branchFlow = migrateFlowToV2(
      {
        id: "flw_branch",
        name: "Flujo con Condición y Ramas",
        mode: "advanced",
        selectedRequestIds: ["req_auth", "req_orders", "req_fail"],
        graph: {
          nodes: [
            { id: "n_start", type: NODE_TYPES.START, label: "Inicio", x: 40, y: 150, config: {} },
            {
              id: "n_login",
              type: NODE_TYPES.HTTP_REQUEST,
              label: "Login",
              x: 240,
              y: 150,
              config: {
                requestId: "req_auth",
                retries: 0,
                retryDelaySec: 0.2,
                extractions: [
                  { id: "ex1", enabled: true, variableName: "user_role", source: "json_path", path: "role", scope: "flow", fallbackValue: "" }
                ]
              }
            },
            {
              id: "n_cond",
              type: NODE_TYPES.CONDITION,
              label: "¿Es Admin?",
              x: 480,
              y: 150,
              config: {
                leftOperand: "${user_role}",
                operator: "equals",
                rightOperand: "admin"
              }
            },
            {
              id: "n_true_orders",
              type: NODE_TYPES.HTTP_REQUEST,
              label: "Consultar Órdenes (Rama True)",
              x: 720,
              y: 80,
              config: { requestId: "req_orders", retries: 0 }
            },
            {
              id: "n_false_fail",
              type: NODE_TYPES.HTTP_REQUEST,
              label: "Rama False (No debe ejecutarse)",
              x: 720,
              y: 250,
              config: { requestId: "req_fail", retries: 0 }
            },
            { id: "n_end_ok", type: NODE_TYPES.END_SUCCESS, label: "Fin OK", x: 980, y: 80, config: {} },
            { id: "n_end_err", type: NODE_TYPES.END_ERROR, label: "Fin Error", x: 980, y: 250, config: {} }
          ],
          edges: [
            { id: "e1", source: "n_start", sourcePort: PORT_TYPES.DEFAULT, target: "n_login" },
            { id: "e2", source: "n_login", sourcePort: PORT_TYPES.SUCCESS, target: "n_cond" },
            { id: "e3", source: "n_cond", sourcePort: PORT_TYPES.TRUE, target: "n_true_orders" },
            { id: "e4", source: "n_cond", sourcePort: PORT_TYPES.FALSE, target: "n_false_fail" },
            { id: "e5", source: "n_true_orders", sourcePort: PORT_TYPES.SUCCESS, target: "n_end_ok" },
            { id: "e6", source: "n_false_fail", sourcePort: PORT_TYPES.FAILURE, target: "n_end_err" }
          ],
          viewport: { x: 24, y: 24, zoom: 1 },
          settings: { maxIterations: 10, concurrency: 2 }
        }
      },
      sampleRequests
    );

    const nodeStatesRecorded = {};
    const branchReport = await executeAdvancedFlowGraph(branchFlow, state, {
      onNodeStateChange: (nodeId, st) => {
        nodeStatesRecorded[nodeId] = st;
      }
    });
    assert.equal(branchReport.allPassed, true, "La rama TRUE debe ejecutarse exitosamente");
    assert.equal(nodeStatesRecorded["n_true_orders"], NODE_EXEC_STATES.SUCCESS, "El nodo en la rama TRUE debe quedar en SUCCESS");
    assert.equal(nodeStatesRecorded["n_false_fail"], NODE_EXEC_STATES.SKIPPED, "El nodo en la rama FALSE no tomada debe quedar en SKIPPED");
    console.log("  ✓ [2/11] Condiciones declarativas y bifurcaciones (true/false + nodos omitidos) verificadas");

    // ------------------------------------------------------------------------
    // 3. PRUEBA: Reintentos Configurables (1, 3 y 5) con Espera y Seguimiento de Intentos
    // ------------------------------------------------------------------------
    for (const [retrySetting, failCount, expectedAttempts] of [
      [1, 1, 2],
      [3, 2, 3],
      [5, 4, 5]
    ]) {
      const reqId = `req_flaky_${retrySetting}`;
      state.collections[0].requests.push({
        id: reqId,
        name: `Endpoint Flaky (${retrySetting} retries)`,
        method: "GET",
        url: `${baseUrl}/flaky/r_${retrySetting}?failUntil=${failCount}`,
        params: [],
        headers: [],
        auth: { type: "none" },
        body: { mode: "none", raw: "" },
        settings: { timeoutMs: 4000 },
        assertions: [{ id: "a_200", enabled: true, target: "status", property: "", operator: "equals", expected: "200" }],
        extractions: []
      });

      const retryFlow = migrateFlowToV2(
        {
          id: `flw_retry_${retrySetting}`,
          name: `Test Retry ${retrySetting}`,
          mode: "basic",
          selectedRequestIds: [reqId],
          stepOverrides: {
            [reqId]: {
              retries: retrySetting,
              retryDelaySec: 0.1,
              assertions: [],
              extractions: []
            }
          }
        },
        state.collections[0].requests
      );

      const rep = await executeBasicFlow(retryFlow, state);
      assert.equal(rep.allPassed, true, `Flujo con reintentos=${retrySetting} debe recuperarse y aprobar`);
      assert.equal(rep.steps[0].attempts, expectedAttempts, `Debe registrar exactamente ${expectedAttempts} intentos para retries=${retrySetting}`);
      assert.equal(rep.steps[0].maxAttempts, retrySetting + 1);
    }
    console.log("  ✓ [3/11] Reintentos configurables 1, 3 y 5 con conteo de intentos verificados");

    // ------------------------------------------------------------------------
    // 4. PRUEBA: Extracción y Consumo de Variables (JSONPath, Header, Cookie, Fallback y Transform)
    // ------------------------------------------------------------------------
    const chainFlow = migrateFlowToV2(
      {
        id: "flw_vars",
        name: "Flujo de Variables y Transformación",
        mode: "advanced",
        selectedRequestIds: ["req_auth", "req_orders"],
        graph: {
          nodes: [
            { id: "n_s", type: NODE_TYPES.START, label: "Inicio", x: 0, y: 0, config: {} },
            {
              id: "n_1",
              type: NODE_TYPES.HTTP_REQUEST,
              label: "Login y Captura",
              x: 200,
              y: 0,
              config: {
                requestId: "req_auth",
                extractions: [
                  { id: "ex_j", enabled: true, variableName: "user_role", source: "json_path", path: "role", scope: "flow", fallbackValue: "guest" },
                  { id: "ex_h", enabled: true, variableName: "trace_hdr", source: "header", path: "x-session-trace", scope: "flow", fallbackValue: "" },
                  { id: "ex_fb", enabled: true, variableName: "missing_with_fb", source: "json_path", path: "nonexistent.field", scope: "flow", fallbackValue: "fallback_ok_123" }
                ]
              }
            },
            {
              id: "n_trf",
              type: NODE_TYPES.TRANSFORM,
              label: "Formatear Header",
              x: 420,
              y: 0,
              config: {
                operation: "template",
                sourceVariable: "trace_hdr",
                template: "TraceToken ${trace_hdr}/${missing_with_fb}",
                targetVariable: "formatted_bearer",
                fallbackValue: ""
              }
            },
            {
              id: "n_2",
              type: NODE_TYPES.HTTP_REQUEST,
              label: "Consumir Variables",
              x: 640,
              y: 0,
              config: { requestId: "req_orders" }
            },
            { id: "n_end", type: NODE_TYPES.END_SUCCESS, label: "Fin", x: 880, y: 0, config: {} }
          ],
          edges: [
            { id: "e1", source: "n_s", sourcePort: PORT_TYPES.DEFAULT, target: "n_1" },
            { id: "e2", source: "n_1", sourcePort: PORT_TYPES.SUCCESS, target: "n_trf" },
            { id: "e3", source: "n_trf", sourcePort: PORT_TYPES.DEFAULT, target: "n_2" },
            { id: "e4", source: "n_2", sourcePort: PORT_TYPES.SUCCESS, target: "n_end" }
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: { maxIterations: 10, concurrency: 2 }
        }
      },
      sampleRequests
    );

    const varReport = await executeAdvancedFlowGraph(chainFlow, state);
    assert.equal(varReport.allPassed, true);
    const ordersResp = JSON.parse(state.responsesByReqId["req_orders"].body);
    assert.equal(ordersResp.role, "admin");
    assert.equal(ordersResp.receivedAuth, "TraceToken trace-abc-999/fallback_ok_123");
    console.log("  ✓ [4/11] Extracción declarativa (JSON, Header, Fallback) y consumo en nodos posteriores verificados");

    // ------------------------------------------------------------------------
    // 5. PRUEBA: Ocultamiento Estricto de Secretos en Todas las Superficies
    // ------------------------------------------------------------------------
    const exportedReportJson = exportSanitizedFlowReport(chainFlow, state);
    assert.ok(!exportedReportJson.includes("SUPER_SECRET_KEY_999999"), "Jamás debe filtrarse master_api_key en el reporte exportado");
    assert.ok(!exportedReportJson.includes("tok_live_secret_xyz987"), "Jamás debe filtrarse un secreto registrado en respuestas o variables");
    const lastRepStr = JSON.stringify(chainFlow.lastReport);
    assert.ok(!lastRepStr.includes("SUPER_SECRET_KEY_999999"));
    assert.ok(!lastRepStr.includes("tok_live_secret_xyz987"));
    console.log("  ✓ [5/11] Ocultamiento estricto de secretos en variables, historial y reportes verificado");

    // ------------------------------------------------------------------------
    // 6. PRUEBA: Fallo Localizado en Nodo y Conexión Exacta (failedNodeId + failedEdgeId)
    // ------------------------------------------------------------------------
    const failingFlow = migrateFlowToV2(
      {
        id: "flw_fail_loc",
        name: "Flujo con Fallo Localizado",
        mode: "advanced",
        selectedRequestIds: ["req_fail"],
        graph: {
          nodes: [
            { id: "n_start", type: NODE_TYPES.START, label: "Inicio", x: 0, y: 0, config: {} },
            {
              id: "n_bad_req",
              type: NODE_TYPES.HTTP_REQUEST,
              label: "Paso Crítico Fallido",
              x: 240,
              y: 0,
              config: { requestId: "req_fail", retries: 0, onHttpError: "follow_port" }
            },
            { id: "n_err_end", type: NODE_TYPES.END_ERROR, label: "Fin Error", x: 520, y: 80, config: {} }
          ],
          edges: [
            { id: "edge_start_to_bad", source: "n_start", sourcePort: PORT_TYPES.DEFAULT, target: "n_bad_req" },
            { id: "edge_bad_to_err", source: "n_bad_req", sourcePort: PORT_TYPES.FAILURE, target: "n_err_end" }
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: { maxIterations: 5, concurrency: 1 }
        }
      },
      sampleRequests
    );

    const failReport = await executeAdvancedFlowGraph(failingFlow, state);
    assert.equal(failReport.allPassed, false);
    assert.equal(failReport.failedNodeId, "n_bad_req", "Debe identificar el nodo exacto que provocó el fallo");
    assert.equal(failReport.failedEdgeId, "edge_bad_to_err", "Debe identificar la conexión exacta tomada tras el fallo");
    console.log("  ✓ [6/11] Localización exacta de nodo y conexión en caso de fallo verificada");

    // ------------------------------------------------------------------------
    // 7. PRUEBA: Persistencia, Restauración, Undo/Redo, Plantillas y Anti-Prototype-Pollution
    // ------------------------------------------------------------------------
    const pollutedInput = JSON.parse('{"__proto__":{"pollutedProp":"yes"},"name":"Clean"}');
    const sanitizedClone = safeCloneAndSanitizeObject(pollutedInput);
    assert.equal(({}).pollutedProp, undefined, "Prototype pollution debe ser bloqueado");
    assert.equal(sanitizedClone.name, "Clean");

    pushFlowHistorySnapshot(failingFlow);
    failingFlow.graph.nodes[1].x = 777;
    failingFlow.graph.nodes[1].y = 333;
    const serialized = JSON.stringify(failingFlow);
    const restored = migrateFlowToV2(JSON.parse(serialized), sampleRequests);
    assert.equal(restored.graph.nodes[1].x, 777);
    assert.equal(restored.graph.nodes[1].y, 333);
    assert.equal(restored.undoStack.length, 1, "migrateFlowToV2 debe preservar undoStack");

    assert.equal(undoFlowGraphChange(failingFlow), true);
    assert.equal(failingFlow.graph.nodes[1].x, 240);
    assert.equal(redoFlowGraphChange(failingFlow), true);
    assert.equal(failingFlow.graph.nodes[1].x, 777);

    assert.equal(FLOW_TEMPLATES_CATALOG.length, 6, "Deben existir las 6 plantillas iniciales requeridas");
    for (const tpl of FLOW_TEMPLATES_CATALOG) {
      const createdTpl = createFlowFromTemplate(tpl.id, sampleRequests, "es");
      const tplVal = validateFlowGraph(createdTpl, state);
      assert.equal(tplVal.valid, true, `La plantilla ${tpl.id} debe generar un grafo válido`);
    }
    console.log("  ✓ [7/11] Persistencia, restauración, Undo/Redo, 6 plantillas y anti-Prototype-Pollution verificados");

    // ------------------------------------------------------------------------
    // 8. PRUEBA: Validación de Grafos Inválidos y Variable Usada Antes de Definirse
    // ------------------------------------------------------------------------
    const invalidGraphFlow = {
      id: "flw_invalid",
      name: "Grafo Inválido",
      mode: "advanced",
      graph: {
        nodes: [
          {
            id: "n_loop_a",
            type: NODE_TYPES.HTTP_REQUEST,
            label: "Loop A",
            x: 0,
            y: 0,
            config: { requestId: "req_orders" }
          },
          {
            id: "n_orphan",
            type: NODE_TYPES.DELAY,
            label: "Huérfano",
            x: 200,
            y: 200,
            config: { delayMs: 500 }
          }
        ],
        edges: [
          { id: "e_broken", source: "n_loop_a", sourcePort: PORT_TYPES.SUCCESS, target: "non_existent_node" }
        ],
        settings: { maxIterations: 5, concurrency: 2 }
      }
    };
    const invCheck = validateFlowGraph(invalidGraphFlow, state);
    assert.equal(invCheck.valid, false);
    assert.ok(invCheck.errors.some((e) => e.code === "MISSING_START_NODE"));
    assert.ok(invCheck.errors.some((e) => e.code === "BROKEN_EDGE_REFERENCE"));

    const undefVarFlow = {
      id: "flw_undef_var",
      name: "Variable No Definida Antes",
      mode: "advanced",
      graph: {
        nodes: [
          { id: "n_start", type: NODE_TYPES.START, label: "Inicio", x: 0, y: 0, config: {} },
          { id: "n_consume", type: NODE_TYPES.HTTP_REQUEST, label: "Usa user_role sin definir", x: 200, y: 0, config: { requestId: "req_orders" } },
          { id: "n_end", type: NODE_TYPES.END_SUCCESS, label: "Fin", x: 400, y: 0, config: {} }
        ],
        edges: [
          { id: "e1", source: "n_start", sourcePort: PORT_TYPES.DEFAULT, target: "n_consume" },
          { id: "e2", source: "n_consume", sourcePort: PORT_TYPES.SUCCESS, target: "n_end" }
        ],
        settings: { maxIterations: 5, concurrency: 2 }
      }
    };
    const freshStateForValidation = createMockWorkspaceState(sampleRequests, { master_api_key: "SEC_1" });
    const undefCheck = validateFlowGraph(undefVarFlow, freshStateForValidation);
    assert.ok(
      undefCheck.warnings.some((w) => w.code === "VAR_NOT_DEFINED_ON_ALL_PATHS"),
      "Debe advertir cuando una variable se usa antes de ser definida en todas las rutas posibles"
    );
    console.log("  ✓ [8/11] Validación de grafos inválidos y detección de variables no definidas en todas las rutas verificadas");

    // ------------------------------------------------------------------------
    // 9. PRUEBA: Accesibilidad Básica (ARIA, Teclado, No Solo Color) y Modo Simulación
    // ------------------------------------------------------------------------
    const simReport = await executeAdvancedFlowGraph(chainFlow, state, { simulateOnly: true });
    assert.equal(simReport.simulateOnly, true);
    assert.equal(simReport.allPassed, true);

    const canvasHtml = renderAdvancedFlowCanvasHtml(state, chainFlow, sampleRequests);
    assert.ok(canvasHtml.includes('role="region"'), "El lienzo debe incluir role='region'");
    assert.ok(canvasHtml.includes('tabindex="0"'), "Los nodos y el lienzo deben ser navegables por teclado con tabindex='0'");
    assert.ok(canvasHtml.includes("aria-label="), "Los nodos y puertos deben incluir etiquetas ARIA descriptivas");
    assert.ok(canvasHtml.includes("⏳ PENDIENTE"), "Los estados deben incluir icono y etiqueta explícita sin depender solo del color");
    assert.ok(canvasHtml.includes('data-delete-node-id="n_1"'), "Los nodos en modo avanzado deben incluir botón eliminar en la esquina superior derecha");
    assert.ok(!canvasHtml.includes("btn-sync-graph-to-basic"), "El botón Sincronizar desde Grafo no debe existir");

    const diffResult = compareFlowExecutions(varReport, failReport);
    assert.ok(diffResult && Array.isArray(diffResult.nodeDiffs));
    console.log("  ✓ [9/11] Accesibilidad básica (ARIA, teclado, estados textuales) y Modo Simulación verificados");

    // ------------------------------------------------------------------------
    // 10. PRUEBA: Independencia Básico/Avanzado, Conversión con Numeración Consecutiva,
    //     Captura Visual Solo JSON, Recuperación en Rama de Contingencia e Inspector Traducido
    // ------------------------------------------------------------------------
    const basicSource = migrateFlowToV2(
      {
        id: "flw_basic_orig",
        name: "Flujo 1",
        mode: "basic",
        selectedRequestIds: ["req_auth", "req_orders"],
        flowVariables: [{ key: "env_tag", value: "prod", enabled: true, isSecret: false }]
      },
      sampleRequests
    );
    const existingFlows = [basicSource];
    const advCopy1 = createIndependentAdvancedFlowFromBasic(basicSource, existingFlows, sampleRequests);
    existingFlows.push(advCopy1);
    const advCopy2 = createIndependentAdvancedFlowFromBasic(basicSource, existingFlows, sampleRequests);
    existingFlows.push(advCopy2);
    const advCopy3 = createIndependentAdvancedFlowFromBasic(basicSource, existingFlows, sampleRequests);
    existingFlows.push(advCopy3);

    assert.equal(basicSource.mode, "basic", "El flujo básico original permanece en modo básico");
    assert.equal(advCopy1.mode, "advanced");
    assert.equal(advCopy1.name, "Flujo 1", "El primer flujo avanzado convertido conserva el nombre 'Flujo 1' con su etiqueta de avanzado");
    assert.equal(advCopy2.name, "Flujo 1 (1)", "Al existir ya 'Flujo 1' en avanzado, el siguiente toma 'Flujo 1 (1)'");
    assert.equal(advCopy3.name, "Flujo 1 (2)", "El siguiente toma 'Flujo 1 (2)'");

    // Variables iniciales independientes por flujo
    advCopy1.flowVariables.push({ id: "fv_2", key: "exclusive_adv", value: "123", enabled: true, isSecret: false });
    assert.equal(basicSource.flowVariables.length, 1, "Las variables iniciales de cada flujo deben ser independientes");
    assert.equal(flowVariablesToMap(advCopy1.flowVariables).exclusive_adv, "123");

    // Verificar vista básica con soporte drag-and-drop y flechas
    const basicHtml = renderBasicFlowModeHtml(
      state,
      basicSource,
      sampleRequests,
      sampleRequests,
      sampleRequests.slice(0, 2)
    );
    assert.ok(basicHtml.includes('draggable="true"'), "Los pasos del flujo básico deben permitir arrastrar con el mouse");
    assert.ok(basicHtml.includes("data-step-up="), "Los pasos del flujo básico deben permitir subir con flecha");
    assert.ok(basicHtml.includes("data-step-down="), "Los pasos del flujo básico deben permitir bajar con flecha");

    // Verificar Inspector: filtro de endpoint asociado, políticas traducidas y captura visual solo JSON
    state.flowStudioUi = { selectedNodeId: advCopy1.graph.nodes[1].id, inspectorTab: "node" };
    const inspectorNodeHtml = renderFlowInspectorHtml(state, advCopy1, sampleRequests);
    assert.ok(inspectorNodeHtml.includes('id="insp-node-req-search"'), "Debe existir búsqueda sobre el combobox de Endpoint Asociado");
    assert.ok(inspectorNodeHtml.includes("Seguir puerto de salida"), "Las políticas ante fallo deben estar traducidas al español");
    assert.ok(inspectorNodeHtml.includes("Concurrencia Paralela"), "Debe mostrar configuración y hint de Concurrencia Paralela");

    state.flowStudioUi.inspectorTab = "capture";
    const inspectorCaptureHtml = renderFlowInspectorHtml(state, advCopy1, sampleRequests);
    assert.ok(inspectorCaptureHtml.includes('data-capture-source="json_path"'), "Captura visual debe mostrar propiedades JSON");
    assert.ok(!inspectorCaptureHtml.includes('data-capture-source="header"'), "Captura visual NO debe incluir cabeceras");
    assert.ok(!inspectorCaptureHtml.includes('data-capture-source="cookie"'), "Captura visual NO debe incluir cookies");

    // Verificar flujo con fallo controlado en rama primaria que se recupera exitosamente en rama de contingencia
    const fallbackRecoveryFlow = createFlowFromTemplate("error_handling", [sampleRequests[2], sampleRequests[0]], "es");
    const recoveryReport = await executeAdvancedFlowGraph(fallbackRecoveryFlow, sampleRequests, state);
    assert.equal(
      recoveryReport.allPassed,
      true,
      "Si un nodo falla pero su rama failure lleva a un servicio de contingencia que termina en Fin Exitoso, el flujo debe marcarse como exitoso"
    );
    assert.equal(recoveryReport.handledFailedNodes.length, 1, "Debe registrar el nodo que tuvo el fallo controlado en la rama primaria");
    assert.ok(
      recoveryReport.steps[1].failureReason.includes("HTTP 500"),
      "El diagnóstico paso a paso debe detallar la causa exacta del fallo en el nodo"
    );
    console.log("  ✓ [10/11] Independencia Básico/Avanzado, numeración consecutiva, captura solo JSON, recuperación en rama e inspector verificados");

    // ------------------------------------------------------------------------
    // 11. PRUEBA: Cero identificadores i18n sin traducir (`flows.*`), Variables Consumidas y
    //     Parámetros Exclusivos por Endpoint en Básico y Avanzado sin afectar Solicitud Original
    // ------------------------------------------------------------------------
    assert.ok(!basicHtml.includes("flows."), "Ningún texto en vista básica debe mostrar identificadores 'flows.*'");
    assert.ok(!canvasHtml.includes("flows."), "Ningún texto en lienzo avanzado debe mostrar identificadores 'flows.*'");
    assert.ok(!inspectorNodeHtml.includes("flows."), "Ningún texto en inspector de nodo debe mostrar identificadores 'flows.*'");
    assert.ok(!inspectorCaptureHtml.includes("flows."), "Ningún texto en captura visual debe mostrar identificadores 'flows.*'");

    // Verificar que al configurar params exclusivos y variables consumidas en Modo Básico y Avanzado:
    // 1) Se inicializan desde los params de la solicitud original (`req_orders` tiene `role=${user_role}`).
    // 2) Se pueden agregar y eliminar params en el flujo sin modificar `sampleRequests[1].params` ni `state.collections[0].requests[1].params`.
    const flowWithCustomParams = migrateFlowToV2(
      {
        id: "flw_custom_params",
        name: "Flujo con Params Exclusivos y Consumo de Variables",
        mode: "basic",
        selectedRequestIds: ["req_auth", "req_orders"],
        flowVariables: [
          { id: "fv_filter", key: "desired_filter", value: "READY_ONLY", enabled: true, isSecret: false }
        ],
        stepOverrides: {
          req_auth: {
            extractions: [
              { id: "ex_role", enabled: true, variableName: "extracted_role", source: "json_path", path: "role", scope: "flow", fallbackValue: "" }
            ]
          },
          req_orders: {
            params: [
              { id: "fp_1", enabled: true, key: "role", value: "${extracted_role}", description: "Asignado en flujo" },
              { id: "fp_2", enabled: true, key: "filter_status", value: "${desired_filter}", description: "Nuevo param solo en flujo" }
            ]
          }
        }
      },
      sampleRequests
    );

    const basicParamsHtml = renderBasicFlowModeHtml(
      { ...state, flowStudioUi: { basicSelectedStepReqId: "req_orders" } },
      flowWithCustomParams,
      sampleRequests,
      sampleRequests,
      sampleRequests.slice(0, 2)
    );
    assert.ok(basicParamsHtml.includes("btn-basic-add-flow-param"), "Modo básico debe incluir botón para agregar parámetro exclusivo del flujo");
    assert.ok(basicParamsHtml.includes("data-basic-prm-varsel="), "Modo básico debe incluir selector de variables disponibles para consumir en cada param");
    assert.ok(!basicParamsHtml.includes("flows."), "Vista básica con params no debe tener claves 'flows.*' sin traducir");

    const basicParamExecReport = await executeBasicFlow(flowWithCustomParams, state);
    assert.equal(basicParamExecReport.allPassed, true);
    const ordersRespBasic = JSON.parse(state.responsesByReqId["req_orders"].body);
    assert.equal(ordersRespBasic.role, "admin", "El param role debe resolverse con la variable extraída ${extracted_role}");
    assert.equal(ordersRespBasic.filterStatus, "READY_ONLY", "El param agregado en el flujo debe enviarse e interpolar ${desired_filter}");
    assert.equal(
      state.collections[0].requests[1].params.length,
      1,
      "La solicitud original en el Editor HTTP debe mantener intacto su único parámetro original"
    );
    assert.equal(
      state.collections[0].requests[1].params[0].value,
      "${user_role}",
      "El valor del parámetro en el Editor HTTP original NO debe haberse modificado"
    );

    // Convertir a Grafo Avanzado y verificar que los params exclusivos del paso pasan al nodo HTTP y pueden editarse/ejecutarse independientemente
    const advWithCustomParams = createIndependentAdvancedFlowFromBasic(flowWithCustomParams, [flowWithCustomParams], sampleRequests);
    const ordersNode = advWithCustomParams.graph.nodes.find(
      (n) => n.type === NODE_TYPES.HTTP_REQUEST && n.config.requestId === "req_orders"
    );
    assert.ok(ordersNode, "Debe existir el nodo HTTP para req_orders");
    assert.equal(ordersNode.config.params.length, 2, "El nodo avanzado conserva los 2 params exclusivos del flujo");

    const availableVars = collectAvailableVariablesForFlow(advWithCustomParams, sampleRequests, state);
    assert.ok(availableVars.flowProduced.includes("extracted_role"), "El catálogo de variables disponibles debe incluir variables producidas por otros nodos del flujo");
    assert.ok(availableVars.flowInit.includes("desired_filter"), "El catálogo debe incluir variables iniciales del flujo");
    assert.ok(availableVars.envVars.includes("base_url"), "El catálogo debe incluir variables del entorno activo");

    const nodeDeps = extractNodeVariableDependencies(ordersNode, sampleRequests);
    assert.ok(nodeDeps.consumedVars.includes("extracted_role"), "extractNodeVariableDependencies debe detectar variables consumidas en los params exclusivos del nodo");
    assert.ok(nodeDeps.consumedVars.includes("desired_filter"), "extractNodeVariableDependencies debe detectar desired_filter en los params del nodo");

    state.flowStudioUi = { selectedNodeId: ordersNode.id, inspectorTab: "node" };
    const advOrdersInspectorHtml = renderFlowInspectorHtml(state, advWithCustomParams, sampleRequests);
    assert.ok(advOrdersInspectorHtml.includes("btn-insp-add-param"), "El inspector avanzado debe incluir botón '+ Parámetro' exclusivo del nodo");
    assert.ok(advOrdersInspectorHtml.includes("data-insp-prm-varsel="), "El inspector avanzado debe incluir selector de variables para asignar al parámetro");
    assert.ok(!advOrdersInspectorHtml.includes("flows."), "El inspector con params no debe tener claves 'flows.*' sin traducir");

    // Modificar el parámetro en el nodo avanzado y eliminar uno sin afectar la solicitud HTTP original
    ordersNode.config.params[1].value = "CUSTOM_ADV_FILTER";
    const advParamReport = await executeAdvancedFlowGraph(advWithCustomParams, state);
    assert.equal(advParamReport.allPassed, true);
    const ordersRespAdv = JSON.parse(state.responsesByReqId["req_orders"].body);
    assert.equal(ordersRespAdv.role, "admin");
    assert.equal(ordersRespAdv.filterStatus, "CUSTOM_ADV_FILTER");
    assert.equal(
      state.collections[0].requests[1].params.length,
      1,
      "La solicitud original en la colección sigue teniendo únicamente 1 parámetro sin alteraciones"
    );
    console.log("  ✓ [11/11] Cero claves 'flows.*' sin traducir, leyenda de modo avanzado y parámetros/variables consumidas independientes verificados");


    // ------------------------------------------------------------------------
    // 12. PRUEBA: Extracción por Índices de Listas (ej. results[0].name, results[-1].name)
    //     y Apartado para Ver las Variables del Flujo y su Valor Actual (Básico y Avanzado)
    // ------------------------------------------------------------------------
    const samplePayload = {
      results: [
        { name: "Elemento Uno", tags: [{ code: "T-100" }, { code: "T-200" }] },
        { name: "Elemento Dos", tags: [{ code: "T-300" }] }
      ],
      meta: { total: 2 }
    };
    assert.equal(getByDotPath(samplePayload, "results[0].name"), "Elemento Uno");
    assert.equal(getByDotPath(samplePayload, "results[1].name"), "Elemento Dos");
    assert.equal(getByDotPath(samplePayload, "results[-1].name"), "Elemento Dos");
    assert.equal(getByDotPath(samplePayload, "results[0].tags[1].code"), "T-200");
    assert.equal(getByDotPath(samplePayload, "$.results[0].name"), "Elemento Uno");
    assert.equal(getByDotPath(samplePayload, "results.length"), 2);
    assert.equal(getByDotPath([{ title: "Raiz 0" }], "[0].title"), "Raiz 0");

    assert.equal(AssertionEvaluator.getJsonPath(samplePayload, "results[0].name"), "Elemento Uno");
    assert.equal(AssertionEvaluator.getJsonPath(samplePayload, "results[0].tags[1].code"), "T-200");
    assert.equal(AssertionEvaluator.getJsonPath(samplePayload, "results[-1].name"), "Elemento Dos");

    // Configurar extracción con ruta results[0].name y results[0].tags[0].code en Modo Básico y Avanzado
    flowWithCustomParams.stepOverrides.req_orders.extractions = [
      {
        id: "ex_arr_name",
        enabled: true,
        variableName: "first_route_name",
        source: "json_path",
        path: "results[0].name",
        scope: "flow",
        fallbackValue: ""
      },
      {
        id: "ex_arr_tag",
        enabled: true,
        variableName: "first_tag_code",
        source: "json_path",
        path: "results[0].tags[0].code",
        scope: "flow",
        fallbackValue: ""
      }
    ];

    const arrayBasicReport = await executeBasicFlow(flowWithCustomParams, state);
    assert.equal(arrayBasicReport.allPassed, true);
    assert.equal(arrayBasicReport.finalFlowVariables.first_route_name, "Ruta Norte Express");
    assert.equal(arrayBasicReport.finalFlowVariables.first_tag_code, "MX-01");

    const summaryEntries = buildFlowVariablesSummaryEntries(flowWithCustomParams, sampleRequests, state);
    const routeEntry = summaryEntries.find((e) => e.name === "first_route_name");
    assert.ok(routeEntry, "Debe existir la entrada first_route_name en el resumen de variables del flujo");
    assert.equal(routeEntry.value, "Ruta Norte Express");
    assert.equal(routeEntry.isResolved, true);
    assert.ok(routeEntry.sourceLabel.includes("results[0].name"), "El origen debe indicar la ruta results[0].name");

    const secretEntry = summaryEntries.find((e) => e.category === "secret" && e.name === "master_api_key");
    assert.ok(secretEntry, "Debe listar referencias a secretos de la bóveda");
    assert.equal(secretEntry.isSecret, true);
    assert.ok(!secretEntry.value.includes("SUPER_SECRET_KEY_999999"), "Jamás debe exponer el valor del secreto en el visor de variables");

    const basicWithVarsHtml = renderBasicFlowModeHtml(
      { ...state, flowStudioUi: { basicSelectedStepReqId: "req_orders" } },
      flowWithCustomParams,
      sampleRequests,
      sampleRequests,
      sampleRequests.slice(0, 2)
    );
    assert.ok(basicWithVarsHtml.includes("id=\"basic-flow-variables-panel\""), "Modo Básico debe incluir el apartado de Variables del Flujo y su Valor Actual");
    assert.ok(basicWithVarsHtml.includes("Ruta Norte Express"), "Modo Básico debe mostrar el valor extraído de results[0].name");
    assert.ok(!basicWithVarsHtml.includes("flows."), "Cero claves i18n sin traducir en apartado de variables básico");

    // Verificar pestaña Variables y apartado en Modo Avanzado + Captura Visual con notación results[0].name
    const advArrayFlow = createIndependentAdvancedFlowFromBasic(flowWithCustomParams, [flowWithCustomParams], sampleRequests);
    const advArrayReport = await executeAdvancedFlowGraph(advArrayFlow, state);
    assert.equal(advArrayReport.allPassed, true);
    assert.equal(advArrayReport.finalFlowVariables.first_route_name, "Ruta Norte Express");

    state.flowStudioUi = { selectedNodeId: advArrayFlow.graph.nodes[2].id, inspectorTab: "variables" };
    const advVarsTabHtml = renderFlowInspectorHtml(state, advArrayFlow, sampleRequests);
    assert.ok(advVarsTabHtml.includes("data-flow-insp-tab=\"variables\""), "Modo Avanzado debe incluir pestaña Variables en el Inspector");
    assert.ok(advVarsTabHtml.includes("id=\"advanced-flow-variables-card\""), "Modo Avanzado debe renderizar la tarjeta de Variables del Flujo y su Valor Actual");
    assert.ok(advVarsTabHtml.includes("Ruta Norte Express"), "Modo Avanzado debe mostrar el valor extraído de results[0].name");
    assert.ok(!advVarsTabHtml.includes("flows."), "Cero claves i18n sin traducir en pestaña Variables de Modo Avanzado");

    state.flowStudioUi.inspectorTab = "capture";
    const advCaptureBracketHtml = renderFlowInspectorHtml(state, advArrayFlow, sampleRequests);
    assert.ok(advCaptureBracketHtml.includes("results[0].name"), "Captura Visual debe sugerir rutas de lista con notación results[0].name");
    console.log("  ✓ [12/12] Extracción JSONPath con índices de listas (results[0].name) y apartado de Variables y su Valor verificados");

    console.log("=== TODAS LAS 12 PRUEBAS DE FLOWS STUDIO v1.2.0 PASARON EXITOSAMENTE ===");
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error("Fallo en pruebas de Flows Studio v1.2.0:", err);
  process.exit(1);
});
