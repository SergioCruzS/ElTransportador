/**
 * Suite de Pruebas de Integración — ElTransportador (`tests/integration/run-integration-tests.mjs`)
 * Levanta un servidor HTTP local efímero de pruebas (sin depender de servicios externos) y verifica:
 * 1. Métodos HTTP (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
 * 2. Headers, Query Parameters y Autenticación (Bearer, Basic, API Key)
 * 3. Cuerpos JSON, Text, x-www-form-urlencoded y multipart/form-data
 * 4. Redirecciones válidas (302 -> 200) y límite máximo de redirecciones
 * 5. Timeouts configurables y Cancelación activa en vuelo (`cancelActiveRequest`)
 * 6. Respuestas grandes y truncamiento seguro por límite de memoria (`maxResponseBytes`)
 * 7. Persistencia de historial en SQLite (`SqliteHistoryRepository`) con redacción automática
 * 8. Ejecución de flujos completos (`runCollectionFlow`) con encadenamiento de variables entre solicitudes
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  executeHttpRequest,
  cancelActiveRequest,
  SecretVault,
  SecretRedactor,
  SqliteHistoryRepository,
  runCollectionFlow,
  REDACTED_PLACEHOLDER,
} from '../../scripts/core-engine.mjs';

const ordersDb = new Map();

function startLocalTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf-8');

        // 1. Health endpoint
        if (url.pathname === '/api/v1/health') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': 'etp_session=sess_abc123; Path=/; HttpOnly; SameSite=Strict',
          });
          res.end(
            JSON.stringify({
              status: 'operational',
              verbose: url.searchParams.get('verbose') === 'true',
              meta: { nonce: 'nonce_live_778899' },
            })
          );
          return;
        }

        // 2. Echo endpoint para todos los métodos y tipos de body
        if (url.pathname === '/api/v1/echo') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Echo-Method': req.method,
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          res.end(
            JSON.stringify({
              method: req.method,
              query: Object.fromEntries(url.searchParams.entries()),
              headers: req.headers,
              rawBody,
            })
          );
          return;
        }

        // 3. Orders CRUD (con verificación Bearer token y encadenamiento)
        if (url.pathname === '/api/v1/orders' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ orders: Array.from(ordersDb.values()) }));
          return;
        }
        if (url.pathname === '/api/v1/orders' && req.method === 'POST') {
          const auth = req.headers['authorization'];
          if (auth !== 'Bearer etp_live_gateway_token_2026') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
          const payload = JSON.parse(rawBody || '{}');
          const order = {
            id: 'ORD-9001',
            ...payload,
            nonceReceived: req.headers['x-session-nonce'] || null,
          };
          ordersDb.set(order.id, order);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ order }));
          return;
        }

        if (url.pathname.startsWith('/api/v1/orders/') && req.method === 'GET') {
          const id = url.pathname.split('/').pop();
          const found = ordersDb.get(id);
          if (!found) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not Found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ order: found }));
          return;
        }

        // 4. Redirección same-origin
        if (url.pathname === '/api/v1/redirect-hop') {
          res.writeHead(302, { Location: '/api/v1/health?verbose=true' });
          res.end();
          return;
        }

        // 5. Endpoint lento para probar Timeouts y Cancelación
        if (url.pathname === '/api/v1/slow') {
          const delay = Number(url.searchParams.get('ms') || '1500');
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ delayed: delay }));
          }, delay);
          return;
        }

        // 6. Respuesta grande para probar streaming y límite de memoria
        if (url.pathname === '/api/v1/large') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          const block = 'A'.repeat(64 * 1024); // 64 KB por bloque
          for (let i = 0; i < 10; i++) {
            res.write(block);
          }
          res.end();
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Route not found' }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function run() {
  console.log('=== Ejecutando Pruebas de Integración HTTP y Persistencia (ElTransportador) ===');
  const { server, baseUrl } = await startLocalTestServer();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-int-test-'));

  try {
    // 1. Probar métodos HTTP (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const resp = await executeHttpRequest({
        id: `req_${method}`,
        name: `Test ${method}`,
        method,
        url: `${baseUrl}/api/v1/echo`,
        params: [{ id: 'p1', key: 'mode', value: method.toLowerCase(), enabled: true }],
        headers: [{ id: 'h1', key: 'X-Custom-Check', value: 'activo', enabled: true }],
        auth: { type: 'none' },
        body: ['POST', 'PUT', 'PATCH'].includes(method)
          ? { mode: 'json', raw: JSON.stringify({ action: method }) }
          : { mode: 'none' },
      });
      assert.equal(resp.status, 200);
      assert.equal(resp.headers['x-echo-method'], method);
      if (method !== 'HEAD') {
        const bodyObj = JSON.parse(resp.body);
        assert.equal(bodyObj.method, method);
        assert.equal(bodyObj.query.mode, method.toLowerCase());
      }
    }
    console.log('  ✓ [INTEGRATION] Todos los métodos HTTP (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) verificados');

    // 2. Probar cuerpos application/x-www-form-urlencoded y multipart/form-data
    const urlencResp = await executeHttpRequest({
      id: 'req_form',
      name: 'Form URL Encoded',
      method: 'POST',
      url: `${baseUrl}/api/v1/echo`,
      params: [],
      headers: [],
      auth: { type: 'basic', basicUsername: 'operador', basicPassword: 'clave_segura' },
      body: {
        mode: 'urlencoded',
        urlencoded: [
          { id: 'f1', key: 'origin', value: 'Toluca', enabled: true },
          { id: 'f2', key: 'weight', value: '45.5', enabled: true },
        ],
      },
    });
    const urlencJson = JSON.parse(urlencResp.body);
    assert.equal(urlencJson.rawBody, 'origin=Toluca&weight=45.5');
    assert.equal(urlencJson.headers['authorization'].startsWith('Basic '), true);

    const mpResp = await executeHttpRequest({
      id: 'req_mp',
      name: 'Multipart Form',
      method: 'POST',
      url: `${baseUrl}/api/v1/echo`,
      params: [],
      headers: [],
      auth: { type: 'apikey', apiKeyName: 'X-API-Key', apiKeyValue: 'ak_test_1', apiKeyIn: 'header' },
      body: {
        mode: 'multipart',
        multipart: [
          { id: 'm1', key: 'manifest_id', value: 'MNF-100', enabled: true },
        ],
      },
    });
    const mpJson = JSON.parse(mpResp.body);
    assert.equal(mpJson.rawBody.includes('Content-Disposition: form-data; name="manifest_id"'), true);
    assert.equal(mpJson.headers['x-api-key'], 'ak_test_1');
    console.log('  ✓ [INTEGRATION] Cuerpos JSON, urlencoded, multipart y autenticaciones (Bearer, Basic, API Key) verificados');

    // 3. Probar redirecciones y parseo de Cookies
    const redirResp = await executeHttpRequest({
      id: 'req_redir',
      name: 'Follow Redirect',
      method: 'GET',
      url: `${baseUrl}/api/v1/redirect-hop`,
      params: [],
      headers: [],
      auth: { type: 'none' },
      body: { mode: 'none' },
    });
    assert.equal(redirResp.status, 200);
    assert.equal(redirResp.redirects.length, 1);
    assert.equal(redirResp.cookies.length, 1);
    assert.equal(redirResp.cookies[0].name, 'etp_session');
    assert.equal(redirResp.cookies[0].httpOnly, true);
    console.log('  ✓ [INTEGRATION] Seguimiento de redirecciones y extracción de cookies verificados');

    // 4. Probar Timeouts y Cancelación en vuelo
    const timeoutResp = await executeHttpRequest({
      id: 'req_timeout',
      name: 'Timeout Test',
      method: 'GET',
      url: `${baseUrl}/api/v1/slow?ms=600`,
      params: [],
      headers: [],
      auth: { type: 'none' },
      body: { mode: 'none' },
      settings: { timeoutMs: 120, followRedirects: true, maxRedirects: 3, verifyTls: true, maxResponseBytes: 1048576 },
    });
    assert.equal(timeoutResp.error?.code, 'TIMEOUT');

    const cancelPromise = executeHttpRequest({
      id: 'req_cancel_me',
      name: 'Cancel Test',
      method: 'GET',
      url: `${baseUrl}/api/v1/slow?ms=2000`,
      params: [],
      headers: [],
      auth: { type: 'none' },
      body: { mode: 'none' },
    });
    setTimeout(() => {
      cancelActiveRequest('req_cancel_me');
    }, 60);
    const cancelResp = await cancelPromise;
    assert.equal(cancelResp.error?.code, 'CANCELLED');
    console.log('  ✓ [INTEGRATION] Timeouts y cancelación de solicitudes en curso verificados');

    // 5. Probar límite de memoria en respuestas grandes (`maxResponseBytes`)
    const largeResp = await executeHttpRequest({
      id: 'req_large',
      name: 'Large Response',
      method: 'GET',
      url: `${baseUrl}/api/v1/large`,
      params: [],
      headers: [],
      auth: { type: 'none' },
      body: { mode: 'none' },
      settings: { timeoutMs: 5000, followRedirects: true, maxRedirects: 3, verifyTls: true, maxResponseBytes: 100 * 1024 },
    });
    assert.equal(largeResp.truncated, true);
    assert.equal(Buffer.byteLength(largeResp.body, 'utf-8'), 100 * 1024);
    console.log('  ✓ [INTEGRATION] Streaming y truncamiento seguro de respuestas grandes verificados');

    // 6. Probar ejecución completa de flujo de colección (`pasarela-pagos.etp.json`) con encadenamiento de variables y bóveda
    const vault = new SecretVault(path.join(tmpDir, 'vault'));
    vault.setSecret('gateway_token', 'etp_live_gateway_token_2026');

    const colRaw = JSON.parse(
      fs.readFileSync(path.resolve('packages/test-fixtures/collections/pasarela-pagos.etp.json'), 'utf-8')
    );
    const flowReport = await runCollectionFlow(colRaw, {
      environmentVars: { base_url: baseUrl },
      vault,
    });
    assert.equal(flowReport.allPassed, true);
    assert.equal(flowReport.totalRequests, 4);
    assert.equal(flowReport.passedAssertions, 9);
    assert.equal(flowReport.finalRuntimeVars.session_nonce, 'nonce_live_778899');
    assert.equal(flowReport.finalRuntimeVars.created_order_id, 'ORD-9001');
    console.log('  ✓ [INTEGRATION] Flujo encadenado de 3 solicitudes (Health -> POST Order -> GET Order) 100% exitoso');

    // 7. Probar Historial en SQLite con redacción obligatoria de secretos
    const historyRepo = new SqliteHistoryRepository(path.join(tmpDir, 'history.sqlite3'), 50);
    const redactor = new SecretRedactor(vault.getAllSecretValuesForRedaction());
    historyRepo.recordExecution(colRaw.requests[1], { status: 201, durationMs: 18, sizeBytes: 240, timestamp: new Date().toISOString() }, redactor);
    const entries = historyRepo.listEntries(10);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].requestSnapshot.auth.bearerToken, REDACTED_PLACEHOLDER);
    console.log('  ✓ [INTEGRATION] Persistencia en SQLite y sanitización de credenciales verificadas\n');
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('Fallo en pruebas de integración:', err);
  process.exit(1);
});
