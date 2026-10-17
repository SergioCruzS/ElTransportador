/**
 * Motor de Ejecución HTTP Nativo y Ejecutor de Flujos — ElTransportador v1.0.1
 * Archivo: scripts/core-engine/http-executor.mjs
 */
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { URL } from "node:url";
import { activeRequests, registerActiveRequest } from "./constants.mjs";
import { SecretRedactor } from "./secret-vault.mjs";
import { UrlSecurityValidator } from "./url-security.mjs";
import { VariableResolver } from "./variable-resolver.mjs";
import { AssertionEvaluator } from "./assertions.mjs";
import { performSingleHttpHop } from "./http-transport.mjs";

export function parseSetCookieHeader(setCookieHeaders = []) {
  const list = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
    ? [setCookieHeaders]
    : [];
  return list.map((raw) => {
    const parts = String(raw).split(';').map((p) => p.trim());
    const [first, ...attrs] = parts;
    const eqIdx = first.indexOf('=');
    const name = eqIdx >= 0 ? first.slice(0, eqIdx).trim() : first;
    const value = eqIdx >= 0 ? first.slice(eqIdx + 1).trim() : '';
    const info = {
      name,
      value,
      httpOnly: false,
      secure: false,
    };
    for (const attr of attrs) {
      const [k, v] = attr.split('=');
      const lowerK = String(k || '').trim().toLowerCase();
      if (lowerK === 'httponly') info.httpOnly = true;
      else if (lowerK === 'secure') info.secure = true;
      else if (lowerK === 'domain') info.domain = (v || '').trim();
      else if (lowerK === 'path') info.path = (v || '').trim();
      else if (lowerK === 'samesite') info.sameSite = (v || '').trim();
    }
    return info;
  });
}

function buildMultipartBuffer(fields = []) {
  const boundary = `----ElTransportadorBoundary${crypto.randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const field of fields) {
    if (!field || !field.enabled || !field.key) continue;
    const contentTypeLine = field.contentType ? `\r\nContent-Type: ${field.contentType}` : '';
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field.key.replace(/"/g, '\\"')}"${contentTypeLine}\r\n\r\n${field.value ?? ''}\r\n`,
        'utf-8'
      )
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    buffer: Buffer.concat(chunks),
  };
}

export async function executeHttpRequest(requestSpec, options = {}) {
  const startTime = performance.now();
  const timestamp = new Date().toISOString();
  const unresolvedSet = new Set();
  const resolvedSecrets = [];

  const ctx = VariableResolver.buildContext({
    runtimeVars: options.runtimeVars || {},
    environmentVars: options.environmentVars || {},
    collectionVars: options.collectionVars || {},
    globalEnv: options.globalEnv || process.env,
  });
  const vault = options.vault || null;

  const interpolatedBaseUrl = VariableResolver.interpolate(
    requestSpec.url || '',
    ctx,
    vault,
    unresolvedSet,
    resolvedSecrets
  );

  const urlValidation = UrlSecurityValidator.validateRequestUrl(interpolatedBaseUrl);
  if (!urlValidation.ok) {
    return {
      requestId: requestSpec.id || 'req_unknown',
      status: 0,
      statusText: 'Validation Error',
      durationMs: Math.round(performance.now() - startTime),
      sizeBytes: 0,
      headers: {},
      cookies: [],
      body: '',
      isJson: false,
      truncated: false,
      redirects: [],
      unresolvedVariables: Array.from(unresolvedSet),
      assertionResults: [],
      extractedVariables: {},
      timestamp,
      error: urlValidation.error,
    };
  }

  const targetUrl = urlValidation.url;
  for (const param of requestSpec.params || []) {
    if (!param || !param.enabled || !param.key) continue;
    const k = VariableResolver.interpolate(param.key, ctx, vault, unresolvedSet, resolvedSecrets);
    const v = VariableResolver.interpolate(param.value || '', ctx, vault, unresolvedSet, resolvedSecrets);
    targetUrl.searchParams.append(k, v);
  }

  const headers = {};
  for (const h of requestSpec.headers || []) {
    if (!h || !h.enabled || !h.key) continue;
    const k = VariableResolver.interpolate(h.key, ctx, vault, unresolvedSet, resolvedSecrets);
    const v = VariableResolver.interpolate(h.value || '', ctx, vault, unresolvedSet, resolvedSecrets);
    headers[k] = v;
  }

  const auth = requestSpec.auth || { type: 'none' };
  if (auth.type === 'bearer' && auth.bearerToken) {
    const token = VariableResolver.interpolate(auth.bearerToken, ctx, vault, unresolvedSet, resolvedSecrets);
    headers['Authorization'] = `Bearer ${token}`;
  } else if (auth.type === 'basic' && (auth.basicUsername || auth.basicPassword)) {
    const user = VariableResolver.interpolate(auth.basicUsername || '', ctx, vault, unresolvedSet, resolvedSecrets);
    const pass = VariableResolver.interpolate(auth.basicPassword || '', ctx, vault, unresolvedSet, resolvedSecrets);
    const encoded = Buffer.from(`${user}:${pass}`, 'utf-8').toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  } else if (auth.type === 'apikey' && auth.apiKeyName && auth.apiKeyValue) {
    const kName = VariableResolver.interpolate(auth.apiKeyName, ctx, vault, unresolvedSet, resolvedSecrets);
    const kVal = VariableResolver.interpolate(auth.apiKeyValue, ctx, vault, unresolvedSet, resolvedSecrets);
    if (auth.apiKeyIn === 'query') {
      targetUrl.searchParams.set(kName, kVal);
    } else {
      headers[kName] = kVal;
    }
  }

  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] = 'ElTransportador/1.0.0 (com.eltransportador.desktop)';
  }

  let bodyBuffer = null;
  const method = String(requestSpec.method || 'GET').toUpperCase();
  const bodySpec = requestSpec.body || { mode: 'none' };

  if (!['GET', 'HEAD'].includes(method)) {
    if (bodySpec.mode === 'json' && bodySpec.raw) {
      const interpolatedBody = VariableResolver.interpolate(bodySpec.raw, ctx, vault, unresolvedSet, resolvedSecrets);
      bodyBuffer = Buffer.from(interpolatedBody, 'utf-8');
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
      }
    } else if (bodySpec.mode === 'text' && bodySpec.raw) {
      const interpolatedBody = VariableResolver.interpolate(bodySpec.raw, ctx, vault, unresolvedSet, resolvedSecrets);
      bodyBuffer = Buffer.from(interpolatedBody, 'utf-8');
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'text/plain; charset=utf-8';
      }
    } else if (bodySpec.mode === 'urlencoded' && Array.isArray(bodySpec.urlencoded)) {
      const searchParams = new URLSearchParams();
      for (const item of bodySpec.urlencoded) {
        if (!item || !item.enabled || !item.key) continue;
        const k = VariableResolver.interpolate(item.key, ctx, vault, unresolvedSet, resolvedSecrets);
        const v = VariableResolver.interpolate(item.value || '', ctx, vault, unresolvedSet, resolvedSecrets);
        searchParams.append(k, v);
      }
      bodyBuffer = Buffer.from(searchParams.toString(), 'utf-8');
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
      }
    } else if (bodySpec.mode === 'multipart' && Array.isArray(bodySpec.multipart)) {
      const interpolatedFields = bodySpec.multipart.map((f) => ({
        ...f,
        key: VariableResolver.interpolate(f.key || '', ctx, vault, unresolvedSet, resolvedSecrets),
        value: VariableResolver.interpolate(f.value || '', ctx, vault, unresolvedSet, resolvedSecrets),
      }));
      const mp = buildMultipartBuffer(interpolatedFields);
      bodyBuffer = mp.buffer;
      headers['Content-Type'] = mp.contentType;
    }
  }

  const settings = {
    timeoutMs: 15000,
    followRedirects: true,
    maxRedirects: 5,
    verifyTls: true,
    maxResponseBytes: 10 * 1024 * 1024,
    allowPrivateNetworkRedirects: false,
    ...(requestSpec.settings || {}),
  };

  const abortController = new AbortController();
  const reqId = requestSpec.id || `req_${crypto.randomUUID()}`;
  registerActiveRequest(reqId, abortController);

  const redirects = [];
  let currentUrl = targetUrl;
  let currentMethod = method;
  let currentHeaders = { ...headers };
  let currentBody = bodyBuffer;
  let hopCount = 0;

  try {
    while (true) {
      const singleHopResult = await performSingleHttpHop({
        url: currentUrl,
        method: currentMethod,
        headers: currentHeaders,
        bodyBuffer: currentBody,
        timeoutMs: settings.timeoutMs,
        verifyTls: settings.verifyTls,
        maxResponseBytes: settings.maxResponseBytes,
        signal: abortController.signal,
      });

      const status = singleHopResult.status;
      const isRedirectStatus = [301, 302, 303, 307, 308].includes(status);
      const locationHeader = singleHopResult.headers['location'];

      if (isRedirectStatus && settings.followRedirects && locationHeader) {
        hopCount += 1;
        if (hopCount > settings.maxRedirects) {
          return {
            requestId: reqId,
            status,
            statusText: singleHopResult.statusText,
            durationMs: Math.round(performance.now() - startTime),
            sizeBytes: 0,
            headers: singleHopResult.headers,
            cookies: singleHopResult.cookies,
            body: '',
            isJson: false,
            truncated: false,
            redirects,
            unresolvedVariables: Array.from(unresolvedSet),
            assertionResults: [],
            extractedVariables: {},
            timestamp,
            error: {
              code: 'MAX_REDIRECTS_EXCEEDED',
              message: `Límite máximo de redirecciones excedido (${settings.maxRedirects}).`,
              details: `Última ubicación: ${locationHeader}`,
              recoverable: true,
            },
          };
        }

        let nextUrl;
        try {
          nextUrl = new URL(locationHeader, currentUrl);
        } catch {
          return {
            requestId: reqId,
            status,
            statusText: 'Invalid Redirect URL',
            durationMs: Math.round(performance.now() - startTime),
            sizeBytes: 0,
            headers: singleHopResult.headers,
            cookies: singleHopResult.cookies,
            body: '',
            isJson: false,
            truncated: false,
            redirects,
            unresolvedVariables: Array.from(unresolvedSet),
            assertionResults: [],
            extractedVariables: {},
            timestamp,
            error: {
              code: 'INVALID_URL',
              message: `Destino de redirección inválido: ${locationHeader}`,
              recoverable: true,
            },
          };
        }

        const redirectCheck = UrlSecurityValidator.validateRedirect(
          currentUrl,
          nextUrl,
          Boolean(settings.allowPrivateNetworkRedirects)
        );

        if (!redirectCheck.ok) {
          return {
            requestId: reqId,
            status,
            statusText: 'Redirect Blocked',
            durationMs: Math.round(performance.now() - startTime),
            sizeBytes: 0,
            headers: singleHopResult.headers,
            cookies: singleHopResult.cookies,
            body: '',
            isJson: false,
            truncated: false,
            redirects,
            unresolvedVariables: Array.from(unresolvedSet),
            assertionResults: [],
            extractedVariables: {},
            timestamp,
            error: redirectCheck.error,
          };
        }

        const stripped = [];
        if (redirectCheck.crossOrigin) {
          for (const hKey of Object.keys(currentHeaders)) {
            if (
              SecretRedactor.isSensitiveHeaderName(hKey) ||
              resolvedSecrets.some((sec) => sec && String(currentHeaders[hKey]).includes(sec))
            ) {
              stripped.push(hKey.toLowerCase());
              delete currentHeaders[hKey];
            }
          }
        }

        redirects.push({
          hop: hopCount,
          fromUrl: currentUrl.href,
          toUrl: nextUrl.href,
          status,
          crossOrigin: redirectCheck.crossOrigin,
          strippedHeaders: stripped,
        });

        if (status === 303 || ((status === 301 || status === 302) && currentMethod === 'POST')) {
          currentMethod = 'GET';
          currentBody = null;
          delete currentHeaders['Content-Type'];
          delete currentHeaders['content-type'];
          delete currentHeaders['Content-Length'];
          delete currentHeaders['content-length'];
        }

        currentUrl = nextUrl;
        continue;
      }

      const durationMs = Math.max(1, Math.round(performance.now() - startTime));
      const contentType = String(singleHopResult.headers['content-type'] || '').toLowerCase();
      let isJson = contentType.includes('application/json') || contentType.includes('+json');
      if (!isJson && singleHopResult.body.trim().startsWith('{')) {
        try {
          JSON.parse(singleHopResult.body);
          isJson = true;
        } catch {
          isJson = false;
        }
      }

      const responseData = {
        requestId: reqId,
        status: singleHopResult.status,
        statusText: singleHopResult.statusText,
        durationMs,
        sizeBytes: singleHopResult.sizeBytes,
        headers: singleHopResult.headers,
        cookies: singleHopResult.cookies,
        body: singleHopResult.body,
        isJson,
        truncated: singleHopResult.truncated,
        redirects,
        unresolvedVariables: Array.from(unresolvedSet),
        assertionResults: [],
        extractedVariables: {},
        timestamp,
        error: null,
      };

      responseData.assertionResults = AssertionEvaluator.evaluateAll(
        requestSpec.assertions || [],
        responseData
      );
      responseData.extractedVariables = AssertionEvaluator.extractVariables(
        requestSpec.extractions || [],
        responseData
      );

      return responseData;
    }
  } catch (err) {
    const durationMs = Math.max(1, Math.round(performance.now() - startTime));
    return {
      requestId: reqId,
      status: 0,
      statusText: err.code || 'Error',
      durationMs,
      sizeBytes: 0,
      headers: {},
      cookies: [],
      body: '',
      isJson: false,
      truncated: false,
      redirects,
      unresolvedVariables: Array.from(unresolvedSet),
      assertionResults: [],
      extractedVariables: {},
      timestamp,
      error: err.structuredError || {
        code: 'NETWORK_ERROR',
        message: err.message || 'Error de transporte HTTP',
        recoverable: true,
      },
    };
  } finally {
    activeRequests.delete(reqId);
  }
}
