# Historial de Cambios (Changelog) — ElTransportador

Todos los cambios relevantes de este proyecto se documentan en este archivo siguiendo [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [1.0.0] - 2026-10-14

### Añadido
- Identidad oficial `ElTransportador` (`com.eltransportador.desktop`), paquete `eltransportador-desktop`, iconografía geométrica original y soporte bilingüe (Español por defecto e Inglés).
- Arquitectura limpia modular para Tauri 2 (Rust) + React 18 (TypeScript estricto) + puente de ejecución CLI/Headless.
- Motor HTTP completo con soporte para `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, parámetros query, cabeceras, cookies, `application/json`, `text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`, autenticación `Bearer`, `Basic` y `API Key`, timeouts, cancelación en vuelo y límite de memoria por streaming.
- Seguridad por diseño: almacén seguro de secretos (`SecretVault` sobre OS Keyring / AES-256-GCM), redacción universal de credenciales (`SecretRedactor`), bloqueo de esquemas peligrosos, limpieza automática de credenciales en redirecciones cross-origin y protección anti-SSRF hacia redes privadas y endpoints de metadata (`169.254.169.254`).
- Formato de almacenamiento propio versionado `eltransportador.collection/v1` (`.etp.json`) con escritura atómica, recuperación desde respaldo `.bak` y migración explícita desde `v0`.
- Repositorio de historial local en SQLite (`history.sqlite3`) con retención configurable y sanitización obligatoria de secretos.
- Automatización de pruebas: evaluador declarativo de aserciones (`status`, `header`, `json_path`, `body_text`, `duration_ms`), extracción y encadenamiento de variables entre solicitudes (`Request Flows`) y ejecutor CLI (`eltransportador-cli`).
- Importador de especificaciones OpenAPI 3.0 con reporte explícito de campos conservados, transformados y descartados, y exportador a `cURL` con redacción por defecto.
