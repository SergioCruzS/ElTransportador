//! Capa de Seguridad de ElTransportador (`security/`).
//! - Sin tokens ni secretos predefinidos por defecto en `SecretVault::new()`.
//! - Validación anti-SSRF por cada salto de redirección (`validate_redirect_target`).
//! - Detección de cambio de origen (`is_same_origin`) para purgar credenciales en redirecciones HTTP 3xx.

use crate::domain::{DomainError, HttpRequestSpec, REDACTED_PLACEHOLDER};
use regex::Regex;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use url::Url;

pub struct SecretRedactor {
    known_secrets: Vec<String>,
    bearer_regex: Regex,
    basic_regex: Regex,
    url_cred_regex: Regex,
}

impl SecretRedactor {
    pub fn new(secrets: Vec<String>) -> Self {
        let filtered: Vec<String> = secrets
            .into_iter()
            .filter(|s| s.trim().len() >= 4)
            .collect();
        Self {
            known_secrets: filtered,
            bearer_regex: Regex::new(r"(?i)(Bearer\s+)[A-Za-z0-9\-._~+/]+=*").unwrap(),
            basic_regex: Regex::new(r"(?i)(Basic\s+)[A-Za-z0-9+/]+=*").unwrap(),
            url_cred_regex: Regex::new(r"(?i)(https?://[^/:@\s]+:)([^@\s]+)(@)").unwrap(),
        }
    }

    pub fn redact_text(&self, input: &str) -> String {
        let mut out = input.to_string();
        for secret in &self.known_secrets {
            if !secret.is_empty() && out.contains(secret) {
                out = out.replace(secret, REDACTED_PLACEHOLDER);
            }
        }
        out = self
            .bearer_regex
            .replace_all(&out, format!("${{1}}{}", REDACTED_PLACEHOLDER))
            .to_string();
        out = self
            .basic_regex
            .replace_all(&out, format!("${{1}}{}", REDACTED_PLACEHOLDER))
            .to_string();
        out = self
            .url_cred_regex
            .replace_all(&out, format!("${{1}}{}${{3}}", REDACTED_PLACEHOLDER))
            .to_string();
        out
    }

    pub fn is_sensitive_header_name(name: &str) -> bool {
        let lower = name.trim().to_ascii_lowercase();
        matches!(
            lower.as_str(),
            "authorization"
                | "proxy-authorization"
                | "cookie"
                | "set-cookie"
                | "x-api-key"
                | "api-key"
                | "x-auth-token"
                | "x-secret-key"
        )
    }

    pub fn sanitize_request_for_history(&self, req: &HttpRequestSpec) -> HttpRequestSpec {
        let mut clean = req.clone();
        clean.url = self.redact_text(&clean.url);
        for h in &mut clean.headers {
            if h.is_secret || Self::is_sensitive_header_name(&h.key) {
                h.value = REDACTED_PLACEHOLDER.to_string();
            } else {
                h.value = self.redact_text(&h.value);
            }
        }
        for p in &mut clean.params {
            if p.is_secret {
                p.value = REDACTED_PLACEHOLDER.to_string();
            } else {
                p.value = self.redact_text(&p.value);
            }
        }
        if clean.auth.bearer_token.is_some() {
            clean.auth.bearer_token = Some(REDACTED_PLACEHOLDER.to_string());
        }
        if clean.auth.basic_password.is_some() {
            clean.auth.basic_password = Some(REDACTED_PLACEHOLDER.to_string());
        }
        if clean.auth.api_key_value.is_some() {
            clean.auth.api_key_value = Some(REDACTED_PLACEHOLDER.to_string());
        }
        if let Some(raw) = &clean.body.raw {
            clean.body.raw = Some(self.redact_text(raw));
        }
        clean
    }
}

pub struct UrlSecurityValidator;

impl UrlSecurityValidator {
    pub fn validate_request_url(raw_url: &str) -> Result<Url, DomainError> {
        let trimmed = raw_url.trim();
        if trimmed.is_empty() {
            return Err(DomainError::InvalidUrl(
                "La URL no puede estar vacía".into(),
            ));
        }
        let parsed = Url::parse(trimmed).map_err(|e| DomainError::InvalidUrl(e.to_string()))?;
        let scheme = parsed.scheme().to_ascii_lowercase();
        if scheme != "http" && scheme != "https" {
            return Err(DomainError::BlockedScheme(scheme));
        }
        let host = parsed
            .host_str()
            .ok_or_else(|| DomainError::InvalidUrl("La URL carece de un host válido".into()))?;

        // Bloquear siempre el servicio de Cloud Metadata (169.254.169.254 / metadata.google.internal)
        if Self::is_cloud_metadata_host(host) {
            return Err(DomainError::SsrfRedirectBlocked(format!(
                "Acceso bloqueado a endpoint de Cloud Metadata ({})",
                host
            )));
        }
        Ok(parsed)
    }

    pub fn validate_redirect_target(previous_url: &Url, next_url: &Url) -> Result<(), DomainError> {
        let scheme = next_url.scheme().to_ascii_lowercase();
        if scheme != "http" && scheme != "https" {
            return Err(DomainError::BlockedScheme(scheme));
        }
        let next_host = next_url
            .host_str()
            .ok_or_else(|| DomainError::InvalidUrl("Redirección sin host válido".into()))?;

        if Self::is_cloud_metadata_host(next_host) {
            return Err(DomainError::SsrfRedirectBlocked(format!(
                "Redirección SSRF bloqueada hacia Cloud Metadata ({})",
                next_host
            )));
        }

        let prev_host = previous_url.host_str().unwrap_or("");
        let prev_is_private = Self::is_private_or_metadata_host(prev_host);
        let next_is_private = Self::is_private_or_metadata_host(next_host);

        // Si el origen era público y redirige a una red interna/loopback/privada, bloquear salto SSRF
        if !prev_is_private && next_is_private {
            return Err(DomainError::SsrfRedirectBlocked(format!(
                "Redirección cross-zone bloqueada desde host público ({}) hacia host interno ({})",
                prev_host, next_host
            )));
        }
        Ok(())
    }

    pub fn is_same_origin(a: &Url, b: &Url) -> bool {
        a.scheme().eq_ignore_ascii_case(b.scheme())
            && a.host_str().map(|h| h.to_ascii_lowercase())
                == b.host_str().map(|h| h.to_ascii_lowercase())
            && a.port_or_known_default() == b.port_or_known_default()
    }

    pub fn is_cloud_metadata_host(host: &str) -> bool {
        let lower = host
            .trim()
            .trim_matches(|c| c == '[' || c == ']')
            .to_ascii_lowercase();
        lower == "169.254.169.254"
            || lower == "metadata.google.internal"
            || lower == "100.100.100.200"
            || lower == "fd00:ec2::254"
    }

    pub fn is_private_or_metadata_host(host: &str) -> bool {
        let lower = host
            .trim()
            .trim_matches(|c| c == '[' || c == ']')
            .to_ascii_lowercase();
        if Self::is_cloud_metadata_host(&lower)
            || lower == "localhost"
            || lower.ends_with(".local")
            || lower.ends_with(".internal")
        {
            return true;
        }
        if let Ok(ip) = lower.parse::<IpAddr>() {
            return match ip {
                IpAddr::V4(v4) => {
                    v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
                }
                IpAddr::V6(v6) => {
                    v6.is_loopback()
                        || v6.is_unspecified()
                        || (v6.segments()[0] & 0xfe00) == 0xfc00
                        || (v6.segments()[0] & 0xffc0) == 0xfe80
                }
            };
        }
        false
    }
}

pub struct SecretVault {
    store: Mutex<HashMap<String, String>>,
}

impl SecretVault {
    pub fn new() -> Self {
        // Inicia completamente vacía: sin tokens ni secretos predefinidos por defecto
        Self {
            store: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_secret(&self, key: &str, secret_value: &str) -> Result<(), DomainError> {
        if let Ok(mut guard) = self.store.lock() {
            guard.insert(key.to_string(), secret_value.to_string());
        }
        Ok(())
    }

    pub fn get_secret(&self, key: &str) -> Option<String> {
        if let Ok(guard) = self.store.lock() {
            return guard.get(key).cloned();
        }
        None
    }

    pub fn delete_secret(&self, key: &str) -> Result<(), DomainError> {
        if let Ok(mut guard) = self.store.lock() {
            guard.remove(key);
        }
        Ok(())
    }
}
