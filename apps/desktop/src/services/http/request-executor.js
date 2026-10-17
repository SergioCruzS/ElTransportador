/**
 * Ejecutor de Peticiones HTTP (Tauri / IPC Bridge / Fetch) con Internacionalización de Errores — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/services/http/request-executor.js
 */
import { translate } from "../../lang/i18n.js";
import { persistWorkspaceToLocalStorage } from "../storage/index.js";
import {
  getBridgeTokenFromMeta,
  getActiveEnvironmentVars,
  resolveVariablesInString,
  buildFullResolvedUrlWithParams,
  maskSecretsInString,
  sanitizeRequestSnapshotForHistory
} from "./variable-interpolation.js";
import { getByDotPath, evaluateAssertions, formatAssertionMessage } from "./assertions-evaluator.js";

/**
 * Localiza dinámicamente el estado, cuerpo de error y mensajes de aserción de una respuesta
 * según el idioma activo (`es` o `en`), incluso si se cambia el idioma después de ejecutar la petición.
 */
export function localizeResponseForLang(resp, lang = "es") {
  if (!resp || typeof resp !== "object") return resp;
  const localized = { ...resp };

  if (Array.isArray(localized.assertionResults)) {
    localized.assertionResults = localized.assertionResults.map((a) => ({
      ...a,
      message: a.target && a.operator ? formatAssertionMessage(a, lang) : a.message
    }));
  }

  const meta = localized.errorMeta;
  if (meta && meta.type) {
    if (meta.type === "INVALID_URL") {
      localized.statusText = translate(lang, "errors.invalidUrlStatus");
      const bodyStr = JSON.stringify(
        {
          error: translate(lang, "errors.invalidUrlCode"),
          message: translate(lang, "errors.invalidUrlMsg", { url: meta.url || "" })
        },
        null,
        2
      );
      localized.body = bodyStr;
      localized.sizeBytes = new Blob([bodyStr]).size;
      localized.error = { code: "INVALID_URL", message: translate(lang, "errors.invalidUrlShort") };
    } else if (meta.type === "BLOCKED_SCHEME") {
      localized.statusText = translate(lang, "errors.blockedSchemeStatus");
      const bodyStr = JSON.stringify(
        {
          error: translate(lang, "errors.blockedSchemeCode"),
          message: translate(lang, "errors.blockedSchemeMsg")
        },
        null,
        2
      );
      localized.body = bodyStr;
      localized.sizeBytes = new Blob([bodyStr]).size;
      localized.error = { code: "BLOCKED_SCHEME", message: translate(lang, "errors.blockedSchemeShort") };
    } else if (meta.type === "SSRF_BLOCKED") {
      localized.statusText = translate(lang, "errors.ssrfBlockedStatus");
      const bodyStr = JSON.stringify(
        {
          error: translate(lang, "errors.ssrfBlockedCode"),
          message: translate(lang, "errors.ssrfBlockedMsg")
        },
        null,
        2
      );
      localized.body = bodyStr;
      localized.sizeBytes = new Blob([bodyStr]).size;
      localized.error = { code: "SSRF_BLOCKED", message: translate(lang, "errors.ssrfBlockedShort") };
    } else if (meta.type === "CONNECTION_ERROR") {
      localized.statusText = translate(lang, "errors.connectionErrorStatus");
      const bodyStr = JSON.stringify(
        {
          error: translate(lang, "errors.connectionErrorCode"),
          message: translate(lang, "errors.connectionErrorMsg", { url: meta.url || "" }),
          details: meta.rawDetails || translate(lang, "errors.connectionErrorDetails")
        },
        null,
        2
      );
      localized.body = bodyStr;
      localized.sizeBytes = new Blob([bodyStr]).size;
      localized.error = { code: "NETWORK_ERROR", message: translate(lang, "errors.networkErrorShort") };
    }
  } else if (localized.status === 0) {
    // También localizar respuestas legacy o del bridge que tengan códigos de error conocidos
    const errCode = localized.error?.code || "";
    if (errCode === "INVALID_URL" || localized.statusText === "URL INVÁLIDA" || localized.statusText === "INVALID URL") {
      localized.statusText = translate(lang, "errors.invalidUrlStatus");
    } else if (errCode === "BLOCKED_SCHEME" || localized.statusText === "BLOCKED_SCHEME") {
      localized.statusText = translate(lang, "errors.blockedSchemeStatus");
    } else if (errCode.includes("SSRF") || localized.statusText === "SSRF BLOCKED") {
      localized.statusText = translate(lang, "errors.ssrfBlockedStatus");
    } else if (errCode === "NETWORK_ERROR" || localized.statusText === "ERROR DE CONEXIÓN" || localized.statusText === "CONNECTION ERROR") {
      localized.statusText = translate(lang, "errors.connectionErrorStatus");
    }
  }

  return localized;
}

async function tryTauriNativeInvoke(req, state, finalUrl) {
  const tauriInvoke = globalThis.__TAURI__?.core?.invoke || globalThis.__TAURI_INTERNALS__?.invoke;
  if (typeof tauriInvoke !== "function") return null;
  const lang = state.lang || "es";
  try {
    const colVars = {};
    for (const col of state.collections || []) {
      for (const v of col.variables || []) {
        if (v.enabled && !v.isSecret) colVars[v.key] = v.value;
      }
    }
    const envVars = getActiveEnvironmentVars(state);
    const resp = await tauriInvoke("execute_http_request", {
      request: req,
      runtimeVars: state.runtimeVars,
      environmentVars: envVars,
      collectionVars: colVars,
      secrets: state.secretVault
    });
    if (resp) return localizeResponseForLang(resp, lang);
  } catch (err) {
    const baseResp = {
      requestId: req.id,
      status: 0,
      statusText: translate(lang, "errors.connectionErrorStatus"),
      durationMs: 1,
      sizeBytes: 0,
      headers: {},
      cookies: [],
      body: "",
      isJson: true,
      redirects: [],
      assertionResults: evaluateAssertions(
        req.assertions || [],
        { status: 0, durationMs: 1, headers: {}, body: "", bodyObj: null },
        lang
      ),
      extractedVariables: {},
      timestamp: new Date().toISOString(),
      errorMeta: { type: "CONNECTION_ERROR", url: finalUrl, rawDetails: String(err) }
    };
    return localizeResponseForLang(baseResp, lang);
  }
  return null;
}

async function executeBrowserFetch(req, finalUrl, state) {
  const start = performance.now();
  const controller = new AbortController();
  const timeoutMs = req.settings?.timeoutMs || 10000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const lang = state.lang || "es";

  try {
    const headers = {};
    for (const h of req.headers || []) {
      if (h && h.enabled && h.key) {
        headers[resolveVariablesInString(h.key, state).text] = resolveVariablesInString(h.value || "", state).text;
      }
    }
    if (req.auth?.type === "bearer" && req.auth.bearerToken) {
      headers["Authorization"] = "Bearer " + resolveVariablesInString(req.auth.bearerToken, state).text;
    } else if (req.auth?.type === "basic" && (req.auth.basicUsername || req.auth.basicPassword)) {
      const u = resolveVariablesInString(req.auth.basicUsername || "", state).text;
      const p = resolveVariablesInString(req.auth.basicPassword || "", state).text;
      headers["Authorization"] = "Basic " + btoa(u + ":" + p);
    } else if (req.auth?.type === "apikey" && req.auth.apiKeyName && req.auth.apiKeyValue) {
      if (req.auth.apiKeyIn !== "query") {
        headers[resolveVariablesInString(req.auth.apiKeyName, state).text] = resolveVariablesInString(req.auth.apiKeyValue, state).text;
      }
    }

    const fetchOpts = {
      method: req.method || "GET",
      headers,
      signal: controller.signal
    };

    if (!["GET", "HEAD"].includes(fetchOpts.method) && req.body?.mode && req.body.mode !== "none") {
      if (req.body.mode === "json" || req.body.mode === "text") {
        fetchOpts.body = resolveVariablesInString(req.body.raw || "", state).text;
      } else if (req.body.mode === "urlencoded") {
        const sp = new URLSearchParams();
        for (const item of req.body.urlencoded || []) {
          if (item && item.enabled && item.key) {
            sp.append(resolveVariablesInString(item.key, state).text, resolveVariablesInString(item.value || "", state).text);
          }
        }
        fetchOpts.body = sp.toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8";
      } else if (req.body.mode === "multipart") {
        const fd = new FormData();
        for (const item of req.body.multipart || []) {
          if (item && item.enabled && item.key) {
            fd.append(resolveVariablesInString(item.key, state).text, resolveVariablesInString(item.value || "", state).text);
          }
        }
        fetchOpts.body = fd;
      }
    }

    const res = await fetch(finalUrl, fetchOpts);
    clearTimeout(timer);
    const rawText = await res.text();
    const durationMs = Math.max(1, Math.round(performance.now() - start));
    const respHeaders = {};
    res.headers.forEach((val, key) => {
      respHeaders[key] = val;
    });

    let formattedBody = rawText;
    let parsedObj = null;
    try {
      parsedObj = JSON.parse(rawText);
      formattedBody = JSON.stringify(parsedObj, null, 2);
    } catch {}

    const assertionResults = evaluateAssertions(
      req.assertions || [],
      {
        status: res.status,
        durationMs,
        headers: respHeaders,
        body: formattedBody,
        bodyObj: parsedObj
      },
      lang
    );

    const extractedVariables = {};
    for (const ext of req.extractions || []) {
      if (ext.enabled && ext.source === "json_path" && parsedObj) {
        const val = getByDotPath(parsedObj, ext.path);
        if (val !== undefined) {
          extractedVariables[ext.variableName] = String(val);
          state.runtimeVars[ext.variableName] = String(val);
        }
      }
    }

    return {
      requestId: req.id,
      status: res.status,
      statusText: res.statusText || (res.status === 200 ? "OK" : res.status === 404 ? "Not Found" : "Response"),
      durationMs,
      sizeBytes: new Blob([rawText]).size,
      headers: respHeaders,
      cookies: [],
      body: formattedBody,
      isJson: parsedObj !== null,
      redirects: [],
      assertionResults,
      extractedVariables,
      timestamp: new Date().toISOString(),
      error: res.status >= 400 ? { code: "HTTP_ERROR", message: `HTTP ${res.status}` } : null
    };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Math.max(1, Math.round(performance.now() - start));
    const baseResp = {
      requestId: req.id,
      status: 0,
      statusText: translate(lang, "errors.connectionErrorStatus"),
      durationMs,
      sizeBytes: 0,
      headers: {},
      cookies: [],
      body: "",
      isJson: true,
      redirects: [],
      assertionResults: evaluateAssertions(
        req.assertions || [],
        {
          status: 0,
          durationMs,
          headers: {},
          body: "",
          bodyObj: null
        },
        lang
      ),
      extractedVariables: {},
      timestamp: new Date().toISOString(),
      errorMeta: { type: "CONNECTION_ERROR", url: finalUrl, rawDetails: null }
    };
    return localizeResponseForLang(baseResp, lang);
  }
}

export async function executeSingleRequestObject(req, state) {
  const { text: finalUrl } = buildFullResolvedUrlWithParams(req, state);
  const lang = state.lang || "es";

  let parsedCheck = null;
  try {
    parsedCheck = new URL(finalUrl);
  } catch {
    const baseResp = {
      requestId: req.id,
      status: 0,
      statusText: translate(lang, "errors.invalidUrlStatus"),
      durationMs: 1,
      sizeBytes: 0,
      headers: {},
      cookies: [],
      body: "",
      isJson: true,
      redirects: [],
      assertionResults: evaluateAssertions(
        req.assertions || [],
        {
          status: 0,
          durationMs: 1,
          headers: {},
          body: "",
          bodyObj: null
        },
        lang
      ),
      extractedVariables: {},
      timestamp: new Date().toISOString(),
      errorMeta: { type: "INVALID_URL", url: finalUrl }
    };
    return localizeResponseForLang(baseResp, lang);
  }

  if (parsedCheck.protocol !== "http:" && parsedCheck.protocol !== "https:") {
    const baseResp = {
      requestId: req.id,
      status: 0,
      statusText: translate(lang, "errors.blockedSchemeStatus"),
      durationMs: 1,
      sizeBytes: 0,
      headers: {},
      cookies: [],
      body: "",
      isJson: true,
      redirects: [],
      assertionResults: [],
      extractedVariables: {},
      timestamp: new Date().toISOString(),
      errorMeta: { type: "BLOCKED_SCHEME", url: finalUrl }
    };
    return localizeResponseForLang(baseResp, lang);
  }

  if (parsedCheck.hostname === "169.254.169.254" || parsedCheck.hostname === "metadata.google.internal") {
    const baseResp = {
      requestId: req.id,
      status: 0,
      statusText: translate(lang, "errors.ssrfBlockedStatus"),
      durationMs: 1,
      sizeBytes: 0,
      headers: {},
      cookies: [],
      body: "",
      isJson: true,
      redirects: [],
      assertionResults: [],
      extractedVariables: {},
      timestamp: new Date().toISOString(),
      errorMeta: { type: "SSRF_BLOCKED", url: finalUrl }
    };
    return localizeResponseForLang(baseResp, lang);
  }

  const tauriResp = await tryTauriNativeInvoke(req, state, finalUrl);
  if (tauriResp) return tauriResp;

  const envVars = getActiveEnvironmentVars(state);
  const colVars = {};
  for (const col of state.collections || []) {
    for (const v of col.variables || []) {
      if (v.enabled && !v.isSecret) colVars[v.key] = v.value;
    }
  }

  try {
    const bridgeHeaders = { "Content-Type": "application/json" };
    const token = getBridgeTokenFromMeta();
    if (token) bridgeHeaders["X-ETP-Bridge-Token"] = token;

    const bridgeRes = await fetch("/__etp_ipc__/execute_request", {
      method: "POST",
      headers: bridgeHeaders,
      body: JSON.stringify({
        request: req,
        runtimeVars: state.runtimeVars,
        environmentVars: envVars,
        collectionVars: colVars,
        secrets: state.secretVault,
        lang
      })
    });
    if (bridgeRes.ok) {
      const data = await bridgeRes.json();
      for (const [k, v] of Object.entries(data.response.extractedVariables || {})) {
        state.runtimeVars[k] = v;
      }
      if (data.response.status === 0 && !data.response.errorMeta) {
        data.response.errorMeta = { type: "CONNECTION_ERROR", url: finalUrl, rawDetails: null };
      }
      return localizeResponseForLang(data.response, lang);
    }
  } catch {}

  return await executeBrowserFetch(req, finalUrl, state);
}

export function recordInHistory(req, resp, finalUrl, state) {
  const sanitizedReq = sanitizeRequestSnapshotForHistory(req, state);
  const sanitizedResp = JSON.parse(JSON.stringify(resp));
  if (sanitizedResp.body) {
    sanitizedResp.body = maskSecretsInString(sanitizedResp.body, state);
  }

  const entry = {
    id: "hst_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    requestId: req.id,
    name: req.name,
    method: req.method,
    url: maskSecretsInString(finalUrl, state),
    status: resp.status,
    durationMs: resp.durationMs,
    sizeBytes: resp.sizeBytes,
    timestamp: resp.timestamp || new Date().toISOString(),
    requestSnapshot: sanitizedReq,
    responseSnapshot: sanitizedResp
  };
  state.history.unshift(entry);
  persistWorkspaceToLocalStorage(state);
}
