/**
 * Suite de Pruebas Unitarias — ElTransportador (`tests/unit/run-unit-tests.mjs`)
 * 1. Construcción de URLs
 * 2. Query parameters
 * 3. Resolución de variables
 * 4. Precedencia de variables (Runtime > Environment > Collection > Global ELTRANSPORTADOR_*)
 * 5. Validación de solicitudes y esquemas
 * 6. Serialización y Deserialización
 * 7. Migraciones de esquemas (v0 -> v1)
 * 8. Redacción de secretos
 * 9. Reglas de redirección y detección cross-origin
 * 10. Evaluador de aserciones y extracción JSONPath
 * 11. Importación OpenAPI 3 y generación cURL segura
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SecretRedactor,
  SecretVault,
  UrlSecurityValidator,
  VariableResolver,
  AssertionEvaluator,
  CollectionStorage,
  ImportExportService,
  REDACTED_PLACEHOLDER,
} from '../../scripts/core-engine.mjs';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('1. Validación y construcción de URLs válidas e inválidas', () => {
  const valid = UrlSecurityValidator.validateRequestUrl('https://api.eltransportador.dev:8443/v1/items');
  assert.equal(valid.ok, true);
  assert.equal(valid.url.hostname, 'api.eltransportador.dev');
  assert.equal(valid.url.port, '8443');

  const empty = UrlSecurityValidator.validateRequestUrl('   ');
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, 'INVALID_URL');

  const blocked = UrlSecurityValidator.validateRequestUrl('file:///etc/passwd');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'BLOCKED_SCHEME');
});

test('2. Resolución de variables y precedencia determinista de 4 niveles', () => {
  const ctx = VariableResolver.buildContext({
    runtimeVars: { token_id: 'rt_999' },
    environmentVars: { token_id: 'env_222', host: 'staging.api.local' },
    collectionVars: { token_id: 'col_111', host: 'dev.api.local', version: 'v2' },
    globalEnv: { ELTRANSPORTADOR_REGION: 'mx-central', OTHER_VAR: 'ignored' },
  });

  const unresolved = new Set();
  const out = VariableResolver.interpolate(
    'https://${host}/${version}/tokens/${token_id}?region=${REGION}&missing=${no_existe}',
    ctx,
    null,
    unresolved
  );

  assert.equal(
    out,
    'https://staging.api.local/v2/tokens/rt_999?region=mx-central&missing=${no_existe}'
  );
  assert.deepEqual(Array.from(unresolved), ['no_existe']);
});

test('3. Bóveda de secretos cifrada AES-256-GCM e interpolación ${secret:key}', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-vault-test-'));
  try {
    const vault = new SecretVault(tmpDir);
    vault.setSecret('stripe_prod_key', 'sk_live_987654321_secret_value');

    // Verificar que el archivo en disco no contiene el secreto en texto plano
    const rawVaultDisk = fs.readFileSync(path.join(tmpDir, 'vault.enc.json'), 'utf-8');
    assert.equal(rawVaultDisk.includes('sk_live_987654321_secret_value'), false);

    // Recargar desde disco en nueva instancia
    const vaultReloaded = new SecretVault(tmpDir);
    assert.equal(vaultReloaded.getSecret('stripe_prod_key'), 'sk_live_987654321_secret_value');

    const ctx = VariableResolver.buildContext({});
    const unresolved = new Set();
    const resolvedSecrets = [];
    const headerVal = VariableResolver.interpolate(
      'Bearer ${secret:stripe_prod_key}',
      ctx,
      vaultReloaded,
      unresolved,
      resolvedSecrets
    );
    assert.equal(headerVal, 'Bearer sk_live_987654321_secret_value');
    assert.equal(resolvedSecrets.includes('sk_live_987654321_secret_value'), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('4. Redacción universal de secretos en URLs, headers, cuerpos e historial', () => {
  const redactor = new SecretRedactor(['my_custom_super_secret_token_2026']);
  const dirtyText =
    'Conectando a https://admin:Passw0rd123@api.ejemplo.mx con Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 y llave my_custom_super_secret_token_2026';
  const cleanText = redactor.redactText(dirtyText);

  assert.equal(cleanText.includes('Passw0rd123'), false);
  assert.equal(cleanText.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), false);
  assert.equal(cleanText.includes('my_custom_super_secret_token_2026'), false);
  assert.equal(cleanText.includes(REDACTED_PLACEHOLDER), true);

  const sanitizedReq = redactor.sanitizeRequestForHistory({
    id: 'req_1',
    name: 'Login',
    method: 'POST',
    url: 'https://user:topsecret@api.local/login',
    params: [{ id: 'p1', key: 'api_key', value: 'ak_999999', enabled: true }],
    headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer secret123', enabled: true }],
    auth: { type: 'bearer', bearerToken: 'secret123' },
    body: { mode: 'json', raw: '{"token":"my_custom_super_secret_token_2026"}' },
  });

  assert.equal(sanitizedReq.headers[0].value, REDACTED_PLACEHOLDER);
  assert.equal(sanitizedReq.params[0].value, REDACTED_PLACEHOLDER);
  assert.equal(sanitizedReq.auth.bearerToken, REDACTED_PLACEHOLDER);
  assert.equal(sanitizedReq.body.raw.includes('my_custom_super_secret_token_2026'), false);
});

test('5. Reglas de redirección, detección cross-origin y bloqueo SSRF', () => {
  const fromPublic = new URL('https://api.publica.mx/v1/resource');
  const toSameOrigin = new URL('https://api.publica.mx/v2/resource');
  const toCrossOrigin = new URL('https://cdn.otro-dominio.mx/asset');
  const toMetadata = new URL('http://169.254.169.254/latest/meta-data/iam');
  const toLocalhost = new URL('http://127.0.0.1:8080/admin');

  const checkSame = UrlSecurityValidator.validateRedirect(fromPublic, toSameOrigin, false);
  assert.equal(checkSame.ok, true);
  assert.equal(checkSame.crossOrigin, false);
  assert.equal(checkSame.strippedHeaders.length, 0);

  const checkCross = UrlSecurityValidator.validateRedirect(fromPublic, toCrossOrigin, false);
  assert.equal(checkCross.ok, true);
  assert.equal(checkCross.crossOrigin, true);
  assert.equal(checkCross.strippedHeaders.includes('authorization'), true);

  const checkMetadata = UrlSecurityValidator.validateRedirect(fromPublic, toMetadata, false);
  assert.equal(checkMetadata.ok, false);
  assert.equal(checkMetadata.error.code, 'SSRF_REDIRECT_BLOCKED');

  const checkLocal = UrlSecurityValidator.validateRedirect(fromPublic, toLocalhost, false);
  assert.equal(checkLocal.ok, false);
  assert.equal(checkLocal.error.code, 'SSRF_REDIRECT_BLOCKED');
});

test('6. Migración de esquemas (v0 -> v1), persistencia atómica y recuperación .bak', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-col-test-'));
  try {
    const storage = new CollectionStorage(tmpDir);
    const legacyV0 = {
      schemaVersion: 0,
      metadata: { id: 'col_legacy', name: 'Colección Legacy v0', description: '', createdAt: '', updatedAt: '', appVersion: '0.9.0' },
      variables: [{ key: 'secret_api', value: 'SHOULD_BE_STRIPPED', enabled: true, isSecret: true }],
      folders: [],
      requests: [],
    };

    const saved = storage.saveCollection('legacy-test.etp.json', legacyV0);
    assert.equal(saved.collection.schemaVersion, 1);
    assert.equal(saved.collection.kind, 'eltransportador.collection');
    // El valor en texto plano de una variable secreta debe limpiarse al guardar
    assert.equal(saved.collection.variables[0].value, '');

    // Guardar una segunda versión para generar archivo .bak y simular corrupción del archivo primario
    saved.collection.metadata.description = 'Segunda versión';
    storage.saveCollection('legacy-test.etp.json', saved.collection);

    fs.writeFileSync(path.join(tmpDir, 'legacy-test.etp.json'), '{CORRUPTED_JSON_FILE', 'utf-8');
    const recovered = storage.loadCollection('legacy-test.etp.json');
    assert.equal(recovered.recoveredFromBackup, true);
    assert.equal(recovered.collection.metadata.id, 'col_legacy');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('7. Evaluador de aserciones (status, headers, JSONPath, tipos y tiempos) y extracción', () => {
  const sampleResponse = {
    status: 201,
    durationMs: 42,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-abc-789' },
    body: JSON.stringify({
      status: 'ok',
      data: {
        orderId: 'ORD-550',
        total: 1250.5,
        items: ['A', 'B'],
        active: true,
      },
    }),
  };

  const rules = [
    { id: '1', enabled: true, target: 'status', operator: 'equals', expected: '201' },
    { id: '2', enabled: true, target: 'header', property: 'X-Request-Id', operator: 'contains', expected: 'abc' },
    { id: '3', enabled: true, target: 'json_path', property: 'data.orderId', operator: 'equals', expected: 'ORD-550' },
    { id: '4', enabled: true, target: 'json_path', property: 'data.items', operator: 'is_type', expected: 'array' },
    { id: '5', enabled: true, target: 'json_path', property: 'data.total', operator: 'greater_than', expected: '1000' },
    { id: '6', enabled: true, target: 'duration_ms', operator: 'less_than', expected: '500' },
  ];

  const evalResults = AssertionEvaluator.evaluateAll(rules, sampleResponse);
  assert.equal(evalResults.length, 6);
  assert.equal(evalResults.every((r) => r.passed), true);

  const extracted = AssertionEvaluator.extractVariables(
    [{ id: 'e1', enabled: true, variableName: 'saved_order', source: 'json_path', path: 'data.orderId' }],
    sampleResponse
  );
  assert.equal(extracted.saved_order, 'ORD-550');
});

test('8. Importador OpenAPI 3.0 con reporte de transformación y descarte de extensiones no confiables', () => {
  const fixturePath = path.resolve('packages/test-fixtures/openapi/inventario-openapi3.json');
  const rawOpenApi = fs.readFileSync(fixturePath, 'utf-8');
  const report = ImportExportService.importData(rawOpenApi);

  assert.equal(report.sourceFormat, 'openapi.v3');
  assert.equal(report.collection.metadata.name, 'Inventario Microservicio API');
  assert.equal(report.collection.requests.length, 2);
  assert.equal(report.discardedFields.includes('x-malicious-script'), true);
});

async function run() {
  console.log('=== Ejecutando Pruebas Unitarias (ElTransportador) ===');
  let passed = 0;
  for (const t of tests) {
    await t.fn();
    passed += 1;
    console.log(`  ✓ [UNIT] ${t.name}`);
  }
  console.log(`Resultado Pruebas Unitarias: ${passed}/${tests.length} exitosas.\n`);
}

run().catch((err) => {
  console.error('Fallo en pruebas unitarias:', err);
  process.exit(1);
});
