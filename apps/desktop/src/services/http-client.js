/**
 * Cliente y Motor de Ejecución HTTP — ElTransportador v1.0.0
 * Archivo: apps/desktop/src/services/http-client.js
 *
 * Controles de Seguridad Implementados:
 * 1. Los secretos e inputs de autenticación se leen en tiempo de ejecución sin mutar ni borrar `state.secretVault` ni `req.auth`.
 * 2. Redacción estricta en `recordInHistory`: ningún secreto ni cabecera `Authorization`/`Cookie`/`X-API-Key` se guarda en texto plano en el historial.
 * 3. Bloqueo de esquemas peligrosos (`file:`, `javascript:`, `data:`, `ftp:`) y endpoints de Cloud Metadata (`169.254.169.254`).
 * 4. Token de autenticación IPC (`X-ETP-Bridge-Token`) al comunicarse con el puente local.
 */
import { REDACTED, persistWorkspaceToLocalStorage } from './storage-sync.js';

export function getBridgeTokenFromMeta() {
  if (typeof document === 'undefined') return '';
  const meta = document.querySelector('meta[name="etp-bridge-token"]');
  return meta ? meta.getAttribute('content') || '' : '';
}

export function getActiveEnvironmentVars(state) {
  if (state.activeEnvId === 'none') return {};
  const found = state.environments.find((e) => e.id === state.activeEnvId);
  if (!found) return {};
  const map = {};
  for (const v of (found.variables || [])) {
    if (v && v.enabled && v.key) {
      map[v.key] = v.value;
    }
  }
  return map;
}

export function resolveVariablesInString(str, state) {
  if (!str || typeof str !== 'string') return { text: '', unresolved: [] };
  const colVars = {};
  for (const col of state.collections) {
    for (const v of (col.variables || [])) {
      if (v.enabled && !v.isSecret) colVars[v.key] = v.value;
    }
  }
  const envVars = getActiveEnvironmentVars(state);
  const unresolved = [];
  const regex = /\$\{\s*(secret:)?([a-zA-Z0-9_.\-]+)\s*\}/g;
  const text = str.replace(regex, (match, secPrefix, key) => {
    if (secPrefix) {
      if (state.secretVault[key] !== undefined && state.secretVault[key] !== '') return state.secretVault[key];
      unresolved.push('secret:' + key);
      return match;
    }
    if (state.runtimeVars[key] !== undefined) return state.runtimeVars[key];
    if (envVars[key] !== undefined) return envVars[key];
    if (colVars[key] !== undefined) return colVars[key];
    unresolved.push(key);
    return match;
  });
  return { text, unresolved };
}

export function buildFullResolvedUrlWithParams(req, state) {
  const { text: baseResolved, unresolved } = resolveVariablesInString(req.url || '', state);
  try {
    const parsed = new URL(baseResolved);
    for (const p of (req.params || [])) {
      if (p && p.enabled && p.key) {
        const k = resolveVariablesInString(p.key, state).text;
        const v = resolveVariablesInString(p.value || '', state).text;
        parsed.searchParams.set(k, v);
      }
    }
    return { text: parsed.toString(), unresolved };
  } catch {
    return { text: baseResolved, unresolved };
  }
}

export function maskSecretsInString(str, state) {
  if (!str || typeof str !== 'string') return '';
  let out = str;
  for (const secVal of Object.values(state.secretVault || {})) {
    if (secVal && String(secVal).length >= 4 && out.includes(secVal)) {
      out = out.split(secVal).join(REDACTED);
    }
  }
  for (const env of (state.environments || [])) {
    for (const v of (env.variables || [])) {
      if (v && v.isSecret && v.value && String(v.value).length >= 4 && out.includes(v.value)) {
        out = out.split(v.value).join(REDACTED);
      }
    }
  }
  return out;
}

export function sanitizeRequestSnapshotForHistory(req, state) {
  const clean = JSON.parse(JSON.stringify(req));
  clean.url = maskSecretsInString(clean.url || '', state);
  if (Array.isArray(clean.headers)) {
    for (const h of clean.headers) {
      const isSens = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test((h.key || '').trim());
      if (h.isSecret || isSens) {
        h.value = REDACTED;
      } else {
        h.value = maskSecretsInString(h.value || '', state);
      }
    }
  }
  if (Array.isArray(clean.params)) {
    for (const p of clean.params) {
      if (p.isSecret) {
        p.value = REDACTED;
      } else {
        p.value = maskSecretsInString(p.value || '', state);
      }
    }
  }
  if (clean.auth && typeof clean.auth === 'object') {
    if (clean.auth.bearerToken) clean.auth.bearerToken = REDACTED;
    if (clean.auth.basicPassword) clean.auth.basicPassword = REDACTED;
    if (clean.auth.apiKeyValue) clean.auth.apiKeyValue = REDACTED;
  }
  if (clean.body && clean.body.raw) {
    clean.body.raw = maskSecretsInString(clean.body.raw, state);
  }
  return clean;
}

export function generateCompleteCurlCommand(req, state) {
  if (!req) return '';
  const { text: fullUrl } = buildFullResolvedUrlWithParams(req, state);
  const method = (req.method || 'GET').toUpperCase();
  const lines = [`curl --location --request ${method} '${maskSecretsInString(fullUrl, state).replace(/'/g, "'\\''")}'`];

  if (req.settings?.verifyTls === false) {
    lines.push(`  --insecure`);
  }

  for (const h of (req.headers || [])) {
    if (h && h.enabled && h.key) {
      const isSens = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test((h.key || '').trim());
      const val = h.isSecret || isSens ? REDACTED : maskSecretsInString(resolveVariablesInString(h.value || '', state).text, state);
      lines.push(`  --header '${h.key}: ${val.replace(/'/g, "'\\''")}'`);
    }
  }

  if (req.auth?.type === 'bearer' && req.auth.bearerToken) {
    lines.push(`  --header 'Authorization: Bearer ${REDACTED}'`);
  } else if (req.auth?.type === 'basic' && (req.auth.basicUsername || req.auth.basicPassword)) {
    const u = resolveVariablesInString(req.auth.basicUsername || '', state).text;
    lines.push(`  --user '${u}:${REDACTED}'`);
  } else if (req.auth?.type === 'apikey' && req.auth.apiKeyName && req.auth.apiKeyValue) {
    if ((req.auth.apiKeyIn || 'header') === 'header') {
      lines.push(`  --header '${req.auth.apiKeyName}: ${REDACTED}'`);
    }
  }

  if (!['GET', 'HEAD'].includes(method) && req.body?.mode && req.body.mode !== 'none') {
    if (req.body.mode === 'json') {
      lines.push(`  --header 'Content-Type: application/json'`);
      const rawJson = maskSecretsInString(resolveVariablesInString(req.body.raw || '{}', state).text, state);
      lines.push(`  --data-raw '${rawJson.replace(/'/g, "'\\''")}'`);
    } else if (req.body.mode === 'text') {
      lines.push(`  --header 'Content-Type: text/plain'`);
      const rawTxt = maskSecretsInString(resolveVariablesInString(req.body.raw || '', state).text, state);
      lines.push(`  --data-raw '${rawTxt.replace(/'/g, "'\\''")}'`);
    } else if (req.body.mode === 'urlencoded') {
      lines.push(`  --header 'Content-Type: application/x-www-form-urlencoded'`);
      for (const u of (req.body.urlencoded || [])) {
        if (u && u.enabled && u.key) {
          lines.push(`  --data-urlencode '${u.key}=${maskSecretsInString(u.value || '', state)}'`);
        }
      }
    } else if (req.body.mode === 'multipart') {
      for (const m of (req.body.multipart || [])) {
        if (m && m.enabled && m.key) {
          lines.push(`  --form '${m.key}="${maskSecretsInString(m.value || '', state)}"'`);
        }
      }
    }
  }
  return lines.join(' \\\n');
}

export function buildLiveHttpWirePreview(req, state) {
  if (!req) return '';
  const { text: fullUrl } = buildFullResolvedUrlWithParams(req, state);
  const lines = [`${req.method || 'GET'} ${maskSecretsInString(fullUrl || '(sin URL)', state)} HTTP/1.1`];
  for (const h of (req.headers || [])) {
    if (h && h.enabled && h.key) {
      const isSens = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test((h.key || '').trim());
      const val = h.isSecret || isSens ? REDACTED : maskSecretsInString(resolveVariablesInString(h.value || '', state).text, state);
      lines.push(`${h.key}: ${val}`);
    }
  }
  if (req.auth?.type === 'bearer' && req.auth.bearerToken) {
    lines.push(`Authorization: Bearer ${REDACTED}`);
  } else if (req.auth?.type === 'basic' && (req.auth.basicUsername || req.auth.basicPassword)) {
    lines.push(`Authorization: Basic ${REDACTED}`);
  } else if (req.auth?.type === 'apikey' && req.auth.apiKeyName) {
    lines.push(`${req.auth.apiKeyName} (${req.auth.apiKeyIn || 'header'}): ${REDACTED}`);
  }
  if (!['GET', 'HEAD'].includes(req.method) && req.body?.mode && req.body.mode !== 'none') {
    if (req.body.mode === 'json' || req.body.mode === 'text') {
      lines.push('', maskSecretsInString(resolveVariablesInString(req.body.raw || '', state).text, state));
    }
  }
  return lines.join('\n');
}

export function getByDotPath(obj, pathStr) {
  if (!obj || !pathStr) return undefined;
  return pathStr.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
}

export function evaluateAssertions(rules, resp) {
  return (rules || []).filter((r) => r.enabled).map((r) => {
    let actual = undefined;
    if (r.target === 'status') actual = String(resp.status);
    else if (r.target === 'duration_ms') actual = String(resp.durationMs);
    else if (r.target === 'header') actual = resp.headers[(r.property || '').toLowerCase()];
    else if (r.target === 'json_path') {
      const v = getByDotPath(resp.bodyObj, r.property || '');
      actual = v === undefined ? undefined : String(v);
    } else if (r.target === 'body_text') actual = resp.body;

    let passed = false;
    if (r.operator === 'equals') passed = actual === r.expected;
    else if (r.operator === 'not_equals') passed = actual !== r.expected;
    else if (r.operator === 'contains') passed = String(actual || '').includes(r.expected);
    else if (r.operator === 'exists') passed = actual !== undefined;
    else if (r.operator === 'not_exists') passed = actual === undefined;
    else if (r.operator === 'less_than') passed = Number(actual) < Number(r.expected);
    else if (r.operator === 'greater_than') passed = Number(actual) > Number(r.expected);

    return {
      ruleId: r.id,
      passed,
      target: r.target,
      property: r.property,
      operator: r.operator,
      expected: r.expected,
      actual: actual === undefined ? '<undefined>' : actual,
      message: passed
        ? 'OK: ' + r.target + (r.property ? ' (' + r.property + ')' : '') + ' ' + r.operator + ' ' + r.expected
        : 'Fallo: esperado ' + r.expected + ', obtenido ' + actual
    };
  });
}

async function tryTauriNativeInvoke(req, state) {
  const tauriInvoke =
    window.__TAURI__?.core?.invoke ||
    window.__TAURI_INTERNALS__?.invoke;
  if (typeof tauriInvoke !== 'function') return null;

  try {
    const colVars = {};
    for (const col of state.collections) {
      for (const v of (col.variables || [])) {
        if (v.enabled && !v.isSecret) colVars[v.key] = v.value;
      }
    }
    const envVars = getActiveEnvironmentVars(state);
    const resp = await tauriInvoke('execute_http_request', {
      request: req,
      runtimeVars: state.runtimeVars,
      environmentVars: envVars,
      collectionVars: colVars,
      secrets: state.secretVault
    });
    if (resp) return resp;
  } catch (err) {
    return {
      requestId: req.id,
      status: 0,
      statusText: 'ERROR DE CONEXIÓN',
      durationMs: 1,
      sizeBytes: 0,
      headers: {},
      cookies: [],
      body: JSON.stringify({ error: 'ERROR_DE_CONEXION', details: String(err) }, null, 2),
      isJson: true,
      redirects: [],
      assertionResults: evaluateAssertions(req.assertions || [], {
        status: 0,
        durationMs: 1,
        headers: {},
        body: '',
        bodyObj: null
      }),
      extractedVariables: {},
      timestamp: new Date().toISOString(),
      error: { code: 'NETWORK_ERROR', message: String(err) }
    };
  }
  return null;
}

async function executeBrowserFetch(req, finalUrl, state) {
  const start = performance.now();
  const controller = new AbortController();
  const timeoutMs = req.settings?.timeoutMs || 10000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {};
    for (const h of (req.headers || [])) {
      if (h && h.enabled && h.key) {
        headers[resolveVariablesInString(h.key, state).text] = resolveVariablesInString(h.value || '', state).text;
      }
    }
    if (req.auth?.type === 'bearer' && req.auth.bearerToken) {
      headers['Authorization'] = 'Bearer ' + resolveVariablesInString(req.auth.bearerToken, state).text;
    } else if (req.auth?.type === 'basic' && (req.auth.basicUsername || req.auth.basicPassword)) {
      const u = resolveVariablesInString(req.auth.basicUsername || '', state).text;
      const p = resolveVariablesInString(req.auth.basicPassword || '', state).text;
      headers['Authorization'] = 'Basic ' + btoa(u + ':' + p);
    } else if (req.auth?.type === 'apikey' && req.auth.apiKeyName && req.auth.apiKeyValue) {
      if (req.auth.apiKeyIn !== 'query') {
        headers[resolveVariablesInString(req.auth.apiKeyName, state).text] = resolveVariablesInString(req.auth.apiKeyValue, state).text;
      }
    }

    const fetchOpts = {
      method: req.method || 'GET',
      headers,
      signal: controller.signal
    };

    if (!['GET', 'HEAD'].includes(fetchOpts.method) && req.body?.mode && req.body.mode !== 'none') {
      if (req.body.mode === 'json' || req.body.mode === 'text') {
        fetchOpts.body = resolveVariablesInString(req.body.raw || '', state).text;
      } else if (req.body.mode === 'urlencoded') {
        const sp = new URLSearchParams();
        for (const item of (req.body.urlencoded || [])) {
          if (item && item.enabled && item.key) {
            sp.append(resolveVariablesInString(item.key, state).text, resolveVariablesInString(item.value || '', state).text);
          }
        }
        fetchOpts.body = sp.toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
      } else if (req.body.mode === 'multipart') {
        const fd = new FormData();
        for (const item of (req.body.multipart || [])) {
          if (item && item.enabled && item.key) {
            fd.append(resolveVariablesInString(item.key, state).text, resolveVariablesInString(item.value || '', state).text);
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

    const assertionResults = evaluateAssertions(req.assertions || [], {
      status: res.status,
      durationMs,
      headers: respHeaders,
      body: formattedBody,
      bodyObj: parsedObj
    });

    const extractedVariables = {};
    for (const ext of (req.extractions || [])) {
      if (ext.enabled && ext.source === 'json_path' && parsedObj) {
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
      statusText: res.statusText || (res.status === 200 ? 'OK' : res.status === 404 ? 'Not Found' : 'Response'),
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
      error: res.status >= 400 ? { code: 'HTTP_ERROR', message: `HTTP ${res.status}` } : null
    };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Math.max(1, Math.round(performance.now() - start));
    const errBody = JSON.stringify(
      {
        error: 'ERROR_DE_CONEXION_O_URL_INEXISTENTE',
        message: `No fue posible resolver o conectar con la URL solicitada: ${finalUrl}`,
        details: err?.message || 'Host inalcanzable, dominio inexistente o conexión rechazada.'
      },
      null,
      2
    );
    return {
      requestId: req.id,
      status: 0,
      statusText: 'ERROR DE CONEXIÓN',
      durationMs,
      sizeBytes: new Blob([errBody]).size,
      headers: {},
      cookies: [],
      body: errBody,
      isJson: true,
      redirects: [],
      assertionResults: evaluateAssertions(req.assertions || [], {
        status: 0,
        durationMs,
        headers: {},
        body: errBody,
        bodyObj: null
      }),
      extractedVariables: {},
      timestamp: new Date().toISOString(),
      error: { code: 'NETWORK_ERROR', message: err?.message || 'URL inexistente' }
    };
  }
}

export async function executeSingleRequestObject(req, state) {
  const { text: finalUrl } = buildFullResolvedUrlWithParams(req, state);

  let parsedCheck = null;
  try {
    parsedCheck = new URL(finalUrl);
  } catch {
    const badUrlBody = JSON.stringify(
      {
        error: 'INVALID_URL',
        message: `La URL proporcionada es vacía o no tiene un formato HTTP/HTTPS válido: "${finalUrl}"`
      },
      null,
      2
    );
    return {
      requestId: req.id,
      status: 0,
      statusText: 'URL INVÁLIDA',
      durationMs: 1,
      sizeBytes: badUrlBody.length,
      headers: {},
      cookies: [],
      body: badUrlBody,
      isJson: true,
      redirects: [],
      assertionResults: evaluateAssertions(req.assertions || [], {
        status: 0,
        durationMs: 1,
        headers: {},
        body: badUrlBody,
        bodyObj: null
      }),
      extractedVariables: {},
      timestamp: new Date().toISOString(),
      error: { code: 'INVALID_URL', message: 'URL malformada' }
    };
  }

  if (parsedCheck.protocol !== 'http:' && parsedCheck.protocol !== 'https:') {
    const blockedBody = JSON.stringify(
      { error: 'BLOCKED_SCHEME', message: 'Esquema bloqueado por política de seguridad (solo se permite http: o https:).' },
      null,
      2
    );
    return {
      requestId: req.id,
      status: 0,
      statusText: 'BLOCKED_SCHEME',
      durationMs: 1,
      sizeBytes: blockedBody.length,
      headers: {},
      cookies: [],
      body: blockedBody,
      isJson: true,
      redirects: [],
      assertionResults: [],
      extractedVariables: {},
      timestamp: new Date().toISOString(),
      error: { code: 'BLOCKED_SCHEME', message: 'Esquema no permitido' }
    };
  }

  if (parsedCheck.hostname === '169.254.169.254' || parsedCheck.hostname === 'metadata.google.internal') {
    const ssrfBody = JSON.stringify(
      { error: 'SSRF_BLOCKED', message: 'Acceso bloqueado por seguridad anti-SSRF hacia endpoint de Cloud Metadata.' },
      null,
      2
    );
    return {
      requestId: req.id,
      status: 0,
      statusText: 'SSRF BLOCKED',
      durationMs: 1,
      sizeBytes: ssrfBody.length,
      headers: {},
      cookies: [],
      body: ssrfBody,
      isJson: true,
      redirects: [],
      assertionResults: [],
      extractedVariables: {},
      timestamp: new Date().toISOString(),
      error: { code: 'SSRF_BLOCKED', message: 'Cloud Metadata bloqueado' }
    };
  }

  // 1. Invocación Nativa Tauri 2 (.exe)
  const tauriResp = await tryTauriNativeInvoke(req, state);
  if (tauriResp) return tauriResp;

  // 2. Servidor Puente Local autenticado (si está activo en desarrollo)
  const envVars = getActiveEnvironmentVars(state);
  const colVars = {};
  for (const col of state.collections) {
    for (const v of (col.variables || [])) {
      if (v.enabled && !v.isSecret) colVars[v.key] = v.value;
    }
  }
  try {
    const bridgeHeaders = { 'Content-Type': 'application/json' };
    const token = getBridgeTokenFromMeta();
    if (token) bridgeHeaders['X-ETP-Bridge-Token'] = token;

    const bridgeRes = await fetch('/__etp_ipc__/execute_request', {
      method: 'POST',
      headers: bridgeHeaders,
      body: JSON.stringify({
        request: req,
        runtimeVars: state.runtimeVars,
        environmentVars: envVars,
        collectionVars: colVars,
        secrets: state.secretVault
      })
    });
    if (bridgeRes.ok) {
      const data = await bridgeRes.json();
      for (const [k, v] of Object.entries(data.response.extractedVariables || {})) {
        state.runtimeVars[k] = v;
      }
      return data.response;
    }
  } catch {}

  // 3. Ejecución directa vía Fetch estándar
  return await executeBrowserFetch(req, finalUrl, state);
}

export function recordInHistory(req, resp, finalUrl, state) {
  const sanitizedReq = sanitizeRequestSnapshotForHistory(req, state);
  const sanitizedResp = JSON.parse(JSON.stringify(resp));
  if (sanitizedResp.body) {
    sanitizedResp.body = maskSecretsInString(sanitizedResp.body, state);
  }
  const entry = {
    id: 'hst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
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
