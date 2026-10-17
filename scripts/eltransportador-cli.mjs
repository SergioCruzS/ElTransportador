#!/usr/bin/env node
/**
 * ElTransportador CLI (`eltransportador-cli.mjs`)
 * Ejecutor de colecciones por línea de comandos para CI/CD y automatización local.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CollectionStorage,
  SecretVault,
  runCollectionFlow,
  CURRENT_SCHEMA_VERSION,
} from './core-engine.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`ElTransportador CLI v1.0.0 (Esquema eltransportador.collection/v${CURRENT_SCHEMA_VERSION})`);
    console.log('Uso:');
    console.log('  node scripts/eltransportador-cli.mjs run <coleccion.etp.json> [--var k=v] [--secret k=v] [--report salida.json]');
    console.log('  node scripts/eltransportador-cli.mjs validate <coleccion.etp.json>');
    process.exit(0);
  }

  const command = args[0];
  const filePath = args[1];
  if (!filePath) {
    console.error('Error: Debe especificar la ruta del archivo de colección (.etp.json).');
    process.exit(2);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: Archivo no encontrado: ${resolvedPath}`);
    process.exit(2);
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  const collection = CollectionStorage.migrateAndValidate(raw);

  if (command === 'validate') {
    console.log(
      `✓ Colección válida: "${collection.metadata.name}" (${collection.requests.length} solicitudes, esquema v${collection.schemaVersion})`
    );
    process.exit(0);
  }

  if (command === 'run') {
    const envVars = {};
    const tempVaultDir = path.join(path.dirname(resolvedPath), '.eltransportador-local-cli-vault');
    const vault = new SecretVault(tempVaultDir);
    let reportPath = null;

    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--var' && args[i + 1]) {
        const [k, ...rest] = args[i + 1].split('=');
        envVars[k] = rest.join('=');
        i++;
      } else if (args[i] === '--secret' && args[i + 1]) {
        const [k, ...rest] = args[i + 1].split('=');
        vault.setSecret(k, rest.join('='));
        i++;
      } else if (args[i] === '--report' && args[i + 1]) {
        reportPath = path.resolve(args[i + 1]);
        i++;
      }
    }

    const report = await runCollectionFlow(collection, {
      environmentVars: envVars,
      vault,
    });

    console.log(`\n=== ElTransportador CLI — Ejecución de Colección: ${report.collectionName} ===`);
    for (const step of report.steps) {
      const badge = step.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`  [${badge}] ${step.method} ${step.requestName} -> HTTP ${step.status} (${step.durationMs} ms)`);
      for (const ast of step.assertionResults) {
        console.log(`         ${ast.passed ? '✓' : '✗'} ${ast.message}`);
      }
    }
    console.log(
      `Resumen: ${report.passedAssertions}/${report.totalAssertions} aserciones exitosas en ${report.totalDurationMs} ms.\n`
    );

    if (reportPath) {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    }
    fs.rmSync(tempVaultDir, { recursive: true, force: true });
    process.exit(report.allPassed ? 0 : 1);
  }

  console.error(`Comando desconocido: ${command}`);
  process.exit(2);
}

main().catch((err) => {
  console.error('Error fatal en CLI:', err.message);
  process.exit(2);
});
