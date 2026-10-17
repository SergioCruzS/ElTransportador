/**
 * Índice Modular de Almacenamiento y Cifrado (Barrel) — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/services/storage/index.js
 */
export * from "./constants.js";
export * from "./vault-crypto.js";
export * from "./collection-sanitizer.js";
export * from "./workspace-state.js";
export {
  setInitialAdminPassword,
  changeAdminPasswordPreservingSecrets,
  resetForgottenAdminPasswordWipingSecrets
} from "./workspace-state.js";
