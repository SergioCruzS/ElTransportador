/**
 * Transporte HTTP/HTTPS de Bajo Nivel por Salto (Hop) — ElTransportador v1.0.1
 * Archivo: scripts/core-engine/http-transport.mjs
 */
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { parseSetCookieHeader } from "./http-executor.mjs";

export function performSingleHttpHop({
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
