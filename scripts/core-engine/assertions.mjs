/**
 * Evaluador Declarativo de Aserciones y Extractor JSONPath — ElTransportador v1.2.0
 * Soporta rutas con notación de punto y corchetes para listas/arreglos (ej. `results[0].name`, `items[1][0].id`, `[0].title`, `$.results[0].name`).
 * Archivo: scripts/core-engine/assertions.mjs
 */
export class AssertionEvaluator {
  static getJsonPath(obj, pathStr) {
    if (obj === null || obj === undefined || typeof obj !== 'object' || !pathStr) return undefined;
    let clean = String(pathStr).trim();
    if (!clean) return undefined;
    if (clean === '$') return obj;
    if (clean.startsWith('$.')) clean = clean.slice(2);
    else if (clean.startsWith('$[')) clean = clean.slice(1);

    const tokens = [];
    const tokenRegex = /([^\.\[\]]+)|\[(?:\s*(['"])(.*?)\2\s*|\s*([^\]]+?)\s*)\]/g;
    let match;
    while ((match = tokenRegex.exec(clean)) !== null) {
      const prop =
        match[1] !== undefined
          ? match[1].trim()
          : match[3] !== undefined
          ? match[3]
          : (match[4] || '').trim();
      if (prop !== '') tokens.push(prop);
    }
    if (tokens.length === 0) return undefined;

    let cur = obj;
    for (const seg of tokens) {
      if (cur === null || cur === undefined) return undefined;
      if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') return undefined;
      if (Array.isArray(cur)) {
        if (seg === 'length') {
          cur = cur.length;
          continue;
        }
        const idx = Number(seg);
        if (!Number.isInteger(idx)) return undefined;
        const resolvedIdx = idx < 0 ? cur.length + idx : idx;
        cur = cur[resolvedIdx];
      } else if (typeof cur === 'string' && seg === 'length') {
        cur = cur.length;
      } else if (typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, seg)) {
        cur = cur[seg];
      } else {
        return undefined;
      }
    }
    return cur;
  }

  static detectType(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (Array.isArray(val)) return 'array';
    return typeof val;
  }

  static evaluateAll(rules = [], response) {
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(response.body);
    } catch {
      parsedJson = null;
    }

    const results = [];
    for (const rule of rules) {
      if (!rule || !rule.enabled) continue;
      let actualVal = undefined;
      let actualType = 'undefined';

      if (rule.target === 'status') {
        actualVal = response.status;
        actualType = 'number';
      } else if (rule.target === 'duration_ms') {
        actualVal = response.durationMs;
        actualType = 'number';
      } else if (rule.target === 'body_text') {
        actualVal = response.body;
        actualType = 'string';
      } else if (rule.target === 'header') {
        const targetHeader = String(rule.property || '').toLowerCase();
        const entry = Object.entries(response.headers || {}).find(
          ([k]) => k.toLowerCase() === targetHeader
        );
        if (entry) {
          actualVal = entry[1];
          actualType = 'string';
        }
      } else if (rule.target === 'json_path') {
        if (parsedJson !== null) {
          actualVal = AssertionEvaluator.getJsonPath(parsedJson, rule.property || '');
          actualType = AssertionEvaluator.detectType(actualVal);
        } else {
          actualType = 'invalid_json';
        }
      }

      const actualStr =
        actualVal === undefined
          ? '<undefined>'
          : typeof actualVal === 'object'
          ? JSON.stringify(actualVal)
          : String(actualVal);

      let passed = false;
      const expectedStr = String(rule.expected ?? '');

      switch (rule.operator) {
        case 'exists':
          passed = actualVal !== undefined && actualVal !== null;
          break;
        case 'not_exists':
          passed = actualVal === undefined || actualVal === null;
          break;
        case 'equals':
          passed = actualStr === expectedStr;
          break;
        case 'not_equals':
          passed = actualStr !== expectedStr;
          break;
        case 'contains':
          passed = actualVal !== undefined && actualStr.includes(expectedStr);
          break;
        case 'less_than':
          passed = Number(actualVal) < Number(expectedStr);
          break;
        case 'greater_than':
          passed = Number(actualVal) > Number(expectedStr);
          break;
        case 'is_type':
          passed = actualType.toLowerCase() === expectedStr.toLowerCase();
          break;
        default:
          passed = false;
      }

      results.push({
        ruleId: rule.id,
        passed,
        target: rule.target,
        property: rule.property,
        operator: rule.operator,
        expected: expectedStr,
        actual: actualStr,
        message: passed
          ? `OK: ${rule.target}${rule.property ? ` (${rule.property})` : ''} ${rule.operator} ${expectedStr}`
          : `Fallo en ${rule.target}${rule.property ? ` (${rule.property})` : ''}: esperado [${rule.operator} '${expectedStr}'], obtenido '${actualStr}'`,
      });
    }

    return results;
  }

  static extractVariables(extractions = [], response) {
    const extracted = {};
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(response.body);
    } catch {
      parsedJson = null;
    }

    for (const ext of extractions) {
      if (!ext || !ext.enabled || !ext.variableName) continue;
      if (ext.source === 'status') {
        extracted[ext.variableName] = String(response.status);
      } else if (ext.source === 'header') {
        const entry = Object.entries(response.headers || {}).find(
          ([k]) => k.toLowerCase() === String(ext.path || '').toLowerCase()
        );
        if (entry) extracted[ext.variableName] = String(entry[1]);
      } else if (ext.source === 'json_path' && parsedJson !== null) {
        const val = AssertionEvaluator.getJsonPath(parsedJson, ext.path || '');
        if (val !== undefined && val !== null) {
          extracted[ext.variableName] = typeof val === 'object' ? JSON.stringify(val) : String(val);
        }
      }
    }
    return extracted;
  }
}
