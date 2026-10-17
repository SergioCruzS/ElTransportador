/**
 * Interpolación de Variables, Resolución de URLs y Enmascaramiento de Secretos — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/services/http/variable-interpolation.js
 */
import { REDACTED } from "../storage/index.js";

export function getBridgeTokenFromMeta() {
  if (typeof document === "undefined") return "";
  const meta = document.querySelector('meta[name="etp-bridge-token"]');
  return meta ? meta.getAttribute("content") || "" : "";
}

export function getActiveEnvironmentVars(state) {
  if (state.activeEnvId === "none") return {};
  const found = (state.environments || []).find((e) => e.id === state.activeEnvId);
  if (!found) return {};
  const map = {};
  for (const v of found.variables || []) {
    if (v && v.enabled && v.key) {
      map[v.key] = v.value;
    }
  }
  return map;
}

export function resolveVariablesInString(str, state) {
  if (!str || typeof str !== "string") return { text: "", unresolved: [] };
  const colVars = {};
  for (const col of state.collections || []) {
    for (const v of col.variables || []) {
      if (v.enabled && !v.isSecret) colVars[v.key] = v.value;
    }
  }
  const envVars = getActiveEnvironmentVars(state);
  const unresolved = [];
  const regex = /\$\{\s*(secret:)?([a-zA-Z0-9_.\-]+)\s*\}/g;
  const text = str.replace(regex, (match, secPrefix, key) => {
    if (secPrefix) {
      if (state.secretVault[key] !== undefined && state.secretVault[key] !== "") return state.secretVault[key];
      unresolved.push("secret:" + key);
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
  const { text: baseResolved, unresolved } = resolveVariablesInString(req.url || "", state);
  try {
    const parsed = new URL(baseResolved);
    for (const p of req.params || []) {
      if (p && p.enabled && p.key) {
        const k = resolveVariablesInString(p.key, state).text;
        const v = resolveVariablesInString(p.value || "", state).text;
        parsed.searchParams.set(k, v);
      }
    }
    return { text: parsed.toString(), unresolved };
  } catch {
    return { text: baseResolved, unresolved };
  }
}

export function maskSecretsInString(str, state) {
  if (!str || typeof str !== "string") return "";
  let out = str;
  for (const secVal of Object.values(state.secretVault || {})) {
    if (secVal && String(secVal).length >= 4 && out.includes(secVal)) {
      out = out.split(secVal).join(REDACTED);
    }
  }
  for (const env of state.environments || []) {
    for (const v of env.variables || []) {
      if (v && v.isSecret && v.value && String(v.value).length >= 4 && out.includes(v.value)) {
        out = out.split(v.value).join(REDACTED);
      }
    }
  }
  return out;
}

export function sanitizeRequestSnapshotForHistory(req, state) {
  const clean = JSON.parse(JSON.stringify(req));
  clean.url = maskSecretsInString(clean.url || "", state);
  if (Array.isArray(clean.headers)) {
    for (const h of clean.headers) {
      const isSens = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test((h.key || "").trim());
      if (h.isSecret || (!h._userToggledSecret && isSens)) {
        h.value = REDACTED;
      } else {
        h.value = maskSecretsInString(h.value || "", state);
      }
    }
  }
  if (Array.isArray(clean.params)) {
    for (const p of clean.params) {
      if (p.isSecret) {
        p.value = REDACTED;
      } else {
        p.value = maskSecretsInString(p.value || "", state);
      }
    }
  }
  if (clean.auth && typeof clean.auth === "object") {
    if (clean.auth.bearerToken) clean.auth.bearerToken = REDACTED;
    if (clean.auth.basicPassword) clean.auth.basicPassword = REDACTED;
    if (clean.auth.apiKeyValue) clean.auth.apiKeyValue = REDACTED;
  }
  if (clean.body && clean.body.raw) {
    clean.body.raw = maskSecretsInString(clean.body.raw, state);
  }
  return clean;
}
