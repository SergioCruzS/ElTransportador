/**
 * ElTransportador Core Engine (`scripts/core-engine.mjs`)
 * Implementación funcional completa de:
 * - Motor HTTP nativo con control de redirecciones paso a paso, timeouts, cancelación, streaming con límite de memoria,
 *   cookies, multipart/form-data, application/x-www-form-urlencoded, JSON, texto y autenticación (Bearer, Basic, API Key).
 * - Validador de Seguridad de Red (bloqueo de esquemas peligrosos, protección anti-SSRF cross-zone y eliminación de
 *   credenciales en redirecciones cross-origin).
 * - Bóveda de Secretos cifrada con AES-256-GCM + Redactor automático de credenciales (`SecretRedactor`).
 * - Interpolador determinista de variables (`${variable}` y `${secret:clave}`) con precedencia de 4 niveles.
 * - Almacenamiento atómico de colecciones (`eltransportador.collection/v1`) con recuperación `.bak` y migración de esquema.
 * - Repositorio de historial en SQLite real (`sqlite3`) con límites de retención y sanitización previa.
 * - Evaluador de aserciones, encadenamiento de solicitudes (Request Flows) e importadores/exportadores (ETP v1, OpenAPI 3, cURL).
 */

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { URL } from 'node:url';

export const CURRENT_SCHEMA_VERSION = 1;
export const SCHEMA_URI = 'https://eltransportador.dev/schemas/collection-v1.json';
export const ENV_PREFIX = 'ELTRANSPORTADOR_';
export const REDACTED_PLACEHOLDER = '[REDACTED:ELTRANSPORTADOR_SECRET]';

// Registro de solicitudes en curso para soporte de cancelación inmediata
const activeRequests = new Map();

export function registerActiveRequest(requestId, controller) {
  activeRequests.set(requestId, controller);
}

export function cancelActiveRequest(requestId) {
  const ctrl = activeRequests.get(requestId);
  if (ctrl) {
    ctrl.abort(new Error('CANCELLED_BY_USER'));
    activeRequests.delete(requestId);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1. Seguridad: Redacción de Secretos (`SecretRedactor`)
// ---------------------------------------------------------------------------
export class SecretRedactor {
  constructor(knownSecrets = []) {
    this.knownSecrets = knownSecrets
      .filter((s) => typeof s === 'string' && s.trim().length >= 4)
      .sort((a, b) => b.length - a.length);
  }

  static isSensitiveHeaderName(name) {
    const lower = String(name || '').trim().toLowerCase();
    return [
      'authorization',
      'proxy-authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'api-key',
      'x-auth-token',
      'x-secret-key',
    ].includes(lower);
  }

  static isSensitiveParamName(name) {
    const lower = String(name || '').trim().toLowerCase();
    return (
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('api_key') ||
      lower.includes('apikey')
    );
  }

  redactText(input) {
    if (typeof input !== 'string' || !input) return '';
    let out = input;
    for (const secret of this.knownSecrets) {
      if (secret && out.includes(secret)) {
        out = out.split(secret).join(REDACTED_PLACEHOLDER);
      }
    }
    out = out.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, `$1${REDACTED_PLACEHOLDER}`);
    out = out.replace(/(Basic\s+)[A-Za-z0-9+/]+=*/gi, `$1${REDACTED_PLACEHOLDER}`);
    out = out.replace(/(https?:\/\/[^/:@\s]+:)([^@\s]+)(@)/gi, `$1${REDACTED_PLACEHOLDER}$3`);
    return out;
  }

  sanitizeRequestForHistory(req) {
    const clone = JSON.parse(JSON.stringify(req));
    clone.url = this.redactText(clone.url || '');
    if (Array.isArray(clone.headers)) {
      clone.headers = clone.headers.map((h) => ({
        ...h,
        value:
          h.isSecret || SecretRedactor.isSensitiveHeaderName(h.key)
            ? REDACTED_PLACEHOLDER
            : this.redactText(h.value || ''),
      }));
    }
    if (Array.isArray(clone.params)) {
      clone.params = clone.params.map((p) => ({
        ...p,
        value:
          p.isSecret || SecretRedactor.isSensitiveParamName(p.key)
            ? REDACTED_PLACEHOLDER
            : this.redactText(p.value || ''),
      }));
    }
    if (clone.auth) {
      if (clone.auth.bearerToken) clone.auth.bearerToken = REDACTED_PLACEHOLDER;
      if (clone.auth.basicPassword) clone.auth.basicPassword = REDACTED_PLACEHOLDER;
      if (clone.auth.apiKeyValue) clone.auth.apiKeyValue = REDACTED_PLACEHOLDER;
    }
    if (clone.body && typeof clone.body.raw === 'string') {
      clone.body.raw = this.redactText(clone.body.raw);
    }
    return clone;
  }
}

// ---------------------------------------------------------------------------
// 2. Seguridad: Bóveda de Secretos Cifrada AES-256-GCM (`SecretVault`)
// ---------------------------------------------------------------------------
export class SecretVault {
  constructor(storageDir) {
    this.storageDir = storageDir;
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.vaultFile = path.join(this.storageDir, 'vault.enc.json');
    const machineSeed = process.env.ELTRANSPORTADOR_MASTER_KEY || 'eltransportador-local-os-key-v1';
    this.key = crypto.scryptSync(machineSeed, 'com.eltransportador.desktop.salt', 32);
    this.cache = new Map();
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.vaultFile)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.vaultFile, 'utf-8'));
      const iv = Buffer.from(raw.iv, 'base64');
      const tag = Buffer.from(raw.tag, 'base64');
      const encrypted = Buffer.from(raw.ciphertext, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
      const entries = JSON.parse(decrypted);
      for (const [k, v] of Object.entries(entries)) {
        this.cache.set(k, String(v));
      }
    } catch {
      this.cache.clear();
    }
  }

  _persist() {
    const plainObj = Object.fromEntries(this.cache.entries());
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(plainObj), 'utf-8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const payload = {
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    const tmpFile = `${this.vaultFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmpFile, this.vaultFile);
  }

  setSecret(key, value) {
    if (!key || typeof key !== 'string') throw new Error('Nombre de secreto inválido');
    this.cache.set(key.trim(), String(value));
    this._persist();
  }

  getSecret(key) {
    return this.cache.get(String(key || '').trim()) ?? null;
  }

  deleteSecret(key) {
    const existed = this.cache.delete(String(key || '').trim());
    this._persist();
    return existed;
  }

  listSecretKeys() {
    return Array.from(this.cache.keys());
  }

  getAllSecretValuesForRedaction() {
    return Array.from(this.cache.values());
  }
}

// ---------------------------------------------------------------------------
// 3. Seguridad de Red y Validación Anti-SSRF (`UrlSecurityValidator`)
// ---------------------------------------------------------------------------
export class UrlSecurityValidator {
  static validateRequestUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) {
      return {
        ok: false,
        error: {
          code: 'INVALID_URL',
          message: 'La URL de la solicitud no puede estar vacía.',
          recoverable: true,
        },
      };
    }
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'INVALID_URL',
          message: `URL malformada: ${trimmed}`,
          details: err.message,
          recoverable: true,
        },
      };
    }
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return {
        ok: false,
        error: {
          code: 'BLOCKED_SCHEME',
          message: `Esquema de protocolo bloqueado por seguridad (${protocol}). Solo se permite http: y https:.`,
          details: `Protocolo rechazado: ${protocol}`,
          recoverable: true,
        },
      };
    }
    if (!parsed.hostname) {
      return {
        ok: false,
        error: {
          code: 'INVALID_URL',
          message: 'La URL no contiene un nombre de host válido.',
          recoverable: true,
        },
      };
    }
    return { ok: true, url: parsed };
  }

  static isSameOrigin(urlA, urlB) {
    const portA = urlA.port || (urlA.protocol === 'https:' ? '443' : '80');
    const portB = urlB.port || (urlB.protocol === 'https:' ? '443' : '80');
    return (
      urlA.protocol.toLowerCase() === urlB.protocol.toLowerCase() &&
      urlA.hostname.toLowerCase() === urlB.hostname.toLowerCase() &&
      portA === portB
    );
  }

  static isPrivateOrMetadataHost(hostname) {
    const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (
      h === 'localhost' ||
      h.endsWith('.local') ||
      h.endsWith('.internal') ||
      h === 'metadata.google.internal' ||
      h === '::1' ||
      h === '0.0.0.0'
    ) {
      return true;
    }
    const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [_, a, b] = ipv4Match.map(Number);
      if (a === 127) return true;
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
    }
    return false;
  }

  static validateRedirect(fromUrl, toUrl, allowPrivateNetworkRedirects = false) {
    const check = UrlSecurityValidator.validateRequestUrl(toUrl.toString());
    if (!check.ok) return check;

    const fromPrivate = UrlSecurityValidator.isPrivateOrMetadataHost(fromUrl.hostname);
    const toPrivate = UrlSecurityValidator.isPrivateOrMetadataHost(toUrl.hostname);

    const isCloudMetadata =
      toUrl.hostname === '169.254.169.254' || toUrl.hostname === 'metadata.google.internal';
    if (!allowPrivateNetworkRedirects && (isCloudMetadata || (!fromPrivate && toPrivate))) {
      return {
        ok: false,
        error: {
          code: 'SSRF_REDIRECT_BLOCKED',
          message: `Redirección bloqueada por protección anti-SSRF hacia destino interno o metadata (${toUrl.hostname}).`,
          details: `Origen: ${fromUrl.origin} -> Destino bloqueado: ${toUrl.href}`,
          recoverable: true,
        },
      };
    }

    const crossOrigin = !UrlSecurityValidator.isSameOrigin(fromUrl, toUrl);
    return {
      ok: true,
      crossOrigin,
      strippedHeaders: crossOrigin
        ? ['authorization', 'cookie', 'proxy-authorization', 'x-api-key']
        : [],
    };
  }
}

// ---------------------------------------------------------------------------
// 4. Interpolación de Variables con Precedencia Determinista (`VariableResolver`)
// ---------------------------------------------------------------------------
export class VariableResolver {
  static buildContext({
    runtimeVars = {},
    environmentVars = {},
    collectionVars = {},
    globalEnv = process.env,
  } = {}) {
    const globalEnvVars = {};
    for (const [k, v] of Object.entries(globalEnv || {})) {
      if (k.startsWith(ENV_PREFIX) && typeof v === 'string') {
        globalEnvVars[k.slice(ENV_PREFIX.length)] = v;
      }
    }
    return { runtimeVars, environmentVars, collectionVars, globalEnvVars };
  }

  static resolveValue(key, ctx) {
    if (Object.prototype.hasOwnProperty.call(ctx.runtimeVars, key)) return ctx.runtimeVars[key];
    if (Object.prototype.hasOwnProperty.call(ctx.environmentVars, key)) return ctx.environmentVars[key];
    if (Object.prototype.hasOwnProperty.call(ctx.collectionVars, key)) return ctx.collectionVars[key];
    if (Object.prototype.hasOwnProperty.call(ctx.globalEnvVars, key)) return ctx.globalEnvVars[key];
    return undefined;
  }

  static interpolate(input, ctx, vault, unresolvedSet = new Set(), resolvedSecrets = []) {
    if (typeof input !== 'string' || !input) return '';
    return input.replace(/\$\{\s*(secret:)?([a-zA-Z0-9_.\-]+)\s*\}/g, (fullMatch, secretPrefix, varName) => {
      if (secretPrefix) {
        const secretVal = vault ? vault.getSecret(varName) : null;
        if (secretVal !== null && secretVal !== undefined) {
          resolvedSecrets.push(secretVal);
          return secretVal;
        }
        unresolvedSet.add(`secret:${varName}`);
        return fullMatch;
      }
      const val = VariableResolver.resolveValue(varName, ctx);
      if (val !== undefined) {
        return String(val);
      }
      unresolvedSet.add(varName);
      return fullMatch;
    });
  }
}

// ---------------------------------------------------------------------------
// 5. Evaluador de Aserciones y Extracción de Variables (`AssertionEvaluator`)
// ---------------------------------------------------------------------------
export class AssertionEvaluator {
  static getJsonPath(obj, pathStr) {
    if (!obj || typeof obj !== 'object' || !pathStr) return undefined;
    const segments = String(pathStr)
      .split('.')
      .map((s) => s.trim())
      .filter(Boolean);
    let cur = obj;
    for (const seg of segments) {
      if (cur === null || cur === undefined) return undefined;
      if (Array.isArray(cur)) {
        const idx = Number(seg);
        if (Number.isNaN(idx)) return undefined;
        cur = cur[idx];
      } else if (typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, seg)) {
        cur = cur[seg];
      } else {
        return undefined;
      }
    }
    return cur;
  }

  static detectType(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (Array.isArray(val)) return 'array';
    return typeof val;
  }

  static evaluateAll(rules = [], response) {
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(response.body);
    } catch {
      parsedJson = null;
    }

    const results = [];
    for (const rule of rules) {
      if (!rule || !rule.enabled) continue;
      let actualVal = undefined;
      let actualType = 'undefined';

      if (rule.target === 'status') {
        actualVal = response.status;
        actualType = 'number';
      } else if (rule.target === 'duration_ms') {
        actualVal = response.durationMs;
        actualType = 'number';
      } else if (rule.target === 'body_text') {
        actualVal = response.body;
        actualType = 'string';
      } else if (rule.target === 'header') {
        const targetHeader = String(rule.property || '').toLowerCase();
        const entry = Object.entries(response.headers || {}).find(
          ([k]) => k.toLowerCase() === targetHeader
        );
        if (entry) {
          actualVal = entry[1];
          actualType = 'string';
        }
      } else if (rule.target === 'json_path') {
        if (parsedJson !== null) {
          actualVal = AssertionEvaluator.getJsonPath(parsedJson, rule.property || '');
          actualType = AssertionEvaluator.detectType(actualVal);
        } else {
          actualType = 'invalid_json';
        }
      }

      const actualStr =
        actualVal === undefined
          ? '<undefined>'
          : typeof actualVal === 'object'
          ? JSON.stringify(actualVal)
          : String(actualVal);

      let passed = false;
      const expectedStr = String(rule.expected ?? '');

      switch (rule.operator) {
        case 'exists':
          passed = actualVal !== undefined && actualVal !== null;
          break;
        case 'not_exists':
          passed = actualVal === undefined || actualVal === null;
          break;
        case 'equals':
          passed = actualStr === expectedStr;
          break;
        case 'not_equals':
          passed = actualStr !== expectedStr;
          break;
        case 'contains':
          passed = actualVal !== undefined && actualStr.includes(expectedStr);
          break;
        case 'less_than':
          passed = Number(actualVal) < Number(expectedStr);
          break;
        case 'greater_than':
          passed = Number(actualVal) > Number(expectedStr);
          break;
        case 'is_type':
          passed = actualType.toLowerCase() === expectedStr.toLowerCase();
          break;
        default:
          passed = false;
      }

      results.push({
        ruleId: rule.id,
        passed,
        target: rule.target,
        property: rule.property,
        operator: rule.operator,
        expected: expectedStr,
        actual: actualStr,
        message: passed
          ? `OK: ${rule.target}${rule.property ? ` (${rule.property})` : ''} ${rule.operator} ${expectedStr}`
          : `Fallo en ${rule.target}${rule.property ? ` (${rule.property})` : ''}: esperado [${rule.operator} '${expectedStr}'], obtenido '${actualStr}'`,
      });
    }

    return results;
  }

  static extractVariables(extractions = [], response) {
    const extracted = {};
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(response.body);
    } catch {
      parsedJson = null;
    }

    for (const ext of extractions) {
      if (!ext || !ext.enabled || !ext.variableName) continue;
      if (ext.source === 'status') {
        extracted[ext.variableName] = String(response.status);
      } else if (ext.source === 'header') {
        const entry = Object.entries(response.headers || {}).find(
          ([k]) => k.toLowerCase() === String(ext.path || '').toLowerCase()
        );
        if (entry) extracted[ext.variableName] = String(entry[1]);
      } else if (ext.source === 'json_path' && parsedJson !== null) {
        const val = AssertionEvaluator.getJsonPath(parsedJson, ext.path || '');
        if (val !== undefined && val !== null) {
          extracted[ext.variableName] = typeof val === 'object' ? JSON.stringify(val) : String(val);
        }
      }
    }
    return extracted;
  }
}

// ---------------------------------------------------------------------------
// 6. Motor HTTP Nativo (`executeHttpRequest`)
// ---------------------------------------------------------------------------
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

function performSingleHttpHop({
  url,
  method,
  headers,
  bodyBuffer,
  timeoutMs,
  verifyTls,
  maxResponseBytes,
  signal,
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error('Solicitud cancelada por el usuario');
      e.structuredError = { code: 'CANCELLED', message: e.message, recoverable: true };
      return reject(e);
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const reqHeaders = { ...headers };
    if (bodyBuffer) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyBuffer);
    }

    const reqOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: reqHeaders,
      rejectUnauthorized: Boolean(verifyTls),
    };

    let timer = null;
    const req = transport.request(reqOptions, (res) => {
      const chunks = [];
      let totalBytes = 0;
      let truncated = false;

      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes <= maxResponseBytes) {
          chunks.push(chunk);
        } else {
          truncated = true;
          const allowed = chunk.length - (totalBytes - maxResponseBytes);
          if (allowed > 0) {
            chunks.push(chunk.subarray(0, allowed));
          }
          res.destroy();
        }
      });

      const finalize = () => {
        if (timer) clearTimeout(timer);
        const fullBuffer = Buffer.concat(chunks);
        const normalizedHeaders = {};
        for (const [k, v] of Object.entries(res.headers || {})) {
          if (k.toLowerCase() === 'set-cookie') continue;
          normalizedHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
        }
        const cookies = parseSetCookieHeader(res.headers['set-cookie']);
        resolve({
          status: res.statusCode || 200,
          statusText: res.statusMessage || 'OK',
          headers: normalizedHeaders,
          cookies,
          body: method === 'HEAD' ? '' : fullBuffer.toString('utf-8'),
          sizeBytes: totalBytes,
          truncated,
        });
      };

      res.on('end', finalize);
      res.on('close', () => {
        if (truncated) finalize();
      });
      res.on('error', (err) => {
        if (truncated) return finalize();
        if (timer) clearTimeout(timer);
        const e = new Error(err.message);
        e.structuredError = {
          code: 'NETWORK_ERROR',
          message: `Error leyendo flujo de respuesta: ${err.message}`,
          recoverable: true,
        };
        reject(e);
      });
    });

    const onAbort = () => {
      if (timer) clearTimeout(timer);
      req.destroy();
      const e = new Error('Solicitud cancelada por el usuario');
      e.structuredError = { code: 'CANCELLED', message: e.message, recoverable: true };
      reject(e);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      req.destroy();
      const e = new Error(`Tiempo de espera agotado tras ${timeoutMs} ms`);
      e.structuredError = {
        code: 'TIMEOUT',
        message: `La solicitud excedió el límite de tiempo configurado (${timeoutMs} ms).`,
        recoverable: true,
      };
      reject(e);
    }, timeoutMs);

    req.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (signal?.aborted) return;
      const isTls =
        String(err.code || '').includes('CERT') ||
        String(err.code || '').includes('SSL') ||
        String(err.message || '').toLowerCase().includes('certificate');
      const e = new Error(err.message);
      e.structuredError = {
        code: isTls ? 'TLS_ERROR' : 'NETWORK_ERROR',
        message: isTls
          ? `Error de verificación TLS/Certificado: ${err.message}`
          : `Error de conexión HTTP: ${err.message}`,
        details: err.code || err.message,
        recoverable: true,
      };
      reject(e);
    });

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 7. Persistencia Atómica de Colecciones y Migración (`CollectionStorage`)
// ---------------------------------------------------------------------------
export class CollectionStorage {
  constructor(collectionsDir) {
    this.collectionsDir = collectionsDir;
    fs.mkdirSync(this.collectionsDir, { recursive: true });
  }

  static sanitizeFileName(name) {
    const raw = String(name || '').trim();
    if (!raw || raw.includes('..') || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) {
      throw new Error('Ruta o nombre de archivo no permitido por política de aislamiento de filesystem.');
    }
    return raw.endsWith('.etp.json') ? raw : `${raw}.etp.json`;
  }

  static migrateAndValidate(rawObj) {
    if (!rawObj || typeof rawObj !== 'object') {
      throw new Error('El contenido de la colección no es un objeto JSON válido.');
    }
    const migrated = JSON.parse(JSON.stringify(rawObj));

    if (!migrated.schemaVersion || migrated.schemaVersion === 0) {
      migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
      migrated.$schema = SCHEMA_URI;
      migrated.kind = 'eltransportador.collection';
      migrated.defaults = migrated.defaults || {
        timeoutMs: 10000,
        followRedirects: true,
        maxRedirects: 5,
        verifyTls: true,
        headers: [],
      };
    }

    if (migrated.kind !== 'eltransportador.collection') {
      throw new Error(`Tipo de documento inválido: '${migrated.kind}'. Se esperaba 'eltransportador.collection'.`);
    }
    if (migrated.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Versión de esquema (${migrated.schemaVersion}) no soportada por esta versión (máx v${CURRENT_SCHEMA_VERSION}).`
      );
    }
    if (!migrated.metadata || !migrated.metadata.id || !migrated.metadata.name) {
      throw new Error('La colección carece de metadatos obligatorios (metadata.id, metadata.name).');
    }

    migrated.variables = Array.isArray(migrated.variables) ? migrated.variables : [];
    migrated.folders = Array.isArray(migrated.folders) ? migrated.folders : [];
    migrated.requests = Array.isArray(migrated.requests) ? migrated.requests : [];

    for (const v of migrated.variables) {
      if (v.isSecret) {
        v.secretRef = v.secretRef || v.key;
        v.value = '';
      }
    }

    return migrated;
  }

  saveCollection(fileName, collectionObj) {
    const safeName = CollectionStorage.sanitizeFileName(fileName);
    const validated = CollectionStorage.migrateAndValidate(collectionObj);
    validated.metadata.updatedAt = new Date().toISOString();

    const fullPath = path.join(this.collectionsDir, safeName);
    const tmpPath = `${fullPath}.tmp.${process.pid}`;
    const bakPath = `${fullPath}.bak`;

    const serialized = JSON.stringify(validated, null, 2) + '\n';
    const fd = fs.openSync(tmpPath, 'w', 0o644);
    fs.writeFileSync(fd, serialized, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    if (fs.existsSync(fullPath)) {
      fs.copyFileSync(fullPath, bakPath);
    }
    fs.renameSync(tmpPath, fullPath);
    return { path: fullPath, collection: validated };
  }

  loadCollection(fileName) {
    const safeName = CollectionStorage.sanitizeFileName(fileName);
    const fullPath = path.join(this.collectionsDir, safeName);
    const bakPath = `${fullPath}.bak`;

    const tryParse = (target) => {
      const content = fs.readFileSync(target, 'utf-8');
      const obj = JSON.parse(content);
      return CollectionStorage.migrateAndValidate(obj);
    };

    try {
      return { recoveredFromBackup: false, collection: tryParse(fullPath) };
    } catch (primaryErr) {
      if (fs.existsSync(bakPath)) {
        return { recoveredFromBackup: true, collection: tryParse(bakPath) };
      }
      throw primaryErr;
    }
  }

  listCollections() {
    if (!fs.existsSync(this.collectionsDir)) return [];
    const files = fs
      .readdirSync(this.collectionsDir)
      .filter((f) => f.endsWith('.etp.json') && !f.includes('.tmp.'));
    const results = [];
    for (const f of files) {
      try {
        const loaded = this.loadCollection(f);
        results.push({ fileName: f, ...loaded });
      } catch {
        // Ignorar archivos corruptos sin respaldo válido en el listado general
      }
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// 8. Repositorio de Historial en SQLite (`SqliteHistoryRepository`)
// ---------------------------------------------------------------------------
export class SqliteHistoryRepository {
  constructor(dbPath, maxEntries = 200) {
    this.dbPath = dbPath;
    this.maxEntries = maxEntries;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this._initDb();
  }

  _runPythonSqlite(operation, payload = {}) {
    const pyLines = [
      'import sys, json, sqlite3',
      'db_path = sys.argv[1]',
      'op = sys.argv[2]',
      'payload = json.loads(sys.argv[3])',
      'conn = sqlite3.connect(db_path)',
      'conn.row_factory = sqlite3.Row',
      'cur = conn.cursor()',
      'if op == "init":',
      '    cur.execute("CREATE TABLE IF NOT EXISTS request_history (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL, status INTEGER NOT NULL, duration_ms INTEGER NOT NULL, size_bytes INTEGER NOT NULL, timestamp TEXT NOT NULL, request_snapshot_json TEXT NOT NULL)")',
      '    cur.execute("CREATE INDEX IF NOT EXISTS idx_history_timestamp ON request_history(timestamp DESC)")',
      '    conn.commit()',
      '    print(json.dumps({"ok": True}))',
      'elif op == "insert":',
      '    cur.execute("INSERT OR REPLACE INTO request_history (id, request_id, method, url, status, duration_ms, size_bytes, timestamp, request_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (payload["id"], payload["requestId"], payload["method"], payload["url"], payload["status"], payload["durationMs"], payload["sizeBytes"], payload["timestamp"], json.dumps(payload["requestSnapshot"], ensure_ascii=False)))',
      '    cur.execute("DELETE FROM request_history WHERE id NOT IN (SELECT id FROM request_history ORDER BY timestamp DESC LIMIT ?)", (int(payload.get("maxEntries", 200)),))',
      '    conn.commit()',
      '    print(json.dumps({"ok": True}))',
      'elif op == "list":',
      '    cur.execute("SELECT * FROM request_history ORDER BY timestamp DESC LIMIT ?", (int(payload.get("limit", 100)),))',
      '    rows = [{"id": r["id"], "requestId": r["request_id"], "method": r["method"], "url": r["url"], "status": r["status"], "durationMs": r["duration_ms"], "sizeBytes": r["size_bytes"], "timestamp": r["timestamp"], "requestSnapshot": json.loads(r["request_snapshot_json"])} for r in cur.fetchall()]',
      '    print(json.dumps(rows))',
      'elif op == "clear":',
      '    cur.execute("DELETE FROM request_history")',
      '    conn.commit()',
      '    print(json.dumps({"ok": True}))',
      'conn.close()',
    ];
    for (const pyBin of ['python3', 'python']) {
      const proc = spawnSync(
        pyBin,
        ['-c', pyLines.join('\n'), this.dbPath, operation, JSON.stringify(payload)],
        { encoding: 'utf-8' }
      );
      if (proc && proc.status === 0 && proc.stdout) {
        return JSON.parse(proc.stdout.trim());
      }
    }
    // Fallback automático en JSON si Python no está instalado en el sistema Windows
    const fbFile = this.dbPath + '.json';
    let items = [];
    if (fs.existsSync(fbFile)) {
      try { items = JSON.parse(fs.readFileSync(fbFile, 'utf-8')); } catch { items = []; }
    }
    if (operation === 'init') return { ok: true };
    if (operation === 'clear') {
      fs.writeFileSync(fbFile, '[]', 'utf-8');
      return { ok: true };
    }
    if (operation === 'insert') {
      items.unshift({
        id: payload.id,
        requestId: payload.requestId,
        method: payload.method,
        url: payload.url,
        status: payload.status,
        durationMs: payload.durationMs,
        sizeBytes: payload.sizeBytes,
        timestamp: payload.timestamp,
        requestSnapshot: payload.requestSnapshot
      });
      items = items.slice(0, Number(payload.maxEntries || 200));
      fs.writeFileSync(fbFile, JSON.stringify(items, null, 2), 'utf-8');
      return { ok: true };
    }
    if (operation === 'list') {
      return items.slice(0, Number(payload.limit || 100));
    }
    return { ok: true };
  }

  _initDb() {
    this._runPythonSqlite('init');
  }

  recordExecution(reqSpec, respData, redactor) {
    const sanitizedReq = redactor.sanitizeRequestForHistory(reqSpec);
    const sanitizedUrl = redactor.redactText(reqSpec.url || '');
    const entry = {
      id: `hst_${crypto.randomUUID()}`,
      requestId: reqSpec.id || 'req_adhoc',
      method: reqSpec.method || 'GET',
      url: sanitizedUrl,
      status: respData.status || 0,
      durationMs: respData.durationMs || 0,
      sizeBytes: respData.sizeBytes || 0,
      timestamp: respData.timestamp || new Date().toISOString(),
      requestSnapshot: sanitizedReq,
      maxEntries: this.maxEntries,
    };
    this._runPythonSqlite('insert', entry);
    return entry;
  }

  listEntries(limit = 100) {
    return this._runPythonSqlite('list', { limit });
  }

  clearHistory() {
    return this._runPythonSqlite('clear');
  }
}

// ---------------------------------------------------------------------------
// 9. Importadores (ETP v1 y OpenAPI 3.x) y Generador cURL (`ImportExportService`)
// ---------------------------------------------------------------------------
export class ImportExportService {
  static importData(rawJsonString) {
    if (typeof rawJsonString !== 'string' || rawJsonString.length > 5 * 1024 * 1024) {
      throw new Error('El archivo de importación excede el tamaño máximo permitido (5 MB) o es inválido.');
    }
    const parsed = JSON.parse(rawJsonString);

    if (parsed.kind === 'eltransportador.collection') {
      const discarded = [];
      for (const req of parsed.requests || []) {
        if (req.script || req.preRequestScript || req.postResponseScript) {
          delete req.script;
          delete req.preRequestScript;
          delete req.postResponseScript;
          discarded.push(`requests[${req.name}].scripts (bloqueado por política de seguridad)`);
        }
      }
      const validated = CollectionStorage.migrateAndValidate(parsed);
      return {
        sourceFormat: 'eltransportador.v1',
        collection: validated,
        preservedFields: ['metadata', 'defaults', 'variables', 'folders', 'requests', 'assertions'],
        transformedFields: parsed.schemaVersion === 0 ? ['schemaVersion (0 -> 1)'] : [],
        discardedFields: discarded,
        warnings: discarded.length > 0 ? ['Se descartaron scripts importados por seguridad.'] : [],
      };
    }

    if (typeof parsed.openapi === 'string' && parsed.openapi.startsWith('3.')) {
      const baseUrl =
        Array.isArray(parsed.servers) && parsed.servers[0]?.url
          ? parsed.servers[0].url
          : 'http://localhost:8080';
      const requests = [];
      const discardedFields = [];

      for (const k of Object.keys(parsed)) {
        if (k.startsWith('x-')) {
          discardedFields.push(k);
        }
      }

      for (const [routePath, pathItem] of Object.entries(parsed.paths || {})) {
        for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
          if (!pathItem[method]) continue;
          const op = pathItem[method];
          const params = [];
          for (const p of op.parameters || []) {
            if (p.in === 'query') {
              params.push({
                id: `prm_${crypto.randomUUID().slice(0, 8)}`,
                key: p.name,
                value: p.schema?.default !== undefined ? String(p.schema.default) : '',
                description: p.description || '',
                enabled: true,
              });
            }
          }
          let body = { mode: 'none' };
          const jsonExample = op.requestBody?.content?.['application/json']?.example;
          if (jsonExample !== undefined) {
            body = {
              mode: 'json',
              raw: JSON.stringify(jsonExample, null, 2),
            };
          }

          requests.push({
            id: `req_${op.operationId || crypto.randomUUID().slice(0, 8)}`,
            name: op.summary || `${method.toUpperCase()} ${routePath}`,
            folderId: null,
            method: method.toUpperCase(),
            url: `\${base_url}${routePath}`,
            params,
            headers: [
              { id: 'hdr_accept', key: 'Accept', value: 'application/json', enabled: true },
            ],
            auth: { type: 'none' },
            body,
            settings: {
              timeoutMs: 10000,
              followRedirects: true,
              maxRedirects: 5,
              verifyTls: true,
              maxResponseBytes: 5242880,
            },
            assertions: [
              {
                id: `ast_${crypto.randomUUID().slice(0, 8)}`,
                enabled: true,
                target: 'status',
                operator: 'less_than',
                expected: '400',
              },
            ],
            extractions: [],
          });
        }
      }

      const collection = CollectionStorage.migrateAndValidate({
        $schema: SCHEMA_URI,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        kind: 'eltransportador.collection',
        metadata: {
          id: `col_${crypto.randomUUID().slice(0, 8)}`,
          name: parsed.info?.title || 'Colección OpenAPI Importada',
          description: parsed.info?.description || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          appVersion: '1.0.0',
        },
        defaults: {
          timeoutMs: 10000,
          followRedirects: true,
          maxRedirects: 5,
          verifyTls: true,
          headers: [],
        },
        variables: [{ key: 'base_url', value: baseUrl, enabled: true, isSecret: false }],
        folders: [],
        requests,
      });

      return {
        sourceFormat: 'openapi.v3',
        collection,
        preservedFields: [
          'info.title',
          'info.description',
          'servers[0].url',
          'paths.*',
          'parameters(query)',
          'requestBody.example',
        ],
        transformedFields: ['servers[0].url -> variables.base_url', 'paths -> requests[]'],
        discardedFields,
        warnings: discardedFields.length
          ? [`Se ignoraron extensiones propietarias no auditadas: ${discardedFields.join(', ')}`]
          : [],
      };
    }

    throw new Error(
      'Formato de importación no reconocido. Se soporta eltransportador.collection/v1 y OpenAPI 3.x.'
    );
  }

  static exportToCurl(requestSpec, redactSecrets = true) {
    const redactor = new SecretRedactor();
    const method = String(requestSpec.method || 'GET').toUpperCase();
    let urlStr = requestSpec.url || 'http://localhost';
    if (redactSecrets) urlStr = redactor.redactText(urlStr);

    const lines = [`curl -X ${method} '${urlStr.replace(/'/g, "'\\''")}'`];

    for (const h of requestSpec.headers || []) {
      if (!h || !h.enabled || !h.key) continue;
      const val =
        redactSecrets && (h.isSecret || SecretRedactor.isSensitiveHeaderName(h.key))
          ? REDACTED_PLACEHOLDER
          : h.value || '';
      lines.push(`  -H '${h.key}: ${val}'`);
    }

    if (requestSpec.auth?.type === 'bearer' && requestSpec.auth.bearerToken) {
      const tok = redactSecrets ? REDACTED_PLACEHOLDER : requestSpec.auth.bearerToken;
      lines.push(`  -H 'Authorization: Bearer ${tok}'`);
    }

    if (requestSpec.body?.mode === 'json' && requestSpec.body.raw) {
      const bodyText = redactSecrets ? redactor.redactText(requestSpec.body.raw) : requestSpec.body.raw;
      lines.push(`  -H 'Content-Type: application/json'`);
      lines.push(`  --data-raw '${bodyText.replace(/'/g, "'\\''")}'`);
    }

    return lines.join(' \\\n');
  }
}

// ---------------------------------------------------------------------------
// 10. Ejecutor de Flujos de Colecciones (`runCollectionFlow`)
// ---------------------------------------------------------------------------
export async function runCollectionFlow(collection, options = {}) {
  const startTime = performance.now();
  const runtimeVars = { ...(options.initialRuntimeVars || {}) };
  const collectionVars = {};
  for (const v of collection.variables || []) {
    if (v && v.enabled && !v.isSecret) {
      collectionVars[v.key] = v.value;
    }
  }
  const environmentVars = { ...(options.environmentVars || {}) };
  const stopOnFailure = options.stopOnFailure ?? false;

  const stepResults = [];
  let totalAssertions = 0;
  let passedAssertions = 0;
  let failedAssertions = 0;
  let allPassed = true;

  for (const reqSpec of collection.requests || []) {
    const resp = await executeHttpRequest(reqSpec, {
      runtimeVars,
      environmentVars,
      collectionVars,
      vault: options.vault || null,
    });

    for (const [extKey, extVal] of Object.entries(resp.extractedVariables || {})) {
      runtimeVars[extKey] = extVal;
    }

    const reqPassed = !resp.error && resp.assertionResults.every((a) => a.passed);

    for (const a of resp.assertionResults) {
      totalAssertions += 1;
      if (a.passed) passedAssertions += 1;
      else failedAssertions += 1;
    }

    if (!reqPassed) {
      allPassed = false;
    }

    stepResults.push({
      requestId: reqSpec.id,
      requestName: reqSpec.name,
      method: reqSpec.method,
      url: reqSpec.url,
      status: resp.status,
      durationMs: resp.durationMs,
      passed: reqPassed,
      assertionResults: resp.assertionResults,
      extractedVariables: resp.extractedVariables,
      error: resp.error,
    });

    if (!reqPassed && stopOnFailure) {
      break;
    }
  }

  return {
    collectionId: collection.metadata?.id,
    collectionName: collection.metadata?.name,
    timestamp: new Date().toISOString(),
    totalDurationMs: Math.max(1, Math.round(performance.now() - startTime)),
    totalRequests: stepResults.length,
    totalAssertions,
    passedAssertions,
    failedAssertions,
    allPassed,
    finalRuntimeVars: runtimeVars,
    steps: stepResults,
  };
}
