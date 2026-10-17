/**
 * Sanitizador de Colecciones, Validador de Nombres Únicos y Normalizador de IDs — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/services/storage/collection-sanitizer.js
 */
import { translate } from "../../lang/i18n.js";
import { APP_VERSION } from "./constants.js";

let uniqueIdSeq = 1;
export function generateUniqueEntityId(prefix = "id") {
  uniqueIdSeq = (uniqueIdSeq + 1) % 1000000;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now()}_${uniqueIdSeq}_${rand}`;
}

/**
 * Verifica si ya existe una colección con el mismo nombre (insensible a mayúsculas/minúsculas y espacios extremos).
 */
export function isCollectionNameDuplicate(collections, candidateName, ignoreColIdx = -1) {
  const normalized = String(candidateName || "").trim().toLowerCase();
  if (!normalized) return false;
  return (collections || []).some((col, idx) => {
    if (idx === ignoreColIdx) return false;
    const existing = String(col?.metadata?.name || "").trim().toLowerCase();
    return existing === normalized;
  });
}

/**
 * Genera un nombre de colección sugerido único que no colisione con ninguna colección existente.
 */
export function getNextAvailableCollectionName(collections, basePrefix = "Collection") {
  let n = (collections || []).length + 1;
  let candidate = `${basePrefix} ${n}`;
  while (isCollectionNameDuplicate(collections, candidate)) {
    n++;
    candidate = `${basePrefix} ${n}`;
  }
  return candidate;
}

/**
 * Garantiza que todas las colecciones, carpetas y solicitudes tengan IDs globalmente únicos
 * para evitar que seleccionar o mover una solicitud afecte a solicitudes de otras colecciones.
 */
export function ensureUniqueWorkspaceIds(state) {
  if (!state || !Array.isArray(state.collections)) return;
  const seenColIds = new Set();
  const seenFolderIds = new Set();
  const seenReqIds = new Set();

  state.collections.forEach((col, colIdx) => {
    col.metadata = col.metadata || {};
    if (!col.metadata.id || seenColIds.has(col.metadata.id)) {
      col.metadata.id = generateUniqueEntityId(`col_${colIdx}`);
    }
    seenColIds.add(col.metadata.id);

    const folderIdRemap = new Map();
    col.folders = Array.isArray(col.folders) ? col.folders : [];
    col.folders.forEach((fld, fIdx) => {
      const oldId = fld.id;
      if (!oldId || seenFolderIds.has(oldId)) {
        const nextId = generateUniqueEntityId(`fld_${colIdx}_${fIdx}`);
        if (oldId) folderIdRemap.set(oldId, nextId);
        fld.id = nextId;
      }
      seenFolderIds.add(fld.id);
    });

    col.requests = Array.isArray(col.requests) ? col.requests : [];
    col.requests.forEach((req, rIdx) => {
      if (req.folderId && folderIdRemap.has(req.folderId)) {
        req.folderId = folderIdRemap.get(req.folderId);
      }
      if (!req.id || seenReqIds.has(req.id)) {
        req.id = generateUniqueEntityId(`req_${colIdx}_${rIdx}`);
      }
      seenReqIds.add(req.id);
    });
  });

  if (Array.isArray(state.openTabs)) {
    const validTabIds = new Set();
    state.openTabs.forEach((tab, tIdx) => {
      if (!tab.id || validTabIds.has(tab.id)) {
        tab.id = generateUniqueEntityId(`tab_${tIdx}`);
      }
      validTabIds.add(tab.id);
    });
  }
}

/**
 * Sanitiza una colección antes de exportarla, eliminando cualquier secreto en texto plano.
 */
export function sanitizeCollectionForExport(collection) {
  const clean = JSON.parse(JSON.stringify(collection));
  if (Array.isArray(clean.variables)) {
    for (const v of clean.variables) {
      if (v && (v.isSecret || (!v._userToggledSecret && /secret|token|password|apikey|api_key/i.test(v.key || "")))) {
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
          if (h.isSecret || (!h._userToggledSecret && isSensHeader)) {
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

/**
 * Sanitiza y valida estrictamente una colección importada, asignando IDs únicos nuevos
 * a carpetas y solicitudes para impedir colisiones de selección o movimiento entre colecciones.
 */
export function sanitizeImportedCollection(rawParsed, lang = "es") {
  if (!rawParsed || typeof rawParsed !== "object") {
    throw new Error(translate(lang, "errors.invalidImportJson"));
  }
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  const str = (v, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

  const folderIdMap = new Map();
  const cleanFolders = Array.isArray(rawParsed.folders)
    ? rawParsed.folders.map((f, idx) => {
        const origId = str(f?.id, 80);
        const freshId = generateUniqueEntityId(`fld_imp_${idx}`);
        if (origId) folderIdMap.set(origId, freshId);
        return {
          id: freshId,
          name: str(f?.name, 160) || `Folder ${idx + 1}`,
          parentId: null
        };
      })
    : [];

  const cleanRequests = Array.isArray(rawParsed.requests)
    ? rawParsed.requests.map((r, idx) => {
        const m = str(r?.method, 16).toUpperCase();
        const origFolderId = r?.folderId ? str(r.folderId, 80) : null;
        const mappedFolderId = origFolderId && folderIdMap.has(origFolderId) ? folderIdMap.get(origFolderId) : null;
        return {
          id: generateUniqueEntityId(`req_imp_${idx}`),
          name: str(r?.name, 200) || `Request ${idx + 1}`,
          folderId: mappedFolderId,
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
      id: generateUniqueEntityId("col_imp"),
      name: str(rawParsed.metadata?.name || rawParsed.info?.title, 160) || translate(lang, "defaults.importedCollectionName"),
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
