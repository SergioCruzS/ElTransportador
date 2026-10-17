/**
 * Manejadores CRUD de Colecciones, Carpetas, Solicitudes y Flujos — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/handlers/collection-crud-handlers.js
 *
 * Incluye:
 * - Al crear una nueva colección (`+ Colección`), si ya existe una colección con ese nombre, muestra el aviso
 *   dentro del mismo modal sin cerrarlo para que el usuario modifique el nombre y pueda guardarla.
 * - Botón para expandir o colapsar todas las colecciones y carpetas (`#btn-toggle-expand-all`).
 */
import { translate } from "../../lang/i18n.js";
import {
  APP_VERSION,
  persistWorkspaceToLocalStorage,
  createCleanStarterRequest,
  generateUniqueEntityId,
  isCollectionNameDuplicate,
  getNextAvailableCollectionName
} from "../../services/storage-sync.js";
import {
  showToast,
  openInputDialog,
  getActiveCollection,
  getActiveRequest,
  findCollectionIndexOfRequest,
  renderSidebar,
  renderFlowsStudioView
} from "../ui-renderers.js";

export function bindCollectionAndFlowCrudHandlers(state, renderAll) {
  document.getElementById("btn-run-flow")?.addEventListener("click", () => {
    state.activeMainView = state.activeMainView === "flows" ? "workspace" : "flows";
    persistWorkspaceToLocalStorage(state);
    renderAll();
  });

  document.getElementById("flows-search-input")?.addEventListener("input", (e) => {
    state.flowsSearchQuery = e.target.value;
    renderFlowsStudioView(state, renderAll);
  });

  document.getElementById("btn-create-custom-flow")?.addEventListener("click", () => {
    openInputDialog({
      title: translate(state.lang, "flows.btnNewFlow"),
      label: translate(state.lang, "request.nameLabel"),
      initialValue: `Flow ${state.customFlows.length + 1}`,
      onConfirm: (name) => {
        const nf = {
          id: generateUniqueEntityId("flw"),
          name,
          selectedRequestIds: [],
          lastReport: null
        };
        state.customFlows.push(nf);
        state.activeFlowId = nf.id;
        persistWorkspaceToLocalStorage(state);
        renderFlowsStudioView(state, renderAll);
        showToast(translate(state.lang, "toasts.createdFlow", { name }));
      }
    });
  });

  document.getElementById("btn-new-collection")?.addEventListener("click", () => {
    const suggestedName = getNextAvailableCollectionName(state.collections, "Collection");
    openInputDialog({
      title: translate(state.lang, "sidebar.newCollection"),
      label: translate(state.lang, "request.nameLabel"),
      initialValue: suggestedName,
      onConfirm: (name) => {
        const cleanName = name.trim();
        if (isCollectionNameDuplicate(state.collections, cleanName)) {
          return {
            keepOpen: true,
            errorMessage: translate(state.lang, "modals.duplicateColModalError", { name: cleanName })
          };
        }
        const newCol = {
          $schema: "https://eltransportador.dev/schemas/collection-v1.json",
          schemaVersion: 1,
          kind: "eltransportador.collection",
          metadata: {
            id: generateUniqueEntityId("col"),
            name: cleanName,
            description: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            appVersion: APP_VERSION
          },
          defaults: { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, verifyTls: true, headers: [] },
          variables: [],
          folders: [],
          requests: []
        };
        state.collections.push(newCol);
        state.activeCollectionIdx = state.collections.length - 1;
        persistWorkspaceToLocalStorage(state);
        renderAll();
        showToast(translate(state.lang, "toasts.createdCol", { name: cleanName }));
      }
    });
  });

  document.getElementById("btn-new-folder")?.addEventListener("click", () => {
    const col = getActiveCollection(state);
    openInputDialog({
      title: translate(state.lang, "sidebar.newFolder"),
      label: translate(state.lang, "request.nameLabel"),
      initialValue: `Folder ${(col.folders || []).length + 1}`,
      onConfirm: (name) => {
        col.folders.push({
          id: generateUniqueEntityId("fld"),
          name,
          parentId: null
        });
        persistWorkspaceToLocalStorage(state);
        renderAll();
        showToast(translate(state.lang, "toasts.createdFolder", { name }));
      }
    });
  });

  document.getElementById("btn-new-request")?.addEventListener("click", () => {
    const col = getActiveCollection(state);
    const newReq = createCleanStarterRequest(state.lang, col.folders[0]?.id || null);
    col.requests.push(newReq);
    state.openTabs.push(JSON.parse(JSON.stringify(newReq)));
    state.activeTabId = newReq.id;
    persistWorkspaceToLocalStorage(state);
    renderAll();
  });

  document.getElementById("btn-duplicate-req")?.addEventListener("click", () => {
    const cur = getActiveRequest(state);
    if (!cur) return;
    const ownerIdx = findCollectionIndexOfRequest(state, cur.id);
    const col = state.collections[ownerIdx] || getActiveCollection(state);
    const copy = JSON.parse(JSON.stringify(cur));
    copy.id = generateUniqueEntityId("req_copy");
    copy.name = cur.name + " (Copy)";
    col.requests.push(copy);
    state.openTabs.push(JSON.parse(JSON.stringify(copy)));
    state.activeTabId = copy.id;
    state.activeCollectionIdx = state.collections.indexOf(col);
    persistWorkspaceToLocalStorage(state);
    renderAll();
    showToast(translate(state.lang, "toasts.duplicatedReq"));
  });

  document.getElementById("btn-toggle-expand-all")?.addEventListener("click", () => {
    state.collapsedCollections = state.collapsedCollections || {};
    state.collapsedFolders = state.collapsedFolders || {};
    const anyCollapsed =
      state.collections.some((c) => state.collapsedCollections[c.metadata?.id]) ||
      state.collections.some((c) => (c.folders || []).some((f) => state.collapsedFolders[f.id]));

    if (anyCollapsed) {
      state.collapsedCollections = {};
      state.collapsedFolders = {};
    } else {
      for (const c of state.collections) {
        if (c.metadata?.id) state.collapsedCollections[c.metadata.id] = true;
        for (const f of c.folders || []) {
          state.collapsedFolders[f.id] = true;
        }
      }
    }
    persistWorkspaceToLocalStorage(state);
    renderSidebar(state, renderAll);
  });

  document.getElementById("btn-save-req")?.addEventListener("click", async () => {
    const cur = getActiveRequest(state);
    if (!cur) return;
    const ownerIdx = findCollectionIndexOfRequest(state, cur.id);
    const col = state.collections[ownerIdx] || getActiveCollection(state);
    const idx = col.requests.findIndex((r) => r.id === cur.id);
    if (idx >= 0) {
      col.requests[idx] = JSON.parse(JSON.stringify(cur));
    } else {
      col.requests.push(JSON.parse(JSON.stringify(cur)));
    }
    persistWorkspaceToLocalStorage(state);
    showToast(translate(state.lang, "toasts.savedReq"));
    renderSidebar(state, renderAll);
  });
}
