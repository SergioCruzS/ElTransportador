#!/usr/bin/env node
/**
 * Ejecutor Maestro de Verificación de ElTransportador (`scripts/run-all-tests.mjs`)
 * Ejecuta secuencialmente:
 * 1. Análisis estático AST TypeScript/JSX/ESM (`lint-check.mjs`)
 * 2. Pruebas Unitarias (`tests/unit/run-unit-tests.mjs`)
 * 3. Pruebas de Evolución Flows Studio v1.2.0 (`tests/unit/run-flows-studio-v2-tests.mjs`)
 * 4. Pruebas de Integración HTTP + SQLite (`tests/integration/run-integration-tests.mjs`)
 * 5. Pruebas de Seguridad (`tests/security/run-security-tests.mjs`)
 * 6. Auditoría de Seguridad y Cadena de Suministro (`scripts/security-audit.mjs`)
 * 7. Pruebas E2E en Chromium Headless (`tests/e2e/run_e2e_ui_tests.py`)
 */
import { execSync } from 'node:child_process';

const steps = [
  { name: 'Análisis Estático TypeScript/JSX/ESM', cmd: 'node scripts/lint-check.mjs' },
  { name: 'Pruebas Unitarias', cmd: 'node tests/unit/run-unit-tests.mjs' },
  { name: 'Pruebas de Flows Studio Dual v1.2.0 (9 Escenarios)', cmd: 'node tests/unit/run-flows-studio-v2-tests.mjs' },
  { name: 'Pruebas de Integración HTTP y SQLite', cmd: 'node tests/integration/run-integration-tests.mjs' },
  { name: 'Pruebas de Seguridad (SSRF, Redirecciones, Redacción, CSP)', cmd: 'node tests/security/run-security-tests.mjs' },
  { name: 'Auditoría de Cadena de Suministro y SBOM', cmd: 'node scripts/security-audit.mjs' },
  { name: 'Pruebas E2E de Interfaz en Chromium Headless', cmd: 'python3 tests/e2e/run_e2e_ui_tests.py' },
];

for (const step of steps) {
  execSync(step.cmd, { stdio: 'inherit' });
}
console.log('=== TODAS LAS SUITES DE VERIFICACIÓN DE ELTRANSPORTADOR v1.2.0 PASARON EXITOSAMENTE ===');
