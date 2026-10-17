/**
 * Ejecutor Secuencial de Flujos de Colecciones — ElTransportador v1.0.1
 * Archivo: scripts/core-engine/flow-runner.mjs
 */
import { executeHttpRequest } from "./http-executor.mjs";

export async function runCollectionFlow(collection, options = {}) {
  const startTime = performance.now();
  const runtimeVars = { ...(options.initialRuntimeVars || {}) };
  const collectionVars = {};
  for (const v of collection.variables || []) {
    if (v && v.enabled && !v.isSecret) {
      collectionVars[v.key] = v.value;
    }
  }
  const environmentVars = { ...(options.environmentVars || {}) };
  const stopOnFailure = options.stopOnFailure ?? false;

  const stepResults = [];
  let totalAssertions = 0;
  let passedAssertions = 0;
  let failedAssertions = 0;
  let allPassed = true;

  for (const reqSpec of collection.requests || []) {
    const resp = await executeHttpRequest(reqSpec, {
      runtimeVars,
      environmentVars,
      collectionVars,
      vault: options.vault || null,
    });

    for (const [extKey, extVal] of Object.entries(resp.extractedVariables || {})) {
      runtimeVars[extKey] = extVal;
    }

    const reqPassed = !resp.error && resp.assertionResults.every((a) => a.passed);

    for (const a of resp.assertionResults) {
      totalAssertions += 1;
      if (a.passed) passedAssertions += 1;
      else failedAssertions += 1;
    }

    if (!reqPassed) {
      allPassed = false;
    }

    stepResults.push({
      requestId: reqSpec.id,
      requestName: reqSpec.name,
      method: reqSpec.method,
      url: reqSpec.url,
      status: resp.status,
      durationMs: resp.durationMs,
      passed: reqPassed,
      assertionResults: resp.assertionResults,
      extractedVariables: resp.extractedVariables,
      error: resp.error,
    });

    if (!reqPassed && stopOnFailure) {
      break;
    }
  }

  return {
    collectionId: collection.metadata?.id,
    collectionName: collection.metadata?.name,
    timestamp: new Date().toISOString(),
    totalDurationMs: Math.max(1, Math.round(performance.now() - startTime)),
    totalRequests: stepResults.length,
    totalAssertions,
    passedAssertions,
    failedAssertions,
    allPassed,
    finalRuntimeVars: runtimeVars,
    steps: stepResults,
  };
}
