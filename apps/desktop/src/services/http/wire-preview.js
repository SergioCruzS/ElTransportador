/**
 * Generador de Comandos cURL Redactados y Vista Previa en Vivo (Wire Preview) — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/services/http/wire-preview.js
 */
import { translate } from "../../lang/i18n.js";
import { REDACTED } from "../storage/index.js";
import {
  resolveVariablesInString,
  buildFullResolvedUrlWithParams,
  maskSecretsInString
} from "./variable-interpolation.js";

export function generateCompleteCurlCommand(req, state) {
  if (!req) return "";
  const { text: fullUrl } = buildFullResolvedUrlWithParams(req, state);
  const method = (req.method || "GET").toUpperCase();
  const lines = [`curl --location --request ${method} '${maskSecretsInString(fullUrl, state).replace(/'/g, "'\\''")}'`];

  if (req.settings?.verifyTls === false) {
    lines.push(`  --insecure`);
  }

  for (const h of req.headers || []) {
    if (h && h.enabled && h.key) {
      const isSens = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test((h.key || "").trim());
      const val =
        h.isSecret || (!h._userToggledSecret && isSens)
          ? REDACTED
          : maskSecretsInString(resolveVariablesInString(h.value || "", state).text, state);
      lines.push(`  --header '${h.key}: ${val.replace(/'/g, "'\\''")}'`);
    }
  }

  if (req.auth?.type === "bearer" && req.auth.bearerToken) {
    lines.push(`  --header 'Authorization: Bearer ${REDACTED}'`);
  } else if (req.auth?.type === "basic" && (req.auth.basicUsername || req.auth.basicPassword)) {
    const u = resolveVariablesInString(req.auth.basicUsername || "", state).text;
    lines.push(`  --user '${u}:${REDACTED}'`);
  } else if (req.auth?.type === "apikey" && req.auth.apiKeyName && req.auth.apiKeyValue) {
    if ((req.auth.apiKeyIn || "header") === "header") {
      lines.push(`  --header '${req.auth.apiKeyName}: ${REDACTED}'`);
    }
  }

  if (!["GET", "HEAD"].includes(method) && req.body?.mode && req.body.mode !== "none") {
    if (req.body.mode === "json") {
      lines.push(`  --header 'Content-Type: application/json'`);
      const rawJson = maskSecretsInString(resolveVariablesInString(req.body.raw || "{}", state).text, state);
      lines.push(`  --data-raw '${rawJson.replace(/'/g, "'\\''")}'`);
    } else if (req.body.mode === "text") {
      lines.push(`  --header 'Content-Type: text/plain'`);
      const rawTxt = maskSecretsInString(resolveVariablesInString(req.body.raw || "", state).text, state);
      lines.push(`  --data-raw '${rawTxt.replace(/'/g, "'\\''")}'`);
    } else if (req.body.mode === "urlencoded") {
      lines.push(`  --header 'Content-Type: application/x-www-form-urlencoded'`);
      for (const u of req.body.urlencoded || []) {
        if (u && u.enabled && u.key) {
          lines.push(`  --data-urlencode '${u.key}=${maskSecretsInString(u.value || "", state)}'`);
        }
      }
    } else if (req.body.mode === "multipart") {
      for (const m of req.body.multipart || []) {
        if (m && m.enabled && m.key) {
          lines.push(`  --form '${m.key}="${maskSecretsInString(m.value || "", state)}"'`);
        }
      }
    }
  }

  return lines.join(" \\\n");
}

export function buildLiveHttpWirePreview(req, state) {
  if (!req) return "";
  const lang = state?.lang || "es";
  const noUrlLabel = translate(lang, "request.noUrlPlaceholder");
  const { text: fullUrl } = buildFullResolvedUrlWithParams(req, state);
  const lines = [`${req.method || "GET"} ${maskSecretsInString(fullUrl || noUrlLabel, state)} HTTP/1.1`];

  for (const h of req.headers || []) {
    if (h && h.enabled && h.key) {
      const isSens = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test((h.key || "").trim());
      const val =
        h.isSecret || (!h._userToggledSecret && isSens)
          ? REDACTED
          : maskSecretsInString(resolveVariablesInString(h.value || "", state).text, state);
      lines.push(`${h.key}: ${val}`);
    }
  }

  if (req.auth?.type === "bearer" && req.auth.bearerToken) {
    lines.push(`Authorization: Bearer ${REDACTED}`);
  } else if (req.auth?.type === "basic" && (req.auth.basicUsername || req.auth.basicPassword)) {
    lines.push(`Authorization: Basic ${REDACTED}`);
  } else if (req.auth?.type === "apikey" && req.auth.apiKeyName) {
    lines.push(`${req.auth.apiKeyName} (${req.auth.apiKeyIn || "header"}): ${REDACTED}`);
  }

  if (!["GET", "HEAD"].includes(req.method) && req.body?.mode && req.body.mode !== "none") {
    if (req.body.mode === "json" || req.body.mode === "text") {
      lines.push("", maskSecretsInString(resolveVariablesInString(req.body.raw || "", state).text, state));
    }
  }

  return lines.join("\n");
}
