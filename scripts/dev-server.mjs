#!/usr/bin/env node
/**
 * Servidor de Desarrollo Local — ElTransportador (`scripts/dev-server.mjs`)
 * Levanta:
 * 1. Un servidor API REST local de demostración en http://127.0.0.1:18980 (con endpoints reales GET/POST/PUT/DELETE para /health, /orders, /users).
 * 2. El servidor de aplicación y puente IPC de ElTransportador en http://127.0.0.1:1420 (que permite ejecutar peticiones HTTP hacia cualquier API externa sin restricciones CORS del navegador y persiste en SQLite).
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createBridgeServer } from './runtime-bridge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, '.eltransportador-local');
const DIST_DIR = path.join(ROOT, 'apps/desktop/dist');

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.log('Compilando bundle inicial...');
  await import('./build-all.mjs');
}

const orders = new Map([
  [
    'ORD-9001',
    {
      id: 'ORD-9001',
      customer: 'Logística Central S.A. de C.V.',
      origin: 'Toluca, Estado de México',
      destination: 'Monterrey, Nuevo León',
      priority: 'express',
      status: 'in_transit',
      weightKg: 50.0,
      items: [{ sku: 'ETP-MOD-01', qty: 4, weightKg: 12.5 }],
      createdAt: '2026-10-14T09:00:00Z',
    },
  ],
  [
    'ORD-9002',
    {
      id: 'ORD-9002',
      customer: 'Distribuidora del Bajío S.A.',
      origin: 'Querétaro, QRO',
      destination: 'Guadalajara, JAL',
      priority: 'standard',
      status: 'delivered',
      weightKg: 120.0,
      items: [{ sku: 'IND-VALVE-88', qty: 10, weightKg: 12.0 }],
      createdAt: '2026-10-14T09:30:00Z',
    },
  ],
]);

const demoApiServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf-8');

    if (url.pathname === '/api/v1/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'etp_session=sess_dev_local; Path=/; HttpOnly; SameSite=Strict',
      });
      res.end(
        JSON.stringify(
          {
            status: 'operational',
            service: 'eltransportador-local-demo-api',
            version: '1.0.0',
            verbose: url.searchParams.get('verbose') === 'true',
            activeOrdersCount: orders.size,
            meta: {
              nonce: 'nonce_live_778899',
              region: 'toluca-mex-01',
              timestamp: new Date().toISOString(),
            },
          },
          null,
          2
        )
      );
      return;
    }

    if (url.pathname === '/api/v1/orders' && req.method === 'GET') {
      let list = Array.from(orders.values());
      const priorityFilter = url.searchParams.get('priority');
      if (priorityFilter) {
        list = list.filter((o) => o.priority === priorityFilter);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify(
          {
            total: list.length,
            filtersApplied: Object.fromEntries(url.searchParams.entries()),
            orders: list,
          },
          null,
          2
        )
      );
      return;
    }

    if (url.pathname === '/api/v1/orders' && req.method === 'POST') {
      let payload = {};
      try {
        payload = JSON.parse(rawBody || '{}');
      } catch {}
      const newId = `ORD-${9000 + orders.size + 1}`;
      const created = {
        id: newId,
        customer: payload.customer || 'Cliente Nuevo S.A.',
        origin: payload.origin || 'Toluca, MEX',
        destination: payload.destination || 'CDMX, MEX',
        priority: payload.priority || 'express',
        status: 'confirmed',
        items: payload.items || [],
        createdAt: new Date().toISOString(),
      };
      orders.set(newId, created);
      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ order: created }, null, 2));
      return;
    }

    if (url.pathname.startsWith('/api/v1/orders/')) {
      const id = url.pathname.split('/').pop();
      if (req.method === 'DELETE') {
        const deleted = orders.delete(id);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ deleted, id }, null, 2));
        return;
      }
      const found = orders.get(id) || orders.get('ORD-9001');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ order: found }, null, 2));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify(
        {
          error: 'Not Found',
          status: 404,
          message: `La ruta ${url.pathname} no existe en el servidor local.`,
          method: req.method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams.entries()),
          headersReceived: req.headers,
          bodyReceived: rawBody || null,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );
  });
});

const apiPort = Number(process.env.ELTRANSPORTADOR_API_PORT || 18980);
const uiPort = Number(process.env.ELTRANSPORTADOR_PORT || 1420);

demoApiServer.listen(apiPort, '127.0.0.1', () => {
  const bridge = createBridgeServer({
    dataDir: DATA_DIR,
    distDir: DIST_DIR,
    mockApiBaseUrl: `http://127.0.0.1:${apiPort}`,
  });

  bridge.listen(uiPort, '127.0.0.1', () => {
    console.log('===================================================================');
    console.log('🚀 ElTransportador — Entorno de Desarrollo Activo');
    console.log(`👉 Interfaz Web / IDE:      http://127.0.0.1:${uiPort}`);
    console.log(`👉 API REST Demo Local:     http://127.0.0.1:${apiPort}/api/v1/health`);
    console.log(`👉 Base de datos SQLite:    ${path.join(DATA_DIR, 'history.sqlite3')}`);
    console.log('===================================================================');
  });
});
