//! Capa de Aplicación de ElTransportador (`application/`).
//! Orquesta la interpolación de variables con precedencia determinista, la evaluación de aserciones
//! y la importación/exportación de colecciones.

use crate::domain::{AssertionResult, AssertionRule, HttpResponseData, ENV_PREFIX};
use crate::security::SecretVault;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;

pub struct VariableResolutionContext {
    pub runtime_vars: HashMap<String, String>,
    pub environment_vars: HashMap<String, String>,
    pub collection_vars: HashMap<String, String>,
    pub global_env_vars: HashMap<String, String>,
}

impl VariableResolutionContext {
    pub fn from_layers(
        runtime_vars: HashMap<String, String>,
        environment_vars: HashMap<String, String>,
        collection_vars: HashMap<String, String>,
    ) -> Self {
        let mut global_env_vars = HashMap::new();
        for (k, v) in std::env::vars() {
            if let Some(stripped) = k.strip_prefix(ENV_PREFIX) {
                global_env_vars.insert(stripped.to_string(), v);
            }
        }
        Self {
            runtime_vars,
            environment_vars,
            collection_vars,
            global_env_vars,
        }
    }

    /// Precedencia determinista:
    /// 1. Variables de flujo en tiempo de ejecución (`runtime_vars`)
    /// 2. Variables del entorno activo (`environment_vars`)
    /// 3. Variables de la colección (`collection_vars`)
    /// 4. Variables de entorno del sistema con prefijo `ELTRANSPORTADOR_` (`global_env_vars`)
    pub fn resolve_var(&self, name: &str) -> Option<&String> {
        self.runtime_vars
            .get(name)
            .or_else(|| self.environment_vars.get(name))
            .or_else(|| self.collection_vars.get(name))
            .or_else(|| self.global_env_vars.get(name))
    }
}

pub struct VariableResolver {
    token_regex: Regex,
}

impl VariableResolver {
    pub fn new() -> Self {
        Self {
            token_regex: Regex::new(r"\$\{\s*(secret:)?([a-zA-Z0-9_.\-]+)\s*\}").unwrap(),
        }
    }

    pub fn interpolate(
        &self,
        input: &str,
        ctx: &VariableResolutionContext,
        vault: &SecretVault,
        unresolved: &mut Vec<String>,
        resolved_secrets: &mut Vec<String>,
    ) -> String {
        self.token_regex
            .replace_all(input, |caps: &regex::Captures| {
                let is_secret = caps.get(1).is_some();
                let key = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                if is_secret {
                    if let Some(secret_val) = vault.get_secret(key) {
                        resolved_secrets.push(secret_val.clone());
                        secret_val
                    } else {
                        let marker = format!("secret:{}", key);
                        if !unresolved.contains(&marker) {
                            unresolved.push(marker);
                        }
                        caps.get(0).unwrap().as_str().to_string()
                    }
                } else if let Some(val) = ctx.resolve_var(key) {
                    val.clone()
                } else {
                    if !unresolved.contains(&key.to_string()) {
                        unresolved.push(key.to_string());
                    }
                    caps.get(0).unwrap().as_str().to_string()
                }
            })
            .to_string()
    }
}

pub struct AssertionEvaluator;

impl AssertionEvaluator {
    pub fn extract_json_path(root: &Value, path: &str) -> Option<Value> {
        let mut current = root;
        for segment in path.split('.').filter(|s| !s.is_empty()) {
            match current {
                Value::Object(map) => {
                    current = map.get(segment)?;
                }
                Value::Array(arr) => {
                    let idx: usize = segment.parse().ok()?;
                    current = arr.get(idx)?;
                }
                _ => return None,
            }
        }
        Some(current.clone())
    }

    pub fn evaluate_all(
        rules: &[AssertionRule],
        response: &HttpResponseData,
    ) -> Vec<AssertionResult> {
        let parsed_json: Option<Value> = serde_json::from_str(&response.body).ok();
        let mut results = Vec::new();

        for rule in rules.iter().filter(|r| r.enabled) {
            let (actual_opt, actual_type) = match rule.target.as_str() {
                "status" => (Some(response.status.to_string()), "number".to_string()),
                "duration_ms" => (Some(response.duration_ms.to_string()), "number".to_string()),
                "body_text" => (Some(response.body.clone()), "string".to_string()),
                "header" => {
                    let prop = rule.property.as_deref().unwrap_or("").to_ascii_lowercase();
                    let found = response
                        .headers
                        .iter()
                        .find(|(k, _)| k.to_ascii_lowercase() == prop)
                        .map(|(_, v)| v.clone());
                    (found, "string".to_string())
                }
                "json_path" => {
                    let prop = rule.property.as_deref().unwrap_or("");
                    if let Some(ref root) = parsed_json {
                        if let Some(val) = Self::extract_json_path(root, prop) {
                            let t = match val {
                                Value::Null => "null",
                                Value::Bool(_) => "boolean",
                                Value::Number(_) => "number",
                                Value::String(_) => "string",
                                Value::Array(_) => "array",
                                Value::Object(_) => "object",
                            };
                            let str_val = match val {
                                Value::String(s) => s,
                                other => other.to_string(),
                            };
                            (Some(str_val), t.to_string())
                        } else {
                            (None, "undefined".to_string())
                        }
                    } else {
                        (None, "invalid_json".to_string())
                    }
                }
                _ => (None, "unknown".to_string()),
            };

            let actual_str = actual_opt
                .clone()
                .unwrap_or_else(|| "<undefined>".to_string());
            let passed = match rule.operator.as_str() {
                "exists" => actual_opt.is_some(),
                "not_exists" => actual_opt.is_none(),
                "equals" => actual_opt.as_deref() == Some(rule.expected.as_str()),
                "not_equals" => actual_opt.as_deref() != Some(rule.expected.as_str()),
                "contains" => actual_opt
                    .as_deref()
                    .map(|s| s.contains(&rule.expected))
                    .unwrap_or(false),
                "less_than" => {
                    let a = actual_str.parse::<f64>().ok();
                    let b = rule.expected.parse::<f64>().ok();
                    a.zip(b).map(|(x, y)| x < y).unwrap_or(false)
                }
                "greater_than" => {
                    let a = actual_str.parse::<f64>().ok();
                    let b = rule.expected.parse::<f64>().ok();
                    a.zip(b).map(|(x, y)| x > y).unwrap_or(false)
                }
                "is_type" => actual_type == rule.expected.to_ascii_lowercase(),
                _ => false,
            };

            let message = if passed {
                format!("OK: {} {} {}", rule.target, rule.operator, rule.expected)
            } else {
                format!(
                    "Fallo en {}: esperado ({} '{}'), obtenido '{}'",
                    rule.target, rule.operator, rule.expected, actual_str
                )
            };

            results.push(AssertionResult {
                rule_id: rule.id.clone(),
                passed,
                target: rule.target.clone(),
                property: rule.property.clone(),
                operator: rule.operator.clone(),
                expected: rule.expected.clone(),
                actual: actual_str,
                message,
            });
        }

        results
    }
}
