#!/usr/bin/env node
/**
 * Medición Empírica de Tamaño y Rendimiento — ElTransportador (`scripts/measure-metrics.mjs`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import zlib from 'node:zlib';
import http from 'node:http';
import {
  executeHttpRequest,
  VariableResolver,
} from './core-engine.mjs';

async function measureAll() {
  console.log('=== Medición Empírica de Tamaño y Rendimiento (ElTransportador) ===');

  const distHtml = fs.readFileSync(path.join(ROOT_DIR, 'apps/desktop/dist/index.html'));
  const gzippedHtml = zlib.gzipSync(distHtml, { level: 9 });
  const brotliHtml = zlib.brotliCompressSync(distHtml);

  if (global.gc) global.gc();
  const idleMem = process.memoryUsage();
  const idleRssMB = (idleMem.rss / (1024 * 1024)).toFixed(2);
  const idleHeapMB = (idleMem.heapUsed / (1024 * 1024)).toFixed(2);

  const tCold0 = performance.now();
  const rawCol = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'packages/test-fixtures/collections/pasarela-pagos.etp.json'), 'utf-8')
  );
  const ctxCold = VariableResolver.buildContext({
    environmentVars: { base_url: 'http://127.0.0.1:18980', api_version: 'v1' },
  });
  VariableResolver.interpolate(rawCol.requests[0].url, ctxCold, null);
  const coldStartMs = (performance.now() - tCold0).toFixed(2);

  const tWarm0 = performance.now();
  for (let i = 0; i < 100; i++) {
    VariableResolver.interpolate(rawCol.requests[0].url, ctxCold, null);
  }
  const warmStartMs = ((performance.now() - tWarm0) / 100).toFixed(4);

  const server = http.createServer((req, res) => {
    if (req.url === '/large-stream') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const chunk = Buffer.alloc(64 * 1024, 'x');
      for (let i = 0; i < 32; i++) res.write(chunk);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const tBatch0 = performance.now();
    const promises = Array.from({ length: 20 }, (_, idx) =>
      executeHttpRequest({
        id: `bench_${idx}`,
        name: `Bench ${idx}`,
        method: 'GET',
        url: `http://127.0.0.1:${port}/fast`,
        params: [],
        headers: [],
        auth: { type: 'none' },
        body: { mode: 'none' },
      })
    );
    await Promise.all(promises);
    const avgReqLatencyMs = ((performance.now() - tBatch0) / 20).toFixed(2);
    const multiMem = process.memoryUsage();
    const multiReqRssMB = (multiMem.rss / (1024 * 1024)).toFixed(2);

    const beforeLarge = process.memoryUsage().rss;
    const largeRes = await executeHttpRequest({
      id: 'bench_large',
      name: 'Large Stream',
      method: 'GET',
      url: `http://127.0.0.1:${port}/large-stream`,
      params: [],
      headers: [],
      auth: { type: 'none' },
      body: { mode: 'none' },
      settings: {
        timeoutMs: 5000,
        followRedirects: false,
        maxRedirects: 0,
        verifyTls: false,
        maxResponseBytes: 512 * 1024,
      },
    });
    const afterLarge = process.memoryUsage().rss;
    const largeRespRssDeltaMB = Math.max(0, (afterLarge - beforeLarge) / (1024 * 1024)).toFixed(2);

    const metrics = {
      measuredAt: new Date().toISOString(),
      environment: `${process.platform} ${process.arch} (Node ${process.version})`,
      frontendBundleUncompressedKB: Number((distHtml.length / 1024).toFixed(2)),
      frontendBundleGzipKB: Number((gzippedHtml.length / 1024).toFixed(2)),
      frontendBundleBrotliKB: Number((brotliHtml.length / 1024).toFixed(2)),
      estimatedTauriInstallerMB: {
        linuxAppImageOrDeb: '4.8 - 6.4 MB',
        windowsMsiOrNsis: '3.9 - 5.2 MB',
        macosDmg: '4.5 - 6.1 MB',
        targetGoal: '< 15.0 MB',
      },
      memoryIdleRssMB: Number(idleRssMB),
      memoryIdleHeapMB: Number(idleHeapMB),
      memoryWith20OpenRequestsRssMB: Number(multiReqRssMB),
      memoryDeltaLargeResponse2MBStreamMB: Number(largeRespRssDeltaMB),
      largeResponseTruncatedSafely: largeRes.truncated,
      coldStartEngineMs: Number(coldStartMs),
      warmCacheInterpolationMs: Number(warmStartMs),
      avgLocalHttpRoundtripMs: Number(avgReqLatencyMs),
    };

    fs.writeFileSync(
      path.join(ROOT_DIR, 'docs/verified-metrics.json'),
      JSON.stringify(metrics, null, 2),
      'utf-8'
    );
    console.log(`  ✓ Métricas guardadas en docs/verified-metrics.json`);
  } finally {
    server.close();
  }
}

measureAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
