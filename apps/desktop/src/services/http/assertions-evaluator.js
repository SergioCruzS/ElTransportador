/**
 * Evaluador de Aserciones Declarativas Internacionalizado — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/services/http/assertions-evaluator.js
 */
import { translate } from "../../lang/i18n.js";

export function getByDotPath(obj, pathStr) {
  if (!obj || !pathStr) return undefined;
  return pathStr.split(".").reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
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
        actual = v === undefined ? undefined : String(v);
      } else if (r.target === "body_text") actual = resp.body;

      let passed = false;
      if (r.operator === "equals") passed = actual === r.expected;
      else if (r.operator === "not_equals") passed = actual !== r.expected;
      else if (r.operator === "contains") passed = String(actual || "").includes(r.expected);
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
