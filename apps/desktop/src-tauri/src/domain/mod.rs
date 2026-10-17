//! Capa de Dominio de ElTransportador (`com.eltransportador.desktop`).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;
pub const SCHEMA_URI: &str = "https://eltransportador.dev/schemas/collection-v1.json";
pub const ENV_PREFIX: &str = "ELTRANSPORTADOR_";
pub const REDACTED_PLACEHOLDER: &str = "[REDACTED:ELTRANSPORTADOR_SECRET]";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    #[default]
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

impl HttpMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Delete => "DELETE",
            HttpMethod::Head => "HEAD",
            HttpMethod::Options => "OPTIONS",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct KeyValueItem {
    pub id: String,
    pub key: String,
    pub value: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub is_secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AuthConfig {
    #[serde(rename = "type")]
    pub auth_type: String,
    pub bearer_token: Option<String>,
    pub basic_username: Option<String>,
    pub basic_password: Option<String>,
    pub api_key_name: Option<String>,
    pub api_key_value: Option<String>,
    pub api_key_in: Option<String>,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            auth_type: "none".to_string(),
            bearer_token: None,
            basic_username: None,
            basic_password: None,
            api_key_name: None,
            api_key_value: None,
            api_key_in: Some("header".to_string()),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MultipartField {
    pub id: String,
    pub key: String,
    pub value: String,
    pub content_type: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RequestBodySpec {
    pub mode: String,
    pub raw: Option<String>,
    pub urlencoded: Vec<KeyValueItem>,
    pub multipart: Vec<MultipartField>,
}

impl Default for RequestBodySpec {
    fn default() -> Self {
        Self {
            mode: "none".to_string(),
            raw: None,
            urlencoded: Vec::new(),
            multipart: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RequestExecutionSettings {
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub max_redirects: usize,
    pub verify_tls: bool,
    pub max_response_bytes: usize,
    pub proxy_url: Option<String>,
    pub allow_private_network_redirects: bool,
}

impl Default for RequestExecutionSettings {
    fn default() -> Self {
        Self {
            timeout_ms: 15_000,
            follow_redirects: true,
            max_redirects: 5,
            verify_tls: true,
            max_response_bytes: 10 * 1024 * 1024,
            proxy_url: None,
            allow_private_network_redirects: false,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AssertionRule {
    pub id: String,
    pub enabled: bool,
    pub target: String,
    pub property: Option<String>,
    pub operator: String,
    pub expected: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct VariableExtractionRule {
    pub id: String,
    pub enabled: bool,
    pub variable_name: String,
    pub source: String,
    pub path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HttpRequestSpec {
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    pub method: HttpMethod,
    pub url: String,
    pub params: Vec<KeyValueItem>,
    pub headers: Vec<KeyValueItem>,
    pub auth: AuthConfig,
    pub body: RequestBodySpec,
    pub settings: RequestExecutionSettings,
    pub assertions: Vec<AssertionRule>,
    pub extractions: Vec<VariableExtractionRule>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RedirectHop {
    pub hop: usize,
    pub from_url: String,
    pub to_url: String,
    pub status: u16,
    pub cross_origin: bool,
    pub stripped_headers: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CookieInfo {
    pub name: String,
    pub value: String,
    pub domain: Option<String>,
    pub path: Option<String>,
    pub http_only: bool,
    pub secure: bool,
    pub same_site: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AssertionResult {
    pub rule_id: String,
    pub passed: bool,
    pub target: String,
    pub property: Option<String>,
    pub operator: String,
    pub expected: String,
    pub actual: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StructuredError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
    pub recoverable: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HttpResponseData {
    pub request_id: String,
    pub status: u16,
    pub status_text: String,
    pub duration_ms: u64,
    pub size_bytes: usize,
    pub headers: HashMap<String, String>,
    pub cookies: Vec<CookieInfo>,
    pub body: String,
    pub is_json: bool,
    pub truncated: bool,
    pub redirects: Vec<RedirectHop>,
    pub unresolved_variables: Vec<String>,
    pub assertion_results: Vec<AssertionResult>,
    pub extracted_variables: HashMap<String, String>,
    pub timestamp: String,
    pub error: Option<StructuredError>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CollectionVariable {
    pub key: String,
    pub value: String,
    pub enabled: bool,
    pub is_secret: bool,
    pub secret_ref: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CollectionFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CollectionMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    pub app_version: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CollectionDefaults {
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub max_redirects: usize,
    pub verify_tls: bool,
    pub headers: Vec<KeyValueItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CollectionFile {
    #[serde(rename = "$schema")]
    pub schema: String,
    pub schema_version: u32,
    pub kind: String,
    pub metadata: CollectionMetadata,
    pub defaults: CollectionDefaults,
    pub variables: Vec<CollectionVariable>,
    pub folders: Vec<CollectionFolder>,
    pub requests: Vec<HttpRequestSpec>,
}

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("URL inválida: {0}")]
    InvalidUrl(String),
    #[error("Esquema de protocolo no permitido ({0}). Solo se permite http:// y https://")]
    BlockedScheme(String),
    #[error("Redirección bloqueada por política anti-SSRF hacia red privada o metadata: {0}")]
    SsrfRedirectBlocked(String),
    #[error("Límite máximo de redirecciones excedido ({0})")]
    MaxRedirectsExceeded(usize),
    #[error("Tiempo de espera agotado tras {0} ms")]
    Timeout(u64),
    #[error("Solicitud cancelada por el usuario")]
    Cancelled,
    #[error("Error de transporte o TLS: {0}")]
    TransportError(String),
    #[error("Respuesta excede el límite seguro de memoria ({0} bytes)")]
    ResponseTooLarge(usize),
    #[error("Error de almacenamiento o esquema: {0}")]
    StorageError(String),
}

impl DomainError {
    pub fn to_structured(&self) -> StructuredError {
        match self {
            DomainError::InvalidUrl(msg) => StructuredError {
                code: "INVALID_URL".into(),
                message: self.to_string(),
                details: Some(msg.clone()),
                recoverable: true,
            },
            DomainError::BlockedScheme(scheme) => StructuredError {
                code: "BLOCKED_SCHEME".into(),
                message: self.to_string(),
                details: Some(format!("Esquema rechazado: {}", scheme)),
                recoverable: true,
            },
            DomainError::SsrfRedirectBlocked(target) => StructuredError {
                code: "SSRF_REDIRECT_BLOCKED".into(),
                message: self.to_string(),
                details: Some(target.clone()),
                recoverable: true,
            },
            DomainError::MaxRedirectsExceeded(max) => StructuredError {
                code: "MAX_REDIRECTS_EXCEEDED".into(),
                message: self.to_string(),
                details: Some(format!("Máximo configurado: {}", max)),
                recoverable: true,
            },
            DomainError::Timeout(_) => StructuredError {
                code: "TIMEOUT".into(),
                message: self.to_string(),
                details: None,
                recoverable: true,
            },
            DomainError::Cancelled => StructuredError {
                code: "CANCELLED".into(),
                message: self.to_string(),
                details: None,
                recoverable: true,
            },
            DomainError::TransportError(msg) => StructuredError {
                code: "NETWORK_ERROR".into(),
                message: self.to_string(),
                details: Some(msg.clone()),
                recoverable: true,
            },
            DomainError::ResponseTooLarge(limit) => StructuredError {
                code: "RESPONSE_TOO_LARGE".into(),
                message: self.to_string(),
                details: Some(format!("Límite configurado: {} bytes", limit)),
                recoverable: true,
            },
            DomainError::StorageError(msg) => StructuredError {
                code: "STORAGE_ERROR".into(),
                message: self.to_string(),
                details: Some(msg.clone()),
                recoverable: false,
            },
        }
    }
}
