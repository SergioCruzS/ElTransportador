/**
 * Renderizador de la Pestaña de Colecciones del Panel Lateral — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/sidebar-collections.js
 *
 * Incluye:
 * - Opción de colapsar o expandir individualmente cada colección (`[data-toggle-col-collapse]`) y cada carpeta (`[data-toggle-folder-collapse]`)
 * - Selección única por solicitud y colección (`req.id === state.activeTabId && colIdx === ownerColIdx`)
 * - Reubicación de solicitudes entre colecciones, carpetas y raíz (Drag & Drop)
 * - Validación en el mismo modal (`#input-dialog-error`) al renombrar una colección (`✎`) si el nombre ya existe en otra colección
 * - Doble confirmación al querer eliminar una carpeta o colección que tenga 1 o más solicitudes
 */
import { translate } from "../../lang/i18n.js";
import {
  persistWorkspaceToLocalStorage,
  isCollectionNameDuplicate,
  createCleanStarterRequest
} from "../../services/storage-sync.js";
import {
  escapeHtml,
  escapeAttr,
  showToast,
  openInputDialog,
  openConfirmMoveModal
} from "./dom-utils.js";
import {
  findCollectionIndexOfRequest,
  moveRequestBetweenLocations,
  matchesGlobalQuery
} from "./workspace-helpers.js";

let draggedReqState = { reqId: null, colIdx: 0 };

function resolveSourceRequestAndCol(state, e) {
  let reqId = draggedReqState.reqId;
  let colIdx = draggedReqState.colIdx;
  if (!reqId && e?.dataTransfer) {
    try {
      const raw = e.dataTransfer.getData("text/plain");
      if (raw && raw.startsWith("{")) {
        const parsed = JSON.parse(raw);
        reqId = parsed.reqId;
        colIdx = Number(parsed.colIdx || 0);
      } else if (raw) {
        reqId = raw;
      }
    } catch {}
  }
  if (!reqId) return { sourceReq: null, sourceColIdx: -1 };
  let sCol = state.collections[colIdx];
  let sourceReq = (sCol?.requests || []).find((r) => r.id === reqId);
  if (!sourceReq) {
    colIdx = findCollectionIndexOfRequest(state, reqId);
    sCol = state.collections[colIdx];
    sourceReq = (sCol?.requests || []).find((r) => r.id === reqId);
  }
  return { sourceReq: sourceReq || null, sourceColIdx: colIdx };
}

export function renderSidebarCollectionsTab(state, container, q, scope, renderAll) {
  state.collapsedCollections = state.collapsedCollections || {};
  state.collapsedFolders = state.collapsedFolders || {};
  const ownerColIdx = findCollectionIndexOfRequest(state, state.activeTabId);
  let html = "";

  state.collections.forEach((col, colIdx) => {
    const colId = col.metadata?.id || `col_${colIdx}`;
    const isColCollapsed = Boolean(state.collapsedCollections[colId]) && !q;
    const safeColName = escapeHtml(col.metadata?.name || "Collection");
    const isCurrentCol = colIdx === state.activeCollectionIdx;
    const totalColReqs = (col.requests || []).length;
    const colCollapseTitle = escapeAttr(translate(state.lang, "sidebar.collapseCollection"));

    html += `
      <div class="etp-tree-collection ${isColCollapsed ? "collapsed-col" : ""}" data-drop-col-card="${colIdx}" style="${isCurrentCol ? "border-color:var(--border-focus);" : ""}">
        <div class="etp-tree-col-header" data-drop-col-root="${colIdx}" style="${isColCollapsed ? "margin-bottom:0;" : ""}">
          <div style="display:flex;align-items:center;gap:5px;min-width:0;flex:1;cursor:pointer;" data-select-col="${colIdx}">
            <button type="button" class="etp-collapse-btn" data-toggle-col-collapse="${escapeAttr(colId)}" title="${colCollapseTitle}">${isColCollapsed ? "▸" : "▾"}</button>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${safeColName}">📦 ${safeColName}</span>
            <span style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);">(${totalColReqs})</span>
          </div>
          <div class="etp-tree-actions">
            <button type="button" class="etp-icon-btn" data-edit-col="${colIdx}" title="${escapeAttr(translate(state.lang, "sidebar.renameCollection"))}">✎</button>
            ${state.collections.length > 1 ? `<button type="button" class="etp-icon-btn danger" data-del-col="${colIdx}" title="${escapeAttr(translate(state.lang, "sidebar.deleteCollection"))}">🗑</button>` : ""}
          </div>
        </div>
    `;

    if (!isColCollapsed) {
      html += `
        <div class="etp-tree-col-root-drop" data-drop-col-root="${colIdx}">
          ↧ ${escapeHtml(translate(state.lang, "sidebar.rootDropZone"))}
        </div>
      `;

      for (const folder of col.folders || []) {
        const safeFolderName = escapeHtml(folder.name);
        const safeFolderId = escapeAttr(folder.id);
        const isFolderCollapsed = Boolean(state.collapsedFolders[folder.id]) && !q;
        const folderCollapseTitle = escapeAttr(translate(state.lang, "sidebar.collapseFolder"));
        const folderReqs = (col.requests || []).filter(
          (r) => r.folderId === folder.id && matchesGlobalQuery(r, q, scope)
        );
        html += `
          <div class="etp-tree-folder" data-drop-folder="${safeFolderId}" data-col-idx="${colIdx}">
            <div style="display:flex;align-items:center;gap:5px;min-width:0;flex:1;cursor:pointer;" data-toggle-folder-row="${safeFolderId}">
              <button type="button" class="etp-collapse-btn" data-toggle-folder-collapse="${safeFolderId}" title="${folderCollapseTitle}">${isFolderCollapsed ? "▸" : "▾"}</button>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${safeFolderName}">📁 ${safeFolderName} (${folderReqs.length})</span>
            </div>
            <div class="etp-tree-actions">
              <button type="button" class="etp-icon-btn" data-edit-folder="${safeFolderId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, "sidebar.renameFolder"))}">✎</button>
              <button type="button" class="etp-icon-btn danger" data-del-folder="${safeFolderId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, "sidebar.deleteFolder"))}">🗑</button>
            </div>
          </div>
        `;
        if (!isFolderCollapsed) {
          for (const req of folderReqs) {
            const isAct = req.id === state.activeTabId && colIdx === ownerColIdx;
            const safeReqId = escapeAttr(req.id);
            const safeReqName = escapeHtml(req.name);
            const safeMethod = escapeHtml((req.method || "GET").toUpperCase());
            html += `
              <div class="etp-tree-item ${isAct ? "active" : ""}" style="margin-left:14px;" draggable="true" data-drag-req="${safeReqId}" data-select-req="${safeReqId}" data-col-idx="${colIdx}" title="${safeReqName}">
                <div class="etp-tree-item-left">
                  <span class="etp-drag-handle" title="${escapeAttr(translate(state.lang, "sidebar.dragHandleTooltip"))}">⋮⋮</span>
                  <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
                  <span class="etp-tree-item-name">${safeReqName}</span>
                </div>
                <div class="etp-tree-actions">
                  <button type="button" class="etp-icon-btn" data-edit-req="${safeReqId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, "sidebar.renameRequest"))}">✎</button>
                  <button type="button" class="etp-icon-btn danger" data-del-req="${safeReqId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, "sidebar.deleteRequest"))}">🗑</button>
                </div>
              </div>
            `;
          }
        }
      }

      const unfiled = (col.requests || []).filter(
        (r) => !r.folderId && matchesGlobalQuery(r, q, scope)
      );
      for (const req of unfiled) {
        const isAct = req.id === state.activeTabId && colIdx === ownerColIdx;
        const safeReqId = escapeAttr(req.id);
        const safeReqName = escapeHtml(req.name);
        const safeMethod = escapeHtml((req.method || "GET").toUpperCase());
        html += `
          <div class="etp-tree-item ${isAct ? "active" : ""}" draggable="true" data-drag-req="${safeReqId}" data-select-req="${safeReqId}" data-col-idx="${colIdx}" title="${safeReqName}">
            <div class="etp-tree-item-left">
              <span class="etp-drag-handle" title="${escapeAttr(translate(state.lang, "sidebar.dragHandleTooltip"))}">⋮⋮</span>
              <span class="etp-method-badge etp-method-${safeMethod.toLowerCase()}">${safeMethod}</span>
              <span class="etp-tree-item-name">${safeReqName}</span>
            </div>
            <div class="etp-tree-actions">
              <button type="button" class="etp-icon-btn" data-edit-req="${safeReqId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, "sidebar.renameRequest"))}">✎</button>
              <button type="button" class="etp-icon-btn danger" data-del-req="${safeReqId}" data-col-idx="${colIdx}" title="${escapeAttr(translate(state.lang, "sidebar.deleteRequest"))}">🗑</button>
            </div>
          </div>
        `;
      }
    }
    html += "</div>";
  });

  container.innerHTML = html;

  // Botón de colapsar / expandir colección individual
  container.querySelectorAll("[data-toggle-col-collapse]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const colId = btn.getAttribute("data-toggle-col-collapse");
      state.collapsedCollections = state.collapsedCollections || {};
      state.collapsedCollections[colId] = !state.collapsedCollections[colId];
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });

  // Botón / fila de colapsar / expandir carpeta individual
  const toggleFolderCollapseById = (folderId) => {
    state.collapsedFolders = state.collapsedFolders || {};
    state.collapsedFolders[folderId] = !state.collapsedFolders[folderId];
    persistWorkspaceToLocalStorage(state);
    renderAll();
  };

  container.querySelectorAll("[data-toggle-folder-collapse]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFolderCollapseById(btn.getAttribute("data-toggle-folder-collapse"));
    });
  });

  container.querySelectorAll("[data-toggle-folder-row]").forEach((rowEl) => {
    rowEl.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      toggleFolderCollapseById(rowEl.getAttribute("data-toggle-folder-row"));
    });
  });

  // Selección de colección activa al hacer clic en el encabezado de colección
  container.querySelectorAll("[data-select-col]").forEach((colHeaderEl) => {
    colHeaderEl.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const cIdx = Number(colHeaderEl.getAttribute("data-select-col") || 0);
      state.activeCollectionIdx = cIdx;
      const col = state.collections[cIdx];
      if (col && Array.isArray(col.requests) && col.requests.length > 0) {
        const firstReq = col.requests[0];
        if (!state.openTabs.some((t) => t.id === firstReq.id)) {
          state.openTabs.push(JSON.parse(JSON.stringify(firstReq)));
        }
        state.activeTabId = firstReq.id;
      }
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });

  // Drag & Drop sobre solicitudes individuales
  container.querySelectorAll("[data-drag-req]").forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      draggedReqState = {
        reqId: item.getAttribute("data-drag-req"),
        colIdx: Number(item.getAttribute("data-col-idx") || 0)
      };
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify(draggedReqState));
      }
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove("drag-over");
      const targetReqId = item.getAttribute("data-drag-req");
      const targetColIdx = Number(item.getAttribute("data-col-idx") || 0);
      const { sourceReq, sourceColIdx } = resolveSourceRequestAndCol(state, e);
      if (!sourceReq || (sourceReq.id === targetReqId && sourceColIdx === targetColIdx)) return;

      const tCol = state.collections[targetColIdx];
      const targetReq = (tCol?.requests || []).find((r) => r.id === targetReqId);
      if (!tCol || !targetReq) return;

      const destFolder = (tCol.folders || []).find((f) => f.id === targetReq.folderId);
      const destLabel = destFolder
        ? `📁 ${destFolder.name} (${tCol.metadata.name})`
        : `📦 ${tCol.metadata.name} ${translate(state.lang, "request.rootOptionSuffix")}`;

      openConfirmMoveModal(
        translate(state.lang, "modals.moveReorder", {
          req: sourceReq.name,
          target: targetReq.name,
          dest: destLabel
        }),
        () => {
          const targetIdx = tCol.requests.findIndex((r) => r.id === targetReqId);
          moveRequestBetweenLocations(
            state,
            sourceReq.id,
            sourceColIdx,
            targetColIdx,
            targetReq.folderId || null,
            targetIdx >= 0 ? targetIdx : null
          );
          renderAll();
          showToast(translate(state.lang, "toasts.movedReq", { dest: destLabel }));
        },
        null,
        state.lang
      );
    });
  });

  // Drag & Drop sobre carpetas
  container.querySelectorAll("[data-drop-folder]").forEach((folderEl) => {
    folderEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      folderEl.classList.add("drag-over");
    });
    folderEl.addEventListener("dragleave", () => {
      folderEl.classList.remove("drag-over");
    });
    folderEl.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      folderEl.classList.remove("drag-over");
      const targetFolderId = folderEl.getAttribute("data-drop-folder");
      const targetColIdx = Number(folderEl.getAttribute("data-col-idx") || 0);
      const { sourceReq, sourceColIdx } = resolveSourceRequestAndCol(state, e);
      const tCol = state.collections[targetColIdx];
      const destFolder = (tCol?.folders || []).find((f) => f.id === targetFolderId);
      if (!sourceReq || !destFolder) return;
      if (sourceColIdx === targetColIdx && sourceReq.folderId === targetFolderId) return;

      const destLabel = `📁 ${destFolder.name} (${tCol.metadata.name})`;
      openConfirmMoveModal(
        translate(state.lang, "modals.moveBetweenFolders", {
          req: sourceReq.name,
          dest: destLabel
        }),
        () => {
          state.collapsedFolders[targetFolderId] = false;
          moveRequestBetweenLocations(state, sourceReq.id, sourceColIdx, targetColIdx, targetFolderId, null);
          renderAll();
          showToast(translate(state.lang, "toasts.movedReq", { dest: destLabel }));
        },
        null,
        state.lang
      );
    });
  });

  // Handler común para soltar en raíz de colección (cabecera, zona root drop o tarjeta completa)
  const handleDropToCollectionRoot = (e, targetColIdx, highlightEl) => {
    e.preventDefault();
    e.stopPropagation();
    highlightEl.classList.remove("drag-over");
    const { sourceReq, sourceColIdx } = resolveSourceRequestAndCol(state, e);
    const tCol = state.collections[targetColIdx];
    if (!sourceReq || !tCol) return;
    if (sourceColIdx === targetColIdx && !sourceReq.folderId) return;

    const destLabel = `📦 ${tCol.metadata.name} ${translate(state.lang, "request.rootOptionSuffix")}`;
    openConfirmMoveModal(
      translate(state.lang, "modals.moveBetweenFolders", {
        req: sourceReq.name,
        dest: destLabel
      }),
      () => {
        if (tCol.metadata?.id) state.collapsedCollections[tCol.metadata.id] = false;
        moveRequestBetweenLocations(state, sourceReq.id, sourceColIdx, targetColIdx, null, null);
        renderAll();
        showToast(translate(state.lang, "toasts.movedReq", { dest: destLabel }));
      },
      null,
      state.lang
    );
  };

  container.querySelectorAll("[data-drop-col-root]").forEach((rootEl) => {
    rootEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      rootEl.classList.add("drag-over");
    });
    rootEl.addEventListener("dragleave", () => {
      rootEl.classList.remove("drag-over");
    });
    rootEl.addEventListener("drop", (e) => {
      const targetColIdx = Number(rootEl.getAttribute("data-drop-col-root") || 0);
      handleDropToCollectionRoot(e, targetColIdx, rootEl);
    });
  });

  container.querySelectorAll("[data-drop-col-card]").forEach((cardEl) => {
    cardEl.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    cardEl.addEventListener("drop", (e) => {
      const targetColIdx = Number(cardEl.getAttribute("data-drop-col-card") || 0);
      handleDropToCollectionRoot(e, targetColIdx, cardEl);
    });
  });

  // Selección de solicitud en árbol
  container.querySelectorAll("[data-select-req]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const rId = el.getAttribute("data-select-req");
      const cIdx = Number(el.getAttribute("data-col-idx") || 0);
      state.activeCollectionIdx = cIdx;
      const foundInTabs = state.openTabs.find((t) => t.id === rId);
      if (!foundInTabs) {
        const orig = state.collections[cIdx].requests.find((r) => r.id === rId);
        if (orig) state.openTabs.push(JSON.parse(JSON.stringify(orig)));
      }
      state.activeTabId = rId;
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });

  // Renombrar colección desde el edit (✎): mantiene abierto el modal con mensaje si el nombre ya existe
  container.querySelectorAll("[data-edit-col]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cIdx = Number(btn.getAttribute("data-edit-col"));
      const col = state.collections[cIdx];
      if (!col) return;
      openInputDialog({
        title: translate(state.lang, "sidebar.renameCollection"),
        label: translate(state.lang, "request.nameLabel"),
        initialValue: col.metadata.name,
        onConfirm: (nextName) => {
          const cleanName = nextName.trim();
          if (isCollectionNameDuplicate(state.collections, cleanName, cIdx)) {
            return {
              keepOpen: true,
              errorMessage: translate(state.lang, "modals.duplicateColModalError", { name: cleanName })
            };
          }
          col.metadata.name = cleanName;
          persistWorkspaceToLocalStorage(state);
          renderAll();
          showToast(translate(state.lang, "toasts.renamedCol"));
        }
      });
    });
  });

  // Eliminar colección (con doble confirmación si tiene 1 o más solicitudes)
  container.querySelectorAll("[data-del-col]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cIdx = Number(btn.getAttribute("data-del-col"));
      if (state.collections.length <= 1) return;
      const col = state.collections[cIdx];
      if (!col) return;
      const colName = col.metadata?.name || "Collection";
      const reqCount = (col.requests || []).length;

      const executeDeleteCollection = () => {
        const removedReqIds = new Set((col.requests || []).map((r) => r.id));
        if (col.metadata?.id && state.collapsedCollections) {
          delete state.collapsedCollections[col.metadata.id];
        }
        state.collections.splice(cIdx, 1);
        state.activeCollectionIdx = Math.min(state.activeCollectionIdx, state.collections.length - 1);
        state.openTabs = (state.openTabs || []).filter((t) => !removedReqIds.has(t.id));
        if (state.openTabs.length === 0) {
          const activeCol = state.collections[state.activeCollectionIdx] || state.collections[0];
          const fallbackReq =
            activeCol?.requests?.[0] ||
            state.collections.flatMap((c) => c.requests || [])[0] ||
            createCleanStarterRequest(state.lang, null);
          if (activeCol && (!activeCol.requests || activeCol.requests.length === 0)) {
            activeCol.requests = [fallbackReq];
          }
          state.openTabs.push(JSON.parse(JSON.stringify(fallbackReq)));
        }
        if (removedReqIds.has(state.activeTabId) || !state.openTabs.some((t) => t.id === state.activeTabId)) {
          state.activeTabId = state.openTabs[0].id;
          state.activeCollectionIdx = findCollectionIndexOfRequest(state, state.activeTabId);
        }
        persistWorkspaceToLocalStorage(state);
        renderAll();
        showToast(translate(state.lang, "toasts.deletedCol", { name: colName }));
      };

      if (reqCount >= 1) {
        openConfirmMoveModal(
          translate(state.lang, "modals.deleteColConfirm1Msg", { name: colName, count: reqCount }),
          () => {
            openConfirmMoveModal(
              translate(state.lang, "modals.deleteColConfirm2Msg", { name: colName, count: reqCount }),
              () => {
                executeDeleteCollection();
              },
              translate(state.lang, "modals.deleteColConfirm2Title"),
              state.lang,
              { isDanger: true, acceptLabel: translate(state.lang, "modals.btnConfirmDeleteFinal") }
            );
          },
          translate(state.lang, "modals.deleteColConfirm1Title"),
          state.lang,
          { isDanger: true, acceptLabel: translate(state.lang, "modals.btnContinueDelete") }
        );
      } else {
        executeDeleteCollection();
      }
    });
  });

  container.querySelectorAll("[data-edit-folder]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const fId = btn.getAttribute("data-edit-folder");
      const cIdx = Number(btn.getAttribute("data-col-idx"));
      const folder = state.collections[cIdx].folders.find((f) => f.id === fId);
      if (!folder) return;
      openInputDialog({
        title: translate(state.lang, "sidebar.renameFolder"),
        label: translate(state.lang, "request.nameLabel"),
        initialValue: folder.name,
        onConfirm: (nextName) => {
          folder.name = nextName;
          persistWorkspaceToLocalStorage(state);
          renderAll();
          showToast(translate(state.lang, "toasts.renamedFolder"));
        }
      });
    });
  });

  // Eliminar carpeta (con doble confirmación si tiene 1 o más solicitudes)
  container.querySelectorAll("[data-del-folder]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const fId = btn.getAttribute("data-del-folder");
      const cIdx = Number(btn.getAttribute("data-col-idx"));
      const col = state.collections[cIdx];
      if (!col) return;
      const folder = (col.folders || []).find((f) => f.id === fId);
      if (!folder) return;
      const folderName = folder.name;
      const folderReqs = (col.requests || []).filter((r) => r.folderId === fId);
      const reqCount = folderReqs.length;

      const executeDeleteFolder = () => {
        const removedReqIds = new Set(folderReqs.map((r) => r.id));
        col.folders = (col.folders || []).filter((f) => f.id !== fId);
        col.requests = (col.requests || []).filter((r) => r.folderId !== fId);
        if (state.collapsedFolders) {
          delete state.collapsedFolders[fId];
        }
        state.openTabs = (state.openTabs || []).filter((t) => !removedReqIds.has(t.id));
        if (state.openTabs.length === 0) {
          const fallbackReq =
            col.requests[0] ||
            state.collections.flatMap((c) => c.requests || [])[0] ||
            createCleanStarterRequest(state.lang, null);
          if (col.requests.length === 0 && !state.collections.some((c) => (c.requests || []).length > 0)) {
            col.requests.push(fallbackReq);
          }
          state.openTabs.push(JSON.parse(JSON.stringify(fallbackReq)));
        }
        if (removedReqIds.has(state.activeTabId) || !state.openTabs.some((t) => t.id === state.activeTabId)) {
          state.activeTabId = state.openTabs[0].id;
          state.activeCollectionIdx = findCollectionIndexOfRequest(state, state.activeTabId);
        }
        persistWorkspaceToLocalStorage(state);
        renderAll();
        showToast(translate(state.lang, "toasts.deletedFolder", { name: folderName }));
      };

      if (reqCount >= 1) {
        openConfirmMoveModal(
          translate(state.lang, "modals.deleteFolderConfirm1Msg", { name: folderName, count: reqCount }),
          () => {
            openConfirmMoveModal(
              translate(state.lang, "modals.deleteFolderConfirm2Msg", { name: folderName, count: reqCount }),
              () => {
                executeDeleteFolder();
              },
              translate(state.lang, "modals.deleteFolderConfirm2Title"),
              state.lang,
              { isDanger: true, acceptLabel: translate(state.lang, "modals.btnConfirmDeleteFinal") }
            );
          },
          translate(state.lang, "modals.deleteFolderConfirm1Title"),
          state.lang,
          { isDanger: true, acceptLabel: translate(state.lang, "modals.btnContinueDelete") }
        );
      } else {
        executeDeleteFolder();
      }
    });
  });

  container.querySelectorAll("[data-edit-req]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rId = btn.getAttribute("data-edit-req");
      const cIdx = Number(btn.getAttribute("data-col-idx"));
      const reqInCol = state.collections[cIdx].requests.find((r) => r.id === rId);
      if (!reqInCol) return;
      openInputDialog({
        title: translate(state.lang, "sidebar.renameRequest"),
        label: translate(state.lang, "request.nameLabel"),
        initialValue: reqInCol.name,
        onConfirm: (nextName) => {
          reqInCol.name = nextName;
          const reqInTab = state.openTabs.find((t) => t.id === rId);
          if (reqInTab) reqInTab.name = nextName;
          persistWorkspaceToLocalStorage(state);
          renderAll();
          showToast(translate(state.lang, "toasts.renamedReq"));
        }
      });
    });
  });

  container.querySelectorAll("[data-del-req]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rId = btn.getAttribute("data-del-req");
      const cIdx = Number(btn.getAttribute("data-col-idx"));
      const col = state.collections[cIdx];
      col.requests = col.requests.filter((r) => r.id !== rId);
      state.openTabs = state.openTabs.filter((t) => t.id !== rId);
      if (state.openTabs.length === 0) {
        const fallbackReq = col.requests[0] || createCleanStarterRequest(state.lang, null);
        if (col.requests.length === 0) col.requests.push(fallbackReq);
        state.openTabs.push(JSON.parse(JSON.stringify(fallbackReq)));
      }
      if (state.activeTabId === rId) {
        state.activeTabId = state.openTabs[0].id;
        state.activeCollectionIdx = findCollectionIndexOfRequest(state, state.activeTabId);
      }
      persistWorkspaceToLocalStorage(state);
      renderAll();
    });
  });
}
