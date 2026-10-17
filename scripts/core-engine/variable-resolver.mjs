/**
 * Interpolador Determinista de Variables y Secretos — ElTransportador v1.0.1
 * Archivo: scripts/core-engine/variable-resolver.mjs
 */
import { ENV_PREFIX } from "./constants.mjs";

export class VariableResolver {
  static buildContext({
    runtimeVars = {},
    environmentVars = {},
    collectionVars = {},
    globalEnv = process.env,
  } = {}) {
    const globalEnvVars = {};
    for (const [k, v] of Object.entries(globalEnv || {})) {
      if (k.startsWith(ENV_PREFIX) && typeof v === 'string') {
        globalEnvVars[k.slice(ENV_PREFIX.length)] = v;
      }
    }
    return { runtimeVars, environmentVars, collectionVars, globalEnvVars };
  }

  static resolveValue(key, ctx) {
    if (Object.prototype.hasOwnProperty.call(ctx.runtimeVars, key)) return ctx.runtimeVars[key];
    if (Object.prototype.hasOwnProperty.call(ctx.environmentVars, key)) return ctx.environmentVars[key];
    if (Object.prototype.hasOwnProperty.call(ctx.collectionVars, key)) return ctx.collectionVars[key];
    if (Object.prototype.hasOwnProperty.call(ctx.globalEnvVars, key)) return ctx.globalEnvVars[key];
    return undefined;
  }

  static interpolate(input, ctx, vault, unresolvedSet = new Set(), resolvedSecrets = []) {
    if (typeof input !== 'string' || !input) return '';
    return input.replace(/\$\{\s*(secret:)?([a-zA-Z0-9_.\-]+)\s*\}/g, (fullMatch, secretPrefix, varName) => {
      if (secretPrefix) {
        const secretVal = vault ? vault.getSecret(varName) : null;
        if (secretVal !== null && secretVal !== undefined) {
          resolvedSecrets.push(secretVal);
          return secretVal;
        }
        unresolvedSet.add(`secret:${varName}`);
        return fullMatch;
      }
      const val = VariableResolver.resolveValue(varName, ctx);
      if (val !== undefined) {
        return String(val);
      }
      unresolvedSet.add(varName);
      return fullMatch;
    });
  }
}

