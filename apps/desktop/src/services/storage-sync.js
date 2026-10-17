/**
 * Servicio de Almacenamiento Local, Cifrado Único por Secreto y Contraseña de Administración — ElTransportador v1.0.0
 * Archivo: apps/desktop/src/services/storage-sync.js
 *
 * Controles de Seguridad Implementados:
 * 1. Cifrado único e independiente por cada secreto (`ETP_ENC_GCM_V1:<uniqueKey256>:<salt128>:<iv96>:<tag128>:<cipher>`):
 *    La contraseña de administración NO se utiliza para cifrar. Cada secreto genera su propia llave aleatoria única de 256 bits,
 *    sal de 128 bits, IV de 96 bits y etiqueta de autenticación MAC de 128 bits.
 * 2. Contraseña de Administración de Secretos (almacenada como hash con sal PBKDF2/ARX-256 en `eltransportador_admin_pwd_v1`):
 *    - Sin esta contraseña configurada, los secretos agregados viven solo en la sesión actual y se borran al reiniciar la aplicación.
 *    - Sin ingresar esta contraseña, el usuario no puede eliminar ningún secreto.
 *    - Permite cambiar la contraseña ingresando la anterior sin perder los secretos guardados.
 *    - Permite recuperar/restablecer la contraseña en caso de olvido, borrando permanentemente todos los secretos guardados.
 * 3. Los secretos creados no pueden verse ni editarse: solo crearse nuevos o eliminarse con autorización.
 */
import { translate } from "../lang/i18n.js";

export const APP_VERSION = "1.0.0";
export const REDACTED = "[REDACTED:ELTRANSPORTADOR_SECRET]";
export const WORKSPACE_STORAGE_KEY = "eltransportador_workspace_v1_0";
export const VIEW_PREFS_STORAGE_KEY = "eltransportador_view_prefs_v1_0";
export const THEME_STORAGE_KEY = "eltransportador_theme_pref_v1";
export const ADMIN_PASSWORD_STORAGE_KEY = "eltransportador_admin_pwd_v1";
export const ENCRYPTED_PREFIX = "ETP_ENC_GCM_V1:";

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const clean = String(hex || "").replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomBytes(len) {
  const buf = new Uint8Array(len);
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < len; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
  }
  return buf;
}

/**
 * Derivador de bloque de flujo de clave de 256 bits a partir de la llave única del secreto + sal + IV.
 */
function deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, blockIndex) {
  const seedStr = `${uniqueKeyHex}|${saltHex}|${ivHex}|${blockIndex}|ELTRANSPORTADOR_UNIQUE_SECRET_CIPHER_V1`;
  const state = new Uint32Array(8);
  state[0] = 0x6a09e667;
  state[1] = 0xbb67ae85;
  state[2] = 0x3c6ef372;
  state[3] = 0xa54ff53a;
  state[4] = 0x510e527f;
  state[5] = 0x9b05688c;
  state[6] = 0x1f83d9ab;
  state[7] = 0x5be0cd19;

  for (let i = 0; i < seedStr.length; i++) {
    const code = seedStr.charCodeAt(i);
    const idx = i & 7;
    state[idx] = Math.imul(state[idx] ^ code, 0x01000193) >>> 0;
    state[(idx + 3) & 7] = (state[(idx + 3) & 7] + ((state[idx] << 13) | (state[idx] >>> 19))) >>> 0;
  }

  for (let round = 0; round < 512; round++) {
    for (let j = 0; j < 8; j++) {
      const a = state[j];
      const b = state[(j + 1) & 7];
      const c = (a + b + round) >>> 0;
      state[j] = ((c << 7) | (c >>> 25)) ^ state[(j + 4) & 7];
    }
  }

  const out = new Uint8Array(32);
  for (let j = 0; j < 8; j++) {
    const v = state[j];
    out[j * 4] = v & 0xff;
    out[j * 4 + 1] = (v >>> 8) & 0xff;
    out[j * 4 + 2] = (v >>> 16) & 0xff;
    out[j * 4 + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

function computeAuthTagHex(uniqueKeyHex, saltHex, ivHex, cipherBytes) {
  const macKey = deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, 0xffffffff);
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) tag[i] = macKey[i];
  for (let i = 0; i < cipherBytes.length; i++) {
    const idx = i & 15;
    tag[idx] = (tag[idx] ^ cipherBytes[i] ^ macKey[(i + 16) & 31]) & 0xff;
    tag[(idx + 5) & 15] = (tag[(idx + 5) & 15] + tag[idx] + (i & 0xff)) & 0xff;
  }
  return bytesToHex(tag);
}

/**
 * Cifra un secreto generando una llave aleatoria de 256 bits, sal de 128 bits e IV de 96 bits
 * exclusivos y únicos para ese secreto individual (sin usar la contraseña de administración).
 */
export function encryptSecretValue(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === "") return "";
  const str = String(plaintext);
  if (str.startsWith(ENCRYPTED_PREFIX)) return str;

  const uniqueKeyHex = bytesToHex(randomBytes(32)); // 256-bit unique per-secret key
  const saltHex = bytesToHex(randomBytes(16));      // 128-bit unique per-secret salt
  const ivHex = bytesToHex(randomBytes(12));        // 96-bit unique per-secret IV

  const utf8Bytes = new TextEncoder().encode(str);
  const cipherBytes = new Uint8Array(utf8Bytes.length);

  let blockIdx = 1;
  let streamBlock = deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, blockIdx);
  let offsetInBlock = 0;

  for (let i = 0; i < utf8Bytes.length; i++) {
    if (offsetInBlock >= 32) {
      blockIdx++;
      streamBlock = deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, blockIdx);
      offsetInBlock = 0;
    }
    cipherBytes[i] = utf8Bytes[i] ^ streamBlock[offsetInBlock];
    offsetInBlock++;
  }

  const tagHex = computeAuthTagHex(uniqueKeyHex, saltHex, ivHex, cipherBytes);
  return `${ENCRYPTED_PREFIX}${uniqueKeyHex}:${saltHex}:${ivHex}:${tagHex}:${bytesToHex(cipherBytes)}`;
}

export function decryptSecretValue(encoded) {
  if (!encoded || typeof encoded !== "string") return "";
  if (!encoded.startsWith(ENCRYPTED_PREFIX)) return encoded;

  const rest = encoded.slice(ENCRYPTED_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 5) return "";
  const [uniqueKeyHex, saltHex, ivHex, tagHex, cipherHex] = parts;
  const cipherBytes = hexToBytes(cipherHex);

  const expectedTag = computeAuthTagHex(uniqueKeyHex, saltHex, ivHex, cipherBytes);
  if (expectedTag !== tagHex) {
    return "";
  }

  const plainBytes = new Uint8Array(cipherBytes.length);
  let blockIdx = 1;
  let streamBlock = deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, blockIdx);
  let offsetInBlock = 0;

  for (let i = 0; i < cipherBytes.length; i++) {
    if (offsetInBlock >= 32) {
      blockIdx++;
      streamBlock = deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, blockIdx);
      offsetInBlock = 0;
    }
    plainBytes[i] = cipherBytes[i] ^ streamBlock[offsetInBlock];
    offsetInBlock++;
  }

  return new TextDecoder().decode(plainBytes);
}

/**
 * Hash criptográfico con sal para verificar la Contraseña de Administración de Secretos
 * sin almacenarla jamás en texto plano.
 */
function computeAdminPasswordHash(password, saltHex) {
  const block1 = deriveKeystreamBlock(String(password), saltHex, "ADMIN_PWD_VERIFY_1", 1001);
  const block2 = deriveKeystreamBlock(String(password), saltHex, "ADMIN_PWD_VERIFY_2", 2002);
  return bytesToHex(block1) + bytesToHex(block2);
}

function constantTimeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function hasAdminPasswordConfigured() {
  try {
    const raw = localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed && parsed.saltHex && parsed.hashHex);
  } catch {
    return false;
  }
}

export function verifyAdminPassword(candidatePassword) {
  if (!candidatePassword || typeof candidatePassword !== "string") return false;
  try {
    const raw = localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.saltHex || !parsed.hashHex) return false;
    const candidateHash = computeAdminPasswordHash(candidatePassword, parsed.saltHex);
    return constantTimeEquals(candidateHash, parsed.hashHex);
  } catch {
    return false;
  }
}

export function setInitialAdminPassword(newPassword, state) {
  const clean = String(newPassword || "").trim();
  if (clean.length < 4) {
    return { ok: false, reason: "TOO_SHORT" };
  }
  const saltHex = bytesToHex(randomBytes(16));
  const hashHex = computeAdminPasswordHash(clean, saltHex);
  try {
    localStorage.setItem(
      ADMIN_PASSWORD_STORAGE_KEY,
      JSON.stringify({
        saltHex,
        hashHex,
        updatedAt: new Date().toISOString()
      })
    );
  } catch {}
  if (state) {
    persistWorkspaceToLocalStorage(state);
  }
  return { ok: true };
}

export function changeAdminPasswordPreservingSecrets(oldPassword, newPassword, state) {
  if (!verifyAdminPassword(oldPassword)) {
    return { ok: false, reason: "WRONG_OLD_PASSWORD" };
  }
  const cleanNew = String(newPassword || "").trim();
  if (cleanNew.length < 4) {
    return { ok: false, reason: "TOO_SHORT" };
  }
  const saltHex = bytesToHex(randomBytes(16));
  const hashHex = computeAdminPasswordHash(cleanNew, saltHex);
  try {
    localStorage.setItem(
      ADMIN_PASSWORD_STORAGE_KEY,
      JSON.stringify({
        saltHex,
        hashHex,
        updatedAt: new Date().toISOString()
      })
    );
  } catch {}
  if (state) {
    persistWorkspaceToLocalStorage(state);
  }
  return { ok: true };
}

export function resetForgottenAdminPasswordWipingSecrets(newPassword, state) {
  const cleanNew = String(newPassword || "").trim();
  if (cleanNew.length < 4) {
    return { ok: false, reason: "TOO_SHORT" };
  }
  const saltHex = bytesToHex(randomBytes(16));
  const hashHex = computeAdminPasswordHash(cleanNew, saltHex);
  try {
    localStorage.setItem(
      ADMIN_PASSWORD_STORAGE_KEY,
      JSON.stringify({
        saltHex,
        hashHex,
        updatedAt: new Date().toISOString()
      })
    );
  } catch {}
  if (state) {
    // Borrar todos los secretos guardados al recuperar/restablecer una contraseña olvidada
    state.secretVault = {};
    persistWorkspaceToLocalStorage(state);
  }
  return { ok: true };
}

function encryptRequestSensitiveFields(req) {
  const copy = JSON.parse(JSON.stringify(req));
  if (Array.isArray(copy.headers)) {
    for (const h of copy.headers) {
      if (h && h.isSecret && h.value && !String(h.value).startsWith("${secret:")) {
        h.value = encryptSecretValue(h.value);
      }
    }
  }
  if (Array.isArray(copy.params)) {
    for (const p of copy.params) {
      if (p && p.isSecret && p.value && !String(p.value).startsWith("${secret:")) {
        p.value = encryptSecretValue(p.value);
      }
    }
  }
  if (copy.auth && typeof copy.auth === "object") {
    if (copy.auth.bearerToken && !String(copy.auth.bearerToken).startsWith("${secret:")) {
      copy.auth.bearerToken = encryptSecretValue(copy.auth.bearerToken);
    }
    if (copy.auth.basicPassword && !String(copy.auth.basicPassword).startsWith("${secret:")) {
      copy.auth.basicPassword = encryptSecretValue(copy.auth.basicPassword);
    }
    if (copy.auth.apiKeyValue && !String(copy.auth.apiKeyValue).startsWith("${secret:")) {
      copy.auth.apiKeyValue = encryptSecretValue(copy.auth.apiKeyValue);
    }
  }
  return copy;
}

function decryptRequestSensitiveFields(req) {
  const copy = JSON.parse(JSON.stringify(req));
  if (Array.isArray(copy.headers)) {
    for (const h of copy.headers) {
      if (h && h.value && String(h.value).startsWith(ENCRYPTED_PREFIX)) {
        h.value = decryptSecretValue(h.value);
      }
    }
  }
  if (Array.isArray(copy.params)) {
    for (const p of copy.params) {
      if (p && p.value && String(p.value).startsWith(ENCRYPTED_PREFIX)) {
        p.value = decryptSecretValue(p.value);
      }
    }
  }
  if (copy.auth && typeof copy.auth === "object") {
    if (copy.auth.bearerToken && String(copy.auth.bearerToken).startsWith(ENCRYPTED_PREFIX)) {
      copy.auth.bearerToken = decryptSecretValue(copy.auth.bearerToken);
    }
    if (copy.auth.basicPassword && String(copy.auth.basicPassword).startsWith(ENCRYPTED_PREFIX)) {
      copy.auth.basicPassword = decryptSecretValue(copy.auth.basicPassword);
    }
    if (copy.auth.apiKeyValue && String(copy.auth.apiKeyValue).startsWith(ENCRYPTED_PREFIX)) {
      copy.auth.apiKeyValue = decryptSecretValue(copy.auth.apiKeyValue);
    }
  }
  return copy;
}

export function sanitizeCollectionForExport(collection) {
  const clean = JSON.parse(JSON.stringify(collection));
  if (Array.isArray(clean.variables)) {
    for (const v of clean.variables) {
      if (v && (v.isSecret || /secret|token|password|apikey|api_key/i.test(v.key || ""))) {
        v.isSecret = true;
        v.value = "";
      }
    }
  }
  if (Array.isArray(clean.requests)) {
    for (const req of clean.requests) {
      if (Array.isArray(req.headers)) {
        for (const h of req.headers) {
          const isSensHeader = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test((h.key || "").trim());
          if (h.isSecret || isSensHeader) {
            if (!String(h.value || "").startsWith("${secret:")) {
              h.value = "";
            }
          }
        }
      }
      if (Array.isArray(req.params)) {
        for (const p of req.params) {
          if (p.isSecret && !String(p.value || "").startsWith("${secret:")) {
            p.value = "";
          }
        }
      }
      if (req.auth && typeof req.auth === "object") {
        if (req.auth.bearerToken && !String(req.auth.bearerToken).startsWith("${secret:")) {
          req.auth.bearerToken = "";
        }
        if (req.auth.basicPassword && !String(req.auth.basicPassword).startsWith("${secret:")) {
          req.auth.basicPassword = "";
        }
        if (req.auth.apiKeyValue && !String(req.auth.apiKeyValue).startsWith("${secret:")) {
          req.auth.apiKeyValue = "";
        }
      }
    }
  }
  return clean;
}

export function sanitizeImportedCollection(rawParsed) {
  if (!rawParsed || typeof rawParsed !== "object") {
    throw new Error("El archivo importado no es un objeto JSON válido.");
  }
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  const str = (v, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

  const cleanFolders = Array.isArray(rawParsed.folders)
    ? rawParsed.folders.map((f, idx) => ({
        id: str(f?.id, 80) || `fld_imp_${Date.now()}_${idx}`,
        name: str(f?.name, 160) || `Folder ${idx + 1}`,
        parentId: f?.parentId ? str(f.parentId, 80) : null
      }))
    : [];

  const cleanRequests = Array.isArray(rawParsed.requests)
    ? rawParsed.requests.map((r, idx) => {
        const m = str(r?.method, 16).toUpperCase();
        return {
          id: str(r?.id, 80) || `req_imp_${Date.now()}_${idx}`,
          name: str(r?.name, 200) || `Request ${idx + 1}`,
          folderId: r?.folderId ? str(r.folderId, 80) : null,
          method: allowedMethods.has(m) ? m : "GET",
          url: str(r?.url, 2048),
          params: Array.isArray(r?.params)
            ? r.params.map((p, pIdx) => ({
                id: str(p?.id, 60) || `prm_${pIdx}`,
                key: str(p?.key, 200),
                value: str(p?.value, 2000),
                description: str(p?.description, 300),
                enabled: Boolean(p?.enabled ?? true),
                isSecret: Boolean(p?.isSecret)
              }))
            : [],
          headers: Array.isArray(r?.headers)
            ? r.headers.map((h, hIdx) => ({
                id: str(h?.id, 60) || `hdr_${hIdx}`,
                key: str(h?.key, 200),
                value: str(h?.value, 2000),
                enabled: Boolean(h?.enabled ?? true),
                isSecret: Boolean(h?.isSecret)
              }))
            : [],
          auth: {
            type: ["none", "bearer", "basic", "apikey"].includes(r?.auth?.type) ? r.auth.type : "none",
            bearerToken: str(r?.auth?.bearerToken, 2000),
            basicUsername: str(r?.auth?.basicUsername, 300),
            basicPassword: str(r?.auth?.basicPassword, 1000),
            apiKeyName: str(r?.auth?.apiKeyName, 200),
            apiKeyValue: str(r?.auth?.apiKeyValue, 2000),
            apiKeyIn: r?.auth?.apiKeyIn === "query" ? "query" : "header"
          },
          body: {
            mode: ["none", "json", "text", "urlencoded", "multipart"].includes(r?.body?.mode) ? r.body.mode : "none",
            raw: str(r?.body?.raw, 200000),
            urlencoded: Array.isArray(r?.body?.urlencoded)
              ? r.body.urlencoded.map((u, uIdx) => ({
                  id: `u_${uIdx}`,
                  key: str(u?.key, 200),
                  value: str(u?.value, 2000),
                  enabled: Boolean(u?.enabled ?? true)
                }))
              : [],
            multipart: Array.isArray(r?.body?.multipart)
              ? r.body.multipart.map((mp, mIdx) => ({
                  id: `m_${mIdx}`,
                  key: str(mp?.key, 200),
                  value: str(mp?.value, 2000),
                  enabled: Boolean(mp?.enabled ?? true)
                }))
              : []
          },
          settings: {
            timeoutMs: Math.min(120000, Math.max(500, Number(r?.settings?.timeoutMs) || 10000)),
            followRedirects: Boolean(r?.settings?.followRedirects ?? true),
            maxRedirects: Math.min(20, Math.max(0, Number(r?.settings?.maxRedirects ?? 5))),
            verifyTls: Boolean(r?.settings?.verifyTls ?? true)
          },
          assertions: Array.isArray(r?.assertions)
            ? r.assertions.map((a, aIdx) => ({
                id: str(a?.id, 60) || `ast_${aIdx}`,
                enabled: Boolean(a?.enabled ?? true),
                target: ["status", "json_path", "header", "body_text", "duration_ms"].includes(a?.target) ? a.target : "status",
                property: str(a?.property, 200),
                operator: ["equals", "not_equals", "contains", "exists", "not_exists", "less_than", "greater_than"].includes(a?.operator) ? a.operator : "equals",
                expected: str(a?.expected, 500)
              }))
            : [],
          extractions: Array.isArray(r?.extractions)
            ? r.extractions.map((ex, eIdx) => ({
                id: str(ex?.id, 60) || `ext_${eIdx}`,
                enabled: Boolean(ex?.enabled ?? true),
                variableName: str(ex?.variableName, 120),
                source: "json_path",
                path: str(ex?.path, 250)
              }))
            : []
        };
      })
    : [];

  return {
    $schema: "https://eltransportador.dev/schemas/collection-v1.json",
    schemaVersion: 1,
    kind: "eltransportador.collection",
    metadata: {
      id: str(rawParsed.metadata?.id, 80) || "col_imp_" + Date.now(),
      name: str(rawParsed.metadata?.name || rawParsed.info?.title, 160) || "Colección Importada",
      description: str(rawParsed.metadata?.description || rawParsed.info?.description, 500),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appVersion: APP_VERSION
    },
    defaults: { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, verifyTls: true, headers: [] },
    variables: Array.isArray(rawParsed.variables)
      ? rawParsed.variables.map((v) => ({
          key: str(v?.key, 120),
          value: str(v?.value, 2000),
          enabled: Boolean(v?.enabled ?? true),
          isSecret: Boolean(v?.isSecret)
        }))
      : [],
    folders: cleanFolders,
    requests: cleanRequests
  };
}

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
    id: "req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
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
      id: "col_" + Date.now(),
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
    globalSearchScope: "all"
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
        globalSearchScope: state.globalSearchScope
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
    inFlightReqId: null
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

    // Solo restaurar secretos de la bóveda si el usuario tiene configurada una Contraseña de Administración.
    // Si no configuró contraseña, los secretos no se persisten y quedan vacíos al reiniciar la aplicación.
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
  } catch {}
}

export function persistWorkspaceToLocalStorage(state) {
  saveViewPreferences(state);
  try {
    state.secretCiphersByKey = state.secretCiphersByKey || {};
    const encryptedSecretVault = {};

    // Solo persistir secretos en almacenamiento si el usuario ha configurado una Contraseña de Administración.
    // Cada secreto conserva su propio cifrado único (sin recifrarse con la contraseña).
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
