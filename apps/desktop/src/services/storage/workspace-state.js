/**
 * Estado Inicial del Espacio de Trabajo y Persistencia en LocalStorage — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/services/storage/workspace-state.js
 */
import { translate } from "../../lang/i18n.js";
import {
  APP_VERSION,
  WORKSPACE_STORAGE_KEY,
  VIEW_PREFS_STORAGE_KEY,
  THEME_STORAGE_KEY,
  ENCRYPTED_PREFIX
} from "./constants.js";
import {
  encryptSecretValue,
  decryptSecretValue,
  hasAdminPasswordConfigured,
  setInitialAdminPasswordWithPersist,
  changeAdminPasswordWithPersist,
  resetForgottenAdminPasswordWithPersist,
  encryptRequestSensitiveFields,
  decryptRequestSensitiveFields
} from "./vault-crypto.js";
import { generateUniqueEntityId, ensureUniqueWorkspaceIds } from "./collection-sanitizer.js";

function safeGetViewPref(key) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {}
  try {
    if (typeof window !== "undefined" && window.name && window.name.startsWith("{")) {
      const store = JSON.parse(window.name);
      return store[key] ?? null;
    }
  } catch {}
  return null;
}

function safeSetViewPref(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch {}
  try {
    if (typeof window !== "undefined") {
      const store = window.name && window.name.startsWith("{") ? JSON.parse(window.name) : {};
      delete store[WORKSPACE_STORAGE_KEY];
      store[key] = val;
      window.name = JSON.stringify(store);
    }
  } catch {}
}

export function createCleanStarterRequest(lang = "es", folderId = null) {
  return {
    id: generateUniqueEntityId("req"),
    name: translate(lang, "defaults.firstRequestName"),
    folderId,
    method: "GET",
    url: "",
    params: [],
    headers: [
      { id: "hdr_accept", key: "Accept", value: "application/json", enabled: true, isSecret: false }
    ],
    auth: { type: "none" },
    body: { mode: "none", raw: "", urlencoded: [], multipart: [] },
    settings: { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, verifyTls: true },
    assertions: [],
    extractions: []
  };
}

export function createCleanStarterCollection(lang = "es") {
  const firstReq = createCleanStarterRequest(lang, null);
  return {
    $schema: "https://eltransportador.dev/schemas/collection-v1.json",
    schemaVersion: 1,
    kind: "eltransportador.collection",
    metadata: {
      id: generateUniqueEntityId("col"),
      name: translate(lang, "defaults.firstCollectionName"),
      description: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appVersion: APP_VERSION
    },
    defaults: {
      timeoutMs: 10000,
      followRedirects: true,
      maxRedirects: 5,
      verifyTls: true,
      headers: []
    },
    variables: [],
    folders: [],
    requests: [firstReq]
  };
}

export function loadViewPreferences() {
  const defaults = {
    theme: "light",
    lang: "es",
    sidebarVisible: true,
    sidebarPinned: true,
    sidebarWidth: 300,
    splitVertical: false,
    splitRatio: 48,
    responseMaximized: false,
    sideTab: "collections",
    reqSubTab: "params",
    respSubTab: "pretty",
    activeMainView: "workspace",
    respFilterMode: "filter",
    globalSearchScope: "all",
    collapsedCollections: {},
    collapsedFolders: {}
  };
  try {
    const savedTheme = safeGetViewPref(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
      defaults.theme = savedTheme;
    }
    const raw = safeGetViewPref(VIEW_PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      theme: parsed.theme || defaults.theme
    };
  } catch {
    return defaults;
  }
}

export function saveViewPreferences(state) {
  try {
    safeSetViewPref(THEME_STORAGE_KEY, state.theme);
    safeSetViewPref(
      VIEW_PREFS_STORAGE_KEY,
      JSON.stringify({
        theme: state.theme,
        lang: state.lang,
        sidebarVisible: state.sidebarVisible,
        sidebarPinned: state.sidebarPinned,
        sidebarWidth: state.sidebarWidth,
        splitVertical: state.splitVertical,
        splitRatio: state.splitRatio,
        responseMaximized: state.responseMaximized,
        sideTab: state.sideTab,
        reqSubTab: state.reqSubTab,
        respSubTab: state.respSubTab,
        activeMainView: state.activeMainView,
        respFilterMode: state.respFilterMode,
        globalSearchScope: state.globalSearchScope,
        collapsedCollections: state.collapsedCollections || {},
        collapsedFolders: state.collapsedFolders || {}
      })
    );
  } catch {}
}

export function createInitialApplicationState() {
  const prefs = loadViewPreferences();
  const initialCol = createCleanStarterCollection(prefs.lang);
  return {
    ...prefs,
    searchQuery: "",
    respFilterQuery: "",
    flowsSearchQuery: "",
    flowCatalogSearchQuery: "",
    activeEnvId: "none",
    environments: [],
    secretVault: {},
    secretCiphersByKey: {},
    revealedHeaders: {},
    revealedEnvVars: {},
    showBearerToken: false,
    showBasicPassword: false,
    showApiKeyValue: false,
    runtimeVars: {},
    collections: [initialCol],
    activeCollectionIdx: 0,
    openTabs: [JSON.parse(JSON.stringify(initialCol.requests[0]))],
    activeTabId: initialCol.requests[0].id,
    responsesByReqId: {},
    history: [],
    customFlows: [],
    activeFlowId: null,
    inFlightReqId: null,
    foldedRespLines: {}
  };
}

export function restoreWorkspaceFromLocalStorage(state) {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.collections) && parsed.collections.length > 0) {
      state.collections = parsed.collections.map((col) => ({
        ...col,
        requests: (col.requests || []).map((r) => decryptRequestSensitiveFields(r))
      }));
    }
    if (Array.isArray(parsed.environments)) {
      state.environments = parsed.environments.map((env) => ({
        ...env,
        variables: (env.variables || []).map((v) => ({
          ...v,
          value: v.isSecret && String(v.value || "").startsWith(ENCRYPTED_PREFIX) ? decryptSecretValue(v.value) : v.value
        }))
      }));
    }
    if (parsed.activeEnvId) {
      state.activeEnvId = parsed.activeEnvId;
    }

    if (hasAdminPasswordConfigured() && parsed.encryptedSecretVault && typeof parsed.encryptedSecretVault === "object") {
      const decVault = {};
      const ciphersMap = {};
      for (const [k, encVal] of Object.entries(parsed.encryptedSecretVault)) {
        decVault[k] = decryptSecretValue(encVal);
        ciphersMap[k] = encVal;
      }
      state.secretVault = decVault;
      state.secretCiphersByKey = ciphersMap;
    } else {
      state.secretVault = {};
      state.secretCiphersByKey = {};
    }

    if (Array.isArray(parsed.openTabs) && parsed.openTabs.length > 0) {
      state.openTabs = parsed.openTabs.map((r) => decryptRequestSensitiveFields(r));
      state.activeTabId = parsed.activeTabId || state.openTabs[0].id;
    }
    if (Array.isArray(parsed.history)) {
      state.history = parsed.history;
    }
    if (Array.isArray(parsed.customFlows)) {
      state.customFlows = parsed.customFlows;
      state.activeFlowId = parsed.activeFlowId || state.customFlows[0]?.id || null;
    }
    ensureUniqueWorkspaceIds(state);
  } catch {}
}

export function persistWorkspaceToLocalStorage(state) {
  ensureUniqueWorkspaceIds(state);
  saveViewPreferences(state);
  try {
    state.secretCiphersByKey = state.secretCiphersByKey || {};
    const encryptedSecretVault = {};
    if (hasAdminPasswordConfigured()) {
      for (const [k, plainVal] of Object.entries(state.secretVault || {})) {
        if (!state.secretCiphersByKey[k]) {
          state.secretCiphersByKey[k] = encryptSecretValue(plainVal);
        }
        encryptedSecretVault[k] = state.secretCiphersByKey[k];
      }
    }

    const encryptedCollections = (state.collections || []).map((col) => ({
      ...col,
      requests: (col.requests || []).map((r) => encryptRequestSensitiveFields(r))
    }));
    const encryptedEnvironments = (state.environments || []).map((env) => ({
      ...env,
      variables: (env.variables || []).map((v) => ({
        ...v,
        value: v.isSecret ? encryptSecretValue(v.value) : v.value
      }))
    }));
    const encryptedOpenTabs = (state.openTabs || []).map((r) => encryptRequestSensitiveFields(r));

    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        collections: encryptedCollections,
        environments: encryptedEnvironments,
        activeEnvId: state.activeEnvId,
        encryptedSecretVault,
        openTabs: encryptedOpenTabs,
        activeTabId: state.activeTabId,
        history: (state.history || []).slice(0, 100),
        customFlows: state.customFlows,
        activeFlowId: state.activeFlowId
      })
    );
  } catch {}
}

export function setInitialAdminPassword(newPassword, state) {
  return setInitialAdminPasswordWithPersist(newPassword, state, persistWorkspaceToLocalStorage);
}

export function changeAdminPasswordPreservingSecrets(oldPassword, newPassword, state) {
  return changeAdminPasswordWithPersist(oldPassword, newPassword, state, persistWorkspaceToLocalStorage);
}

export function resetForgottenAdminPasswordWipingSecrets(newPassword, state) {
  return resetForgottenAdminPasswordWithPersist(newPassword, state, persistWorkspaceToLocalStorage);
}
