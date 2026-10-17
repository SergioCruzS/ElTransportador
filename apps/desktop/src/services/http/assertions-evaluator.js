/**
 * Evaluador de Aserciones Declarativas e Inspector de Rutas JSONPath — ElTransportador v1.2.0
 * Soporta rutas con notación de punto y corchetes para listas/arreglos (ej. `results[0].name`, `items[1][0].id`, `[0].title`, `$.results[0].name`).
 * Archivo: apps/desktop/src/services/http/assertions-evaluator.js
 */
import { translate } from "../../lang/i18n.js";

export function getByDotPath(obj, pathStr) {
  if (obj === null || obj === undefined || pathStr === null || pathStr === undefined) return undefined;
  let clean = String(pathStr).trim();
  if (!clean) return undefined;
  if (clean === "$") return obj;
  if (clean.startsWith("$.")) clean = clean.slice(2);
  else if (clean.startsWith("$[")) clean = clean.slice(1);

  const tokens = [];
  const tokenRegex = /([^\.\[\]]+)|\[(?:\s*(['"])(.*?)\2\s*|\s*([^\]]+?)\s*)\]/g;
  let match;
  while ((match = tokenRegex.exec(clean)) !== null) {
    const prop =
      match[1] !== undefined
        ? match[1].trim()
        : match[3] !== undefined
        ? match[3]
        : (match[4] || "").trim();
    if (prop !== "") tokens.push(prop);
  }
  if (tokens.length === 0) return undefined;

  let cur = obj;
  for (const seg of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (seg === "__proto__" || seg === "constructor" || seg === "prototype") return undefined;
    if (Array.isArray(cur)) {
      if (seg === "length") {
        cur = cur.length;
        continue;
      }
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      const resolvedIdx = idx < 0 ? cur.length + idx : idx;
      cur = cur[resolvedIdx];
    } else if (typeof cur === "string" && seg === "length") {
      cur = cur.length;
    } else if (typeof cur === "object") {
      cur = Object.prototype.hasOwnProperty.call(cur, seg) ? cur[seg] : undefined;
    } else {
      return undefined;
    }
  }
  return cur;
}

export function formatAssertionMessage(ruleResult, lang = "es") {
  const propPart = ruleResult.property ? ` (${ruleResult.property})` : "";
  if (ruleResult.passed) {
    return translate(lang, "errors.assertionPassedMsg", {
      target: ruleResult.target,
      prop: propPart,
      operator: ruleResult.operator,
      expected: ruleResult.expected
    });
  }
  return translate(lang, "errors.assertionFailedMsg", {
    expected: ruleResult.expected,
    actual: ruleResult.actual
  });
}

export function evaluateAssertions(rules, resp, lang = "es") {
  return (rules || [])
    .filter((r) => r.enabled)
    .map((r) => {
      let actual = undefined;
      if (r.target === "status") actual = String(resp.status);
      else if (r.target === "duration_ms") actual = String(resp.durationMs);
      else if (r.target === "header") actual = resp.headers[(r.property || "").toLowerCase()];
      else if (r.target === "json_path") {
        const v = getByDotPath(resp.bodyObj, r.property || "");
        actual =
          v === undefined || v === null
            ? undefined
            : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
      } else if (r.target === "body_text") actual = resp.body;

      let passed = false;
      if (r.operator === "equals") passed = actual === r.expected;
      else if (r.operator === "not_equals") passed = actual !== r.expected;
      else if (r.operator === "contains") passed = String(actual || "").includes(r.expected);
      else if (r.operator === "starts_with") passed = String(actual || "").startsWith(r.expected);
      else if (r.operator === "ends_with") passed = String(actual || "").endsWith(r.expected);
      else if (r.operator === "exists") passed = actual !== undefined;
      else if (r.operator === "not_exists") passed = actual === undefined;
      else if (r.operator === "less_than") passed = Number(actual) < Number(r.expected);
      else if (r.operator === "greater_than") passed = Number(actual) > Number(r.expected);

      const actualStr = actual === undefined ? "<undefined>" : actual;
      const base = {
        ruleId: r.id,
        passed,
        target: r.target,
        property: r.property,
        operator: r.operator,
        expected: r.expected,
        actual: actualStr
      };
      return {
        ...base,
        message: formatAssertionMessage(base, lang)
      };
    });
}
