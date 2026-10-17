/**
 * Catálogo de Plantillas Iniciales de Orquestación para Flows Studio — ElTransportador v1.2.0
 * Archivo: apps/desktop/src/services/flows/flow-templates.js
 *
 * Incluye las 6 plantillas solicitadas:
 * 1. Autenticación → Consulta Protegida
 * 2. Paginación Controlada
 * 3. Polling con Espera (Delay)
 * 4. Reintento Resiliente (1, 3, 5)
 * 5. Manejo de Error y Contingencia
 * 6. Compensación / Rollback Transaccional
 */
import {
  NODE_TYPES,
  PORT_TYPES,
  createDefaultNode,
  createDefaultEdge,
  migrateFlowToV2
} from "./flow-schema.js";
import { generateUniqueEntityId } from "../storage/collection-sanitizer.js";

export const FLOW_TEMPLATES_CATALOG = [
  {
    id: "auth_protected",
    icon: "🔐",
    nameEs: "Autenticación → Consulta Protegida",
    nameEn: "Authentication → Protected Query",
    descEs: "Obtiene un token o sesión, verifica condición de éxito y consulta un recurso protegido.",
    descEn: "Obtains a token/session, verifies condition, and queries a protected resource."
  },
  {
    id: "pagination",
    icon: "📄",
    nameEs: "Paginación Controlada (Bucle Acotado)",
    nameEn: "Controlled Pagination (Bounded Loop)",
    descEs: "Recorre páginas incrementando el cursor con límite de iteraciones seguro.",
    descEn: "Iterates through pages incrementing cursor with a safe iteration limit."
  },
  {
    id: "polling_delay",
    icon: "⏳",
    nameEs: "Polling con Espera (Delay + Condición)",
    nameEn: "Polling with Delay (Wait + Condition)",
    descEs: "Inicia una operación asíncrona, espera y consulta estado hasta completarse.",
    descEn: "Starts an async operation, waits, and polls status until completion."
  },
  {
    id: "retry_resilient",
    icon: "↻",
    nameEs: "Reintento Resiliente (3 Reintentos)",
    nameEn: "Resilient Retry (3 Retries)",
    descEs: "Ejecuta un endpoint crítico con política de 3 reintentos automáticos y espera.",
    descEn: "Executes a critical endpoint with 3 automatic retries and backoff delay."
  },
  {
    id: "error_handling",
    icon: "🛡️",
    nameEs: "Manejo de Error y Endpoint Fallback",
    nameEn: "Error Handling & Fallback Endpoint",
    descEs: "Si el endpoint principal falla o expira, redirige al servicio de contingencia.",
    descEn: "If the primary endpoint fails or times out, routes to a fallback endpoint."
  },
  {
    id: "compensation_rollback",
    icon: "↩",
    nameEs: "Compensación / Rollback Transaccional",
    nameEn: "Transactional Compensation / Rollback",
    descEs: "Crea un recurso, intenta confirmar y ejecuta rollback automático si ocurre un error.",
    descEn: "Creates a resource, attempts confirmation, and triggers automatic rollback on error."
  }
];

export function createFlowFromTemplate(templateId, allRequests = [], lang = "es") {
  const req0 = allRequests[0]?.id || "";
  const req1 = allRequests[1]?.id || req0;
  const req2 = allRequests[2]?.id || req0;

  const tplMeta = FLOW_TEMPLATES_CATALOG.find((t) => t.id === templateId) || FLOW_TEMPLATES_CATALOG[0];
  const flowName = lang === "en" ? tplMeta.nameEn : tplMeta.nameEs;

  const start = createDefaultNode(NODE_TYPES.START, {
    id: "nd_start",
    label: lang === "en" ? "Start" : "Inicio",
    position: { x: 50, y: 180 }
  });
  const endOk = createDefaultNode(NODE_TYPES.END_SUCCESS, {
    id: "nd_end_ok",
    label: lang === "en" ? "Success End" : "Fin Exitoso",
    position: { x: 860, y: 110 }
  });
  const endErr = createDefaultNode(NODE_TYPES.END_ERROR, {
    id: "nd_end_err",
    label: lang === "en" ? "Error End" : "Fin con Error",
    position: { x: 860, y: 290 }
  });

  const nodes = [start];
  const edges = [];
  let maxIterations = 8;

  if (templateId === "auth_protected") {
    const loginNode = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_auth_req",
      label: lang === "en" ? "1. Authenticate / Token" : "1. Autenticar / Token",
      position: { x: 220, y: 165 },
      config: {
        requestId: req0,
        retryCount: 1,
        retryDelaySec: 0.5,
        assertions: [
          { id: "ast_auth_200", enabled: true, target: "status", property: "", operator: "equals", expected: "200" }
        ],
        extractions: [
          {
            id: "ext_token",
            enabled: true,
            source: "status",
            path: "status",
            variableName: "auth_status",
            scope: "flow",
            fallbackValue: "200"
          }
        ]
      }
    });
    const condNode = createDefaultNode(NODE_TYPES.CONDITION, {
      id: "nd_auth_cond",
      label: lang === "en" ? "Token Valid?" : "¿Sesión Válida?",
      position: { x: 450, y: 165 },
      config: {
        source: "variable",
        property: "auth_status",
        operator: "equals",
        expected: "200"
      }
    });
    const protectedNode = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_protected_req",
      label: lang === "en" ? "2. Protected Resource" : "2. Recurso Protegido",
      position: { x: 650, y: 105 },
      config: {
        requestId: req1,
        retryCount: 0,
        retryDelaySec: 1,
        assertions: [],
        extractions: []
      }
    });
    nodes.push(loginNode, condNode, protectedNode, endOk, endErr);
    edges.push(
      createDefaultEdge(start.id, PORT_TYPES.DEFAULT, loginNode.id),
      createDefaultEdge(loginNode.id, PORT_TYPES.SUCCESS, condNode.id, PORT_TYPES.IN, "200 OK"),
      createDefaultEdge(loginNode.id, PORT_TYPES.FAILURE, endErr.id, PORT_TYPES.IN, "auth fail"),
      createDefaultEdge(condNode.id, PORT_TYPES.TRUE, protectedNode.id, PORT_TYPES.IN, "true"),
      createDefaultEdge(condNode.id, PORT_TYPES.FALSE, endErr.id, PORT_TYPES.IN, "false"),
      createDefaultEdge(protectedNode.id, PORT_TYPES.SUCCESS, endOk.id, PORT_TYPES.IN, "ok"),
      createDefaultEdge(protectedNode.id, PORT_TYPES.FAILURE, endErr.id, PORT_TYPES.IN, "error")
    );
  } else if (templateId === "pagination") {
    maxIterations = 5;
    const initCursor = createDefaultNode(NODE_TYPES.TRANSFORM, {
      id: "nd_init_page",
      label: lang === "en" ? "Init page = 1" : "Inicializar página = 1",
      position: { x: 210, y: 165 },
      config: {
        operation: "template",
        inputVariable: "",
        templateOrValue: "1",
        outputVariable: "page_cursor",
        scope: "flow"
      }
    });
    const fetchPage = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_fetch_page",
      label: lang === "en" ? "Fetch Page" : "Consultar Página",
      position: { x: 430, y: 165 },
      config: {
        requestId: req0,
        retryCount: 1,
        retryDelaySec: 0.5,
        assertions: [],
        extractions: []
      }
    });
    const incPage = createDefaultNode(NODE_TYPES.TRANSFORM, {
      id: "nd_inc_page",
      label: lang === "en" ? "Increment page + 1" : "Incrementar página + 1",
      position: { x: 640, y: 165 },
      config: {
        operation: "math_add",
        inputVariable: "page_cursor",
        templateOrValue: "1",
        outputVariable: "page_cursor",
        scope: "flow"
      }
    });
    const checkMore = createDefaultNode(NODE_TYPES.CONDITION, {
      id: "nd_cond_more",
      label: lang === "en" ? "page_cursor < 3?" : "¿page_cursor < 3?",
      position: { x: 640, y: 310 },
      config: {
        source: "variable",
        property: "page_cursor",
        operator: "less_than",
        expected: "3"
      }
    });
    nodes.push(initCursor, fetchPage, incPage, checkMore, endOk, endErr);
    edges.push(
      createDefaultEdge(start.id, PORT_TYPES.DEFAULT, initCursor.id),
      createDefaultEdge(initCursor.id, PORT_TYPES.DEFAULT, fetchPage.id),
      createDefaultEdge(fetchPage.id, PORT_TYPES.SUCCESS, incPage.id),
      createDefaultEdge(fetchPage.id, PORT_TYPES.FAILURE, endErr.id),
      createDefaultEdge(incPage.id, PORT_TYPES.DEFAULT, checkMore.id),
      createDefaultEdge(checkMore.id, PORT_TYPES.TRUE, fetchPage.id, PORT_TYPES.IN, "next page"),
      createDefaultEdge(checkMore.id, PORT_TYPES.FALSE, endOk.id, PORT_TYPES.IN, "done")
    );
  } else if (templateId === "polling_delay") {
    const startJob = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_start_job",
      label: lang === "en" ? "1. Trigger Job" : "1. Iniciar Proceso",
      position: { x: 210, y: 165 },
      config: { requestId: req0, retryCount: 0, retryDelaySec: 0.5, assertions: [], extractions: [] }
    });
    const waitNode = createDefaultNode(NODE_TYPES.DELAY, {
      id: "nd_poll_wait",
      label: lang === "en" ? "Wait 0.5s" : "Esperar 0.5s",
      position: { x: 430, y: 165 },
      config: { delaySec: 0.5, reason: "Polling interval" }
    });
    const checkJob = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_check_job",
      label: lang === "en" ? "2. Poll Status" : "2. Consultar Estado",
      position: { x: 630, y: 165 },
      config: { requestId: req1, retryCount: 1, retryDelaySec: 0.5, assertions: [], extractions: [] }
    });
    nodes.push(startJob, waitNode, checkJob, endOk, endErr);
    edges.push(
      createDefaultEdge(start.id, PORT_TYPES.DEFAULT, startJob.id),
      createDefaultEdge(startJob.id, PORT_TYPES.SUCCESS, waitNode.id),
      createDefaultEdge(startJob.id, PORT_TYPES.FAILURE, endErr.id),
      createDefaultEdge(waitNode.id, PORT_TYPES.DEFAULT, checkJob.id),
      createDefaultEdge(checkJob.id, PORT_TYPES.SUCCESS, endOk.id),
      createDefaultEdge(checkJob.id, PORT_TYPES.FAILURE, endErr.id)
    );
  } else if (templateId === "retry_resilient") {
    const resilientReq = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_retry_req",
      label: lang === "en" ? "Endpoint (3 Retries)" : "Solicitud (3 Reintentos)",
      position: { x: 360, y: 165 },
      config: {
        requestId: req0,
        retryCount: 3,
        retryDelaySec: 0.5,
        assertions: [
          { id: "ast_r_200", enabled: true, target: "status", property: "", operator: "equals", expected: "200" }
        ],
        extractions: []
      }
    });
    nodes.push(resilientReq, endOk, endErr);
    edges.push(
      createDefaultEdge(start.id, PORT_TYPES.DEFAULT, resilientReq.id),
      createDefaultEdge(resilientReq.id, PORT_TYPES.SUCCESS, endOk.id, PORT_TYPES.IN, "ok"),
      createDefaultEdge(resilientReq.id, PORT_TYPES.FAILURE, endErr.id, PORT_TYPES.IN, "exhausted"),
      createDefaultEdge(resilientReq.id, PORT_TYPES.TIMEOUT, endErr.id, PORT_TYPES.IN, "timeout")
    );
  } else if (templateId === "error_handling") {
    const primaryNode = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_primary",
      label: lang === "en" ? "Primary Service" : "Servicio Principal",
      position: { x: 260, y: 130 },
      config: { requestId: req0, retryCount: 1, retryDelaySec: 0.4, assertions: [], extractions: [] }
    });
    const fallbackNode = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_fallback",
      label: lang === "en" ? "Fallback Service" : "Servicio de Contingencia",
      position: { x: 540, y: 260 },
      config: { requestId: req1, retryCount: 1, retryDelaySec: 0.4, assertions: [], extractions: [] }
    });
    nodes.push(primaryNode, fallbackNode, endOk, endErr);
    edges.push(
      createDefaultEdge(start.id, PORT_TYPES.DEFAULT, primaryNode.id),
      createDefaultEdge(primaryNode.id, PORT_TYPES.SUCCESS, endOk.id, PORT_TYPES.IN, "primary ok"),
      createDefaultEdge(primaryNode.id, PORT_TYPES.FAILURE, fallbackNode.id, PORT_TYPES.IN, "on error"),
      createDefaultEdge(primaryNode.id, PORT_TYPES.TIMEOUT, fallbackNode.id, PORT_TYPES.IN, "on timeout"),
      createDefaultEdge(fallbackNode.id, PORT_TYPES.SUCCESS, endOk.id, PORT_TYPES.IN, "recovered"),
      createDefaultEdge(fallbackNode.id, PORT_TYPES.FAILURE, endErr.id, PORT_TYPES.IN, "failed")
    );
  } else {
    // compensation_rollback
    const reserveNode = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_reserve",
      label: lang === "en" ? "1. Create Reservation" : "1. Crear Reserva",
      position: { x: 230, y: 130 },
      config: {
        requestId: req0,
        retryCount: 0,
        retryDelaySec: 0.5,
        assertions: [],
        extractions: [
          {
            id: "ext_tx_id",
            enabled: true,
            source: "json_path",
            path: "order.id",
            variableName: "tx_reservation_id",
            scope: "flow",
            fallbackValue: "tx_local_01"
          }
        ]
      }
    });
    const chargeNode = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_charge",
      label: lang === "en" ? "2. Confirm Charge" : "2. Confirmar Cargo",
      position: { x: 480, y: 120 },
      config: { requestId: req1, retryCount: 1, retryDelaySec: 0.5, assertions: [], extractions: [] }
    });
    const rollbackNode = createDefaultNode(NODE_TYPES.HTTP_REQUEST, {
      id: "nd_rollback",
      label: lang === "en" ? "3. Rollback Reservation" : "3. Rollback / Compensar",
      position: { x: 640, y: 280 },
      config: { requestId: req2, retryCount: 1, retryDelaySec: 0.5, assertions: [], extractions: [] }
    });
    nodes.push(reserveNode, chargeNode, rollbackNode, endOk, endErr);
    edges.push(
      createDefaultEdge(start.id, PORT_TYPES.DEFAULT, reserveNode.id),
      createDefaultEdge(reserveNode.id, PORT_TYPES.SUCCESS, chargeNode.id, PORT_TYPES.IN, "reserved"),
      createDefaultEdge(reserveNode.id, PORT_TYPES.FAILURE, endErr.id, PORT_TYPES.IN, "abort"),
      createDefaultEdge(chargeNode.id, PORT_TYPES.SUCCESS, endOk.id, PORT_TYPES.IN, "committed"),
      createDefaultEdge(chargeNode.id, PORT_TYPES.FAILURE, rollbackNode.id, PORT_TYPES.IN, "compensate"),
      createDefaultEdge(chargeNode.id, PORT_TYPES.TIMEOUT, rollbackNode.id, PORT_TYPES.IN, "compensate"),
      createDefaultEdge(rollbackNode.id, PORT_TYPES.SUCCESS, endErr.id, PORT_TYPES.IN, "rolled back"),
      createDefaultEdge(rollbackNode.id, PORT_TYPES.FAILURE, endErr.id, PORT_TYPES.IN, "rollback err")
    );
  }

  return migrateFlowToV2(
    {
      id: generateUniqueEntityId("flw"),
      name: flowName,
      mode: "advanced",
      selectedRequestIds: [req0, req1].filter(Boolean),
      graph: {
        nodes,
        edges,
        viewport: { x: 20, y: 20, zoom: 1 },
        settings: { maxIterations, maxConcurrency: 2, defaultRetryDelaySec: 0.5 }
      }
    },
    allRequests
  );
}
