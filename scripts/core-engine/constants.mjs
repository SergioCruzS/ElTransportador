/**
 * Constantes y Registro de Solicitudes en Curso — ElTransportador Core Engine v1.2.0
 * Archivo: scripts/core-engine/constants.mjs
 */
export const APP_VERSION = "1.2.0";
export const CURRENT_SCHEMA_VERSION = 1;
export const SCHEMA_URI = "https://eltransportador.dev/schemas/collection-v1.json";
export const ENV_PREFIX = "ELTRANSPORTADOR_";
export const REDACTED_PLACEHOLDER = "[REDACTED:ELTRANSPORTADOR_SECRET]";

export const activeRequests = new Map();

export function registerActiveRequest(requestId, controller) {
  activeRequests.set(requestId, controller);
}

export function cancelActiveRequest(requestId) {
  const ctrl = activeRequests.get(requestId);
  if (ctrl) {
    ctrl.abort(new Error("CANCELLED_BY_USER"));
    activeRequests.delete(requestId);
    return true;
  }
  return false;
}
