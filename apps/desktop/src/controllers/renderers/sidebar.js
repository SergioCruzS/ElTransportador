/**
 * Orquestador del Panel Lateral (Colecciones, Entornos e Historial) — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/sidebar.js
 */
import { renderViewLayoutPreferences } from "./layout-prefs.js";
import { matchesGlobalQuery } from "./workspace-helpers.js";
import { renderSidebarCollectionsTab } from "./sidebar-collections.js";
import { renderSidebarEnvironmentsTab } from "./sidebar-environments.js";
import { renderSidebarHistoryTab } from "./sidebar-history.js";

export function renderSidebar(state, renderAll) {
  renderViewLayoutPreferences(state);
  const container = document.getElementById("sidebar-body");
  if (!container) return;

  const q = (state.searchQuery || "").trim().toLowerCase();
  const scope = state.globalSearchScope || "all";
  const clearBtn = document.getElementById("btn-clear-global-search");
  const countBadge = document.getElementById("global-search-count");
  if (clearBtn) clearBtn.classList.toggle("visible", q.length > 0);

  let totalMatches = 0;
  for (const col of state.collections) {
    for (const r of col.requests || []) {
      if (matchesGlobalQuery(r, q, scope)) totalMatches++;
    }
  }
  if (countBadge) {
    countBadge.textContent = q ? `${totalMatches}` : "Ctrl+K";
  }

  if (state.sideTab === "collections") {
    renderSidebarCollectionsTab(state, container, q, scope, renderAll);
    return;
  }

  if (state.sideTab === "environments") {
    renderSidebarEnvironmentsTab(state, container, renderSidebar, renderAll);
    return;
  }

  if (state.sideTab === "history") {
    renderSidebarHistoryTab(state, container, q, scope, renderSidebar, renderAll);
  }
}
