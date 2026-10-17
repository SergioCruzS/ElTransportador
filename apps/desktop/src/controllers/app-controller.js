/**
 * Controlador Principal de la Aplicación — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/app-controller.js
 * Orquesta la inicialización del estado y registra los manejadores modulares desde `./handlers/index.js`.
 */
import {
  createInitialApplicationState,
  restoreWorkspaceFromLocalStorage
} from "../services/storage-sync.js";
import { renderAllViews } from "./ui-renderers.js";
import {
  bindLayoutAndResizerHandlers,
  bindRequestBarAndSearchHandlers,
  bindCollectionAndFlowCrudHandlers,
  bindTopbarAndModalHandlers
} from "./handlers/index.js";

const state = createInitialApplicationState();
restoreWorkspaceFromLocalStorage(state);
document.documentElement.setAttribute("data-theme", state.theme);

const renderAll = () => renderAllViews(state);

bindLayoutAndResizerHandlers(state, renderAll);
bindRequestBarAndSearchHandlers(state, renderAll);
bindCollectionAndFlowCrudHandlers(state, renderAll);
bindTopbarAndModalHandlers(state, renderAll);

renderAll();
