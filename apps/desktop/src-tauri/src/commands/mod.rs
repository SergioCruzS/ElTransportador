//! Adaptadores explícitos y tipados de Comandos Tauri (`commands/`).
//! Ejecuta peticiones HTTP reales desde el binario nativo con:
//! 1. Validación anti-SSRF en cada salto de redirección (`Policy::none()` + bucle controlado).
//! 2. Purga automática de `Authorization`, `Cookie` y `X-API-Key` en redirecciones cross-origin.
//! 3. Lectura en streaming acotada por `max_response_bytes` (evitando agotamiento de memoria).

use crate::application::{AssertionEvaluator, VariableResolutionContext, VariableResolver};
use crate::domain::{
    CollectionFile, DomainError, HttpRequestSpec, HttpResponseData, RedirectHop, StructuredError,
};
use crate::infrastructure::{ActiveRequestRegistry, AtomicCollectionStorage};
use crate::security::{SecretRedactor, SecretVault, UrlSecurityValidator};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use std::collections::HashMap;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::{Duration, Instant};
use tauri::State;

pub struct AppState {
    pub registry: ActiveRequestRegistry,
    pub workspace_dir: PathBuf,
    pub vault: SecretVault,
}

const DEFAULT_MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024; // 5 MB
const HARD_CAP_RESPONSE_BYTES: usize = 50 * 1024 * 1024; // 50 MB límite absoluto

#[tauri::command]
pub async fn execute_http_request(
    state: State<'_, AppState>,
    request: HttpRequestSpec,
    runtime_vars: Option<HashMap<String, String>>,
    environment_vars: Option<HashMap<String, String>>,
    collection_vars: Option<HashMap<String, String>>,
    secrets: Option<HashMap<String, String>>,
) -> Result<HttpResponseData, StructuredError> {
    let start = Instant::now();
    let timestamp = chrono::Utc::now().to_rfc3339();

    if let Some(sec_map) = secrets {
        for (k, v) in sec_map {
            if !k.trim().is_empty() {
                let _ = state.vault.set_secret(&k, &v);
            }
        }
    }

    let ctx = VariableResolutionContext::from_layers(
        runtime_vars.unwrap_or_default(),
        environment_vars.unwrap_or_default(),
        collection_vars.unwrap_or_default(),
    );
    let resolver = VariableResolver::new();
    let mut unresolved = Vec::new();
    let mut resolved_secrets = Vec::new();

    let raw_url = resolver.interpolate(
        &request.url,
        &ctx,
        &state.vault,
        &mut unresolved,
        &mut resolved_secrets,
    );

    let mut current_url = match UrlSecurityValidator::validate_request_url(&raw_url) {
        Ok(u) => u,
        Err(e) => {
            return Ok(HttpResponseData {
                request_id: request.id,
                status: 0,
                status_text: "Validation Error".into(),
                duration_ms: start.elapsed().as_millis() as u64,
                size_bytes: 0,
                headers: HashMap::new(),
                cookies: Vec::new(),
                body: String::new(),
                is_json: false,
                truncated: false,
                redirects: Vec::new(),
                unresolved_variables: unresolved,
                assertion_results: Vec::new(),
                extracted_variables: HashMap::new(),
                timestamp,
                error: Some(e.to_structured()),
            });
        }
    };

    {
        let mut pairs = current_url.query_pairs_mut();
        for p in request
            .params
            .iter()
            .filter(|p| p.enabled && !p.key.trim().is_empty())
        {
            let k = resolver.interpolate(
                &p.key,
                &ctx,
                &state.vault,
                &mut unresolved,
                &mut resolved_secrets,
            );
            let v = resolver.interpolate(
                &p.value,
                &ctx,
                &state.vault,
                &mut unresolved,
                &mut resolved_secrets,
            );
            pairs.append_pair(&k, &v);
        }
    }

    let timeout_ms = if request.settings.timeout_ms > 0 {
        request.settings.timeout_ms
    } else {
        15_000
    };

    let max_response_bytes = if request.settings.max_response_bytes > 0 {
        (request.settings.max_response_bytes as usize).min(HARD_CAP_RESPONSE_BYTES)
    } else {
        DEFAULT_MAX_RESPONSE_BYTES
    };

    // Desactivar redirecciones automáticas en reqwest para validar cada salto manualmente contra SSRF y fugas cross-origin
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .redirect(reqwest::redirect::Policy::none())
        .danger_accept_invalid_certs(!request.settings.verify_tls)
        .build()
        .map_err(|e| DomainError::TransportError(e.to_string()).to_structured())?;

    let mut current_method = Method::from_str(request.method.as_str()).unwrap_or(Method::GET);

    let mut header_map = HeaderMap::new();
    for h in request
        .headers
        .iter()
        .filter(|h| h.enabled && !h.key.trim().is_empty())
    {
        let k = resolver.interpolate(
            &h.key,
            &ctx,
            &state.vault,
            &mut unresolved,
            &mut resolved_secrets,
        );
        let v = resolver.interpolate(
            &h.value,
            &ctx,
            &state.vault,
            &mut unresolved,
            &mut resolved_secrets,
        );
        if let (Ok(hn), Ok(hv)) = (HeaderName::from_str(&k), HeaderValue::from_str(&v)) {
            header_map.insert(hn, hv);
        }
    }

    let mut basic_auth_creds: Option<(String, String)> = None;
    match request.auth.auth_type.as_str() {
        "bearer" => {
            if let Some(ref tok) = request.auth.bearer_token {
                let resolved_tok = resolver.interpolate(
                    tok,
                    &ctx,
                    &state.vault,
                    &mut unresolved,
                    &mut resolved_secrets,
                );
                if !resolved_tok.is_empty() {
                    if let Ok(hv) = HeaderValue::from_str(&format!("Bearer {}", resolved_tok)) {
                        header_map.insert(reqwest::header::AUTHORIZATION, hv);
                    }
                }
            }
        }
        "basic" => {
            let u = request.auth.basic_username.clone().unwrap_or_default();
            let p = request.auth.basic_password.clone().unwrap_or_default();
            let ru = resolver.interpolate(
                &u,
                &ctx,
                &state.vault,
                &mut unresolved,
                &mut resolved_secrets,
            );
            let rp = resolver.interpolate(
                &p,
                &ctx,
                &state.vault,
                &mut unresolved,
                &mut resolved_secrets,
            );
            basic_auth_creds = Some((ru, rp));
        }
        "apikey" => {
            if let (Some(ref k_name), Some(ref k_val)) =
                (&request.auth.api_key_name, &request.auth.api_key_value)
            {
                let rk = resolver.interpolate(
                    k_name,
                    &ctx,
                    &state.vault,
                    &mut unresolved,
                    &mut resolved_secrets,
                );
                let rv = resolver.interpolate(
                    k_val,
                    &ctx,
                    &state.vault,
                    &mut unresolved,
                    &mut resolved_secrets,
                );
                if request.auth.api_key_in.as_deref() == Some("query") {
                    current_url.query_pairs_mut().append_pair(&rk, &rv);
                } else if let (Ok(hn), Ok(hv)) =
                    (HeaderName::from_str(&rk), HeaderValue::from_str(&rv))
                {
                    header_map.insert(hn, hv);
                }
            }
        }
        _ => {}
    }

    let max_redirects = if request.settings.follow_redirects {
        request.settings.max_redirects as usize
    } else {
        0
    };

    let mut redirects = Vec::new();
    let mut hop_count = 0usize;

    let final_resp = loop {
        let mut req_builder = client.request(current_method.clone(), current_url.clone());
        req_builder = req_builder.headers(header_map.clone());

        if let Some((ref ru, ref rp)) = basic_auth_creds {
            req_builder = req_builder.basic_auth(ru, Some(rp));
        }

        if hop_count == 0 && current_method != Method::GET && current_method != Method::HEAD {
            match request.body.mode.as_str() {
                "json" => {
                    if let Some(ref raw) = request.body.raw {
                        let body_str = resolver.interpolate(
                            raw,
                            &ctx,
                            &state.vault,
                            &mut unresolved,
                            &mut resolved_secrets,
                        );
                        req_builder = req_builder
                            .header(
                                reqwest::header::CONTENT_TYPE,
                                "application/json; charset=utf-8",
                            )
                            .body(body_str);
                    }
                }
                "text" => {
                    if let Some(ref raw) = request.body.raw {
                        let body_str = resolver.interpolate(
                            raw,
                            &ctx,
                            &state.vault,
                            &mut unresolved,
                            &mut resolved_secrets,
                        );
                        req_builder = req_builder
                            .header(reqwest::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                            .body(body_str);
                    }
                }
                "urlencoded" => {
                    let mut form_pairs = Vec::new();
                    for item in request
                        .body
                        .urlencoded
                        .iter()
                        .filter(|i| i.enabled && !i.key.trim().is_empty())
                    {
                        let k = resolver.interpolate(
                            &item.key,
                            &ctx,
                            &state.vault,
                            &mut unresolved,
                            &mut resolved_secrets,
                        );
                        let v = resolver.interpolate(
                            &item.value,
                            &ctx,
                            &state.vault,
                            &mut unresolved,
                            &mut resolved_secrets,
                        );
                        form_pairs.push((k, v));
                    }
                    req_builder = req_builder.form(&form_pairs);
                }
                _ => {}
            }
        }

        let resp = match req_builder.send().await {
            Ok(r) => r,
            Err(err) => {
                let duration_ms = start.elapsed().as_millis().max(1) as u64;
                return Ok(HttpResponseData {
                    request_id: request.id,
                    status: 0,
                    status_text: "Network Error".into(),
                    duration_ms,
                    size_bytes: 0,
                    headers: HashMap::new(),
                    cookies: Vec::new(),
                    body: format!(
                        "{{\n  \"error\": \"Error de conexión HTTP\",\n  \"details\": {:?}\n}}",
                        err.to_string()
                    ),
                    is_json: true,
                    truncated: false,
                    redirects,
                    unresolved_variables: unresolved,
                    assertion_results: Vec::new(),
                    extracted_variables: HashMap::new(),
                    timestamp,
                    error: Some(DomainError::TransportError(err.to_string()).to_structured()),
                });
            }
        };

        let status_code = resp.status().as_u16();
        let is_redirect = matches!(status_code, 301 | 302 | 303 | 307 | 308);
        if !is_redirect || !request.settings.follow_redirects {
            break resp;
        }

        let loc_header = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let Some(loc_str) = loc_header else {
            break resp;
        };

        if hop_count >= max_redirects {
            let duration_ms = start.elapsed().as_millis().max(1) as u64;
            return Ok(HttpResponseData {
                request_id: request.id,
                status: status_code,
                status_text: "Too Many Redirects".into(),
                duration_ms,
                size_bytes: 0,
                headers: HashMap::new(),
                cookies: Vec::new(),
                body: format!(
                    "{{\n  \"error\": \"MAX_REDIRECTS_EXCEEDED\",\n  \"maxRedirects\": {}\n}}",
                    max_redirects
                ),
                is_json: true,
                truncated: false,
                redirects,
                unresolved_variables: unresolved,
                assertion_results: Vec::new(),
                extracted_variables: HashMap::new(),
                timestamp,
                error: Some(DomainError::MaxRedirectsExceeded(max_redirects).to_structured()),
            });
        }

        let next_url = match current_url.join(&loc_str) {
            Ok(u) => u,
            Err(e) => {
                return Ok(HttpResponseData {
                    request_id: request.id,
                    status: 0,
                    status_text: "Invalid Redirect URL".into(),
                    duration_ms: start.elapsed().as_millis() as u64,
                    size_bytes: 0,
                    headers: HashMap::new(),
                    cookies: Vec::new(),
                    body: String::new(),
                    is_json: false,
                    truncated: false,
                    redirects,
                    unresolved_variables: unresolved,
                    assertion_results: Vec::new(),
                    extracted_variables: HashMap::new(),
                    timestamp,
                    error: Some(DomainError::InvalidUrl(e.to_string()).to_structured()),
                });
            }
        };

        // Validar SSRF en cada salto de redirección
        if let Err(ssrf_err) =
            UrlSecurityValidator::validate_redirect_target(&current_url, &next_url)
        {
            return Ok(HttpResponseData {
                request_id: request.id,
                status: 0,
                status_text: "SSRF Blocked".into(),
                duration_ms: start.elapsed().as_millis() as u64,
                size_bytes: 0,
                headers: HashMap::new(),
                cookies: Vec::new(),
                body: format!(
                    "{{\n  \"error\": \"SSRF_REDIRECT_BLOCKED\",\n  \"message\": {:?}\n}}",
                    ssrf_err.to_string()
                ),
                is_json: true,
                truncated: false,
                redirects,
                unresolved_variables: unresolved,
                assertion_results: Vec::new(),
                extracted_variables: HashMap::new(),
                timestamp,
                error: Some(ssrf_err.to_structured()),
            });
        }

        let same_origin = UrlSecurityValidator::is_same_origin(&current_url, &next_url);
        let mut stripped_headers = Vec::new();
        if !same_origin {
            // Purgar credenciales y cabeceras sensibles al redirigir a otro origen
            basic_auth_creds = None;
            let keys_to_remove: Vec<HeaderName> = header_map
                .keys()
                .filter(|k| SecretRedactor::is_sensitive_header_name(k.as_str()))
                .cloned()
                .collect();
            for k in keys_to_remove {
                stripped_headers.push(k.as_str().to_string());
                header_map.remove(k);
            }
        }

        redirects.push(RedirectHop {
            hop: hop_count + 1,
            status: status_code,
            from_url: current_url.to_string(),
            to_url: next_url.to_string(),
            cross_origin: !same_origin,
            stripped_headers,
        });

        if matches!(status_code, 301 | 302 | 303) && current_method != Method::HEAD {
            current_method = Method::GET;
        }
        current_url = next_url;
        hop_count += 1;
    };

    let mut resp = final_resp;
    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("OK").to_string();
    let mut resp_headers = HashMap::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(val_str) = v.to_str() {
            resp_headers.insert(k.as_str().to_string(), val_str.to_string());
        }
    }

    // Lectura en streaming por fragmentos con límite estricto max_response_bytes
    let mut accumulated = Vec::new();
    let mut truncated = false;
    while let Ok(Some(chunk)) = resp.chunk().await {
        if accumulated.len() + chunk.len() > max_response_bytes {
            let remaining = max_response_bytes.saturating_sub(accumulated.len());
            accumulated.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        accumulated.extend_from_slice(&chunk);
    }

    let size_bytes = accumulated.len();
    let raw_body = String::from_utf8_lossy(&accumulated).to_string();
    let (body, is_json) = if !truncated {
        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&raw_body) {
            (
                serde_json::to_string_pretty(&json_val).unwrap_or(raw_body),
                true,
            )
        } else {
            (raw_body, false)
        }
    } else {
        (raw_body, false)
    };

    let duration_ms = start.elapsed().as_millis().max(1) as u64;
    let mut response_data = HttpResponseData {
        request_id: request.id.clone(),
        status,
        status_text,
        duration_ms,
        size_bytes,
        headers: resp_headers,
        cookies: Vec::new(),
        body,
        is_json,
        truncated,
        redirects,
        unresolved_variables: unresolved,
        assertion_results: Vec::new(),
        extracted_variables: HashMap::new(),
        timestamp,
        error: None,
    };
    response_data.assertion_results =
        AssertionEvaluator::evaluate_all(&request.assertions, &response_data);
    Ok(response_data)
}

#[tauri::command]
pub async fn cancel_http_request(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<bool, StructuredError> {
    Ok(state.registry.cancel(&request_id))
}

#[tauri::command]
pub async fn save_collection_cmd(
    state: State<'_, AppState>,
    file_name: String,
    mut collection: CollectionFile,
) -> Result<String, StructuredError> {
    let safe_name = PathBuf::from(&file_name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| StructuredError {
            code: "VALIDATION_ERROR".into(),
            message: "Nombre de archivo de colección inválido".into(),
            details: None,
            recoverable: true,
        })?
        .to_string();

    let target = state.workspace_dir.join(safe_name);
    AtomicCollectionStorage::save_to_path(&target, &mut collection)
        .map_err(|e| e.to_structured())?;
    Ok(target.to_string_lossy().to_string())
}
