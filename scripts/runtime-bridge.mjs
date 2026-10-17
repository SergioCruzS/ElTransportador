#!/usr/bin/env node
/**
 * ElTransportador Runtime Bridge (`scripts/runtime-bridge.mjs`) — v1.0.0
 * Controles de Seguridad Implementados:
 * 1. Generación de token criptográfico de sesión (`X-ETP-Bridge-Token`) inyectado únicamente en `index.html` local.
 * 2. Validación estricta de `Host` y `Origin` (`127.0.0.1` / `localhost`) para mitigar ataques CSRF / DNS Rebinding.
 * 3. Límite estricto de tamaño de cuerpo (`MAX_IPC_BODY_BYTES = 2 MB`) con rechazo inmediato `413 Payload Too Large`.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  executeHttpRequest,
  cancelActiveRequest,
  SecretVault,
  SecretRedactor,
  CollectionStorage,
  SqliteHistoryRepository,
  ImportExportService,
  runCollectionFlow,
} from './core-engine.mjs';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const MAX_IPC_BODY_BYTES = 2 * 1024 * 1024; // 2 MB límite máximo por petición IPC

function isAllowedLocalHost(hostHeader) {
  if (!hostHeader) return false;
  const hostname = String(hostHeader).split(':')[0].toLowerCase();
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

function isAllowedLocalOrigin(originHeader) {
  if (!originHeader) return true; // Clientes CLI locales sin cabecera Origin
  try {
    const u = new URL(originHeader);
    return (u.protocol === 'http:' || u.protocol === 'https:') &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === 'tauri.localhost');
  } catch {
    return false;
  }
}

export function createBridgeServer({ dataDir, distDir, mockApiBaseUrl = null, bridgeToken = null }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const vault = new SecretVault(path.join(dataDir, 'vault'));
  const colStorage = new CollectionStorage(path.join(dataDir, 'collections'));
  const historyRepo = new SqliteHistoryRepository(path.join(dataDir, 'history.sqlite3'), 200);
  const sessionToken = bridgeToken || process.env.ELTRANSPORTADOR_BRIDGE_TOKEN || crypto.randomBytes(24).toString('hex');

  const server = http.createServer(async (req, res) => {
    // 1. Validar Host y Origin contra DNS Rebinding y CSRF
    if (!isAllowedLocalHost(req.headers.host) || !isAllowedLocalOrigin(req.headers.origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'FORBIDDEN_ORIGIN_OR_HOST' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && !url.pathname.startsWith('/__etp_ipc__/')) {
      const relPath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      const safePath = path.normalize(path.join(distDir, relPath));
      if (safePath.startsWith(path.resolve(distDir)) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const ext = path.extname(safePath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': mime,
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN'
        });
        if (ext === '.html') {
          let htmlContent = fs.readFileSync(safePath, 'utf-8');
          const metaTag = `<meta name="etp-bridge-token" content="${sessionToken}" />`;
          if (htmlContent.includes('<head>')) {
            htmlContent = htmlContent.replace('<head>', `<head>${metaTag}`);
          } else {
            htmlContent = metaTag + htmlContent;
          }
          res.end(htmlContent, 'utf-8');
        } else {
          res.end(fs.readFileSync(safePath));
        }
        return;
      }
    }

    if (url.pathname.startsWith('/__etp_ipc__/')) {
      // 2. Exigir token de autorización X-ETP-Bridge-Token
      const providedToken = req.headers['x-etp-bridge-token'];
      if (!providedToken || providedToken !== sessionToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'UNAUTHORIZED_BRIDGE_TOKEN' }));
        return;
      }

      const chunks = [];
      let receivedBytes = 0;
      let abortedTooLarge = false;

      req.on('data', (c) => {
        if (abortedTooLarge) return;
        receivedBytes += c.length;
        if (receivedBytes > MAX_IPC_BODY_BYTES) {
          abortedTooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', maxBytes: MAX_IPC_BODY_BYTES }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });

      req.on('end', async () => {
        if (abortedTooLarge) return;
        try {
          const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {};
          const action = url.pathname.replace('/__etp_ipc__/', '');

          if (action === 'bootstrap') {
            const collections = colStorage.listCollections().map((c) => c.collection);
            const history = historyRepo.listEntries(50);
            const secretKeys = vault.listSecretKeys();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ collections, history, secretKeys, mockApiBaseUrl }));
            return;
          }

          if (action === 'execute_request') {
            if (payload.secrets && typeof payload.secrets === 'object') {
              for (const [sKey, sVal] of Object.entries(payload.secrets)) {
                if (sKey) vault.setSecret(sKey, String(sVal || ''));
              }
            }
            const resp = await executeHttpRequest(payload.request, {
              runtimeVars: payload.runtimeVars || {},
              environmentVars: payload.environmentVars || {},
              collectionVars: payload.collectionVars || {},
              vault,
            });
            const redactor = new SecretRedactor(vault.getAllSecretValuesForRedaction());
            const histEntry = historyRepo.recordExecution(payload.request, resp, redactor);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ response: resp, historyEntry: histEntry }));
            return;
          }

          if (action === 'cancel_request') {
            const cancelled = cancelActiveRequest(payload.requestId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ cancelled }));
            return;
          }

          if (action === 'save_collection') {
            const saved = colStorage.saveCollection(payload.fileName, payload.collection);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(saved));
            return;
          }

          if (action === 'run_flow') {
            const report = await runCollectionFlow(payload.collection, {
              environmentVars: payload.environmentVars || {},
              vault,
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(report));
            return;
          }

          if (action === 'set_secret') {
            vault.setSecret(payload.key, payload.value);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, secretKeys: vault.listSecretKeys() }));
            return;
          }

          if (action === 'import_collection') {
            const report = ImportExportService.importData(payload.rawJson);
            colStorage.saveCollection(`${report.collection.metadata.id}.etp.json`, report.collection);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(report));
            return;
          }

          if (action === 'clear_history') {
            historyRepo.clearHistory();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Comando IPC desconocido: ${action}` }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.bridgeToken = sessionToken;
  return server;
}
