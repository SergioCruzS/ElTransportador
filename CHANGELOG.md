# Historial de Cambios (Changelog) — ElTransportador

Todos los cambios relevantes de este proyecto se documentan en este archivo siguiendo [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [1.0.1] - 2026-10-16

### Añadido
- **Arquitectura Atomizada por Dominios con Archivos `index` (Barrels):**
  - Atomización de `scripts/core-engine.mjs` en `scripts/core-engine/` (`constants.mjs`, `secret-vault.mjs`, `url-security.mjs`, `variable-resolver.mjs`, `assertions.mjs`, `http-executor.mjs`, `http-transport.mjs`, `flow-runner.mjs`, `collection-storage.mjs`, `sqlite-history.mjs`, `import-export.mjs` e `index.mjs`).
  - Atomización de `apps/desktop/src/services/` en `services/storage/` (`constants.js`, `vault-crypto.js`, `collection-sanitizer.js`, `workspace-state.js`, `index.js`) y `services/http/` (`variable-interpolation.js`, `wire-preview.js`, `assertions-evaluator.js`, `request-executor.js`, `index.js`).
  - Atomización de `apps/desktop/src/controllers/ui-renderers.js` en `controllers/renderers/` (`dom-utils.js`, `workspace-helpers.js`, `layout-prefs.js`, `settings-modal.js`, `sidebar-collections.js`, `sidebar-environments.js`, `sidebar-history.js`, `sidebar.js`, `center-editor.js`, `center-editor-tabs.js`, `center-editor-events.js`, `json-viewer.js`, `response-panel.js`, `flows-studio.js` e `index.js`).
  - Atomización de `apps/desktop/src/controllers/app-controller.js` en `controllers/handlers/` (`file-clipboard-actions.js`, `layout-resizer-handlers.js`, `request-bar-handlers.js`, `collection-crud-handlers.js`, `import-export-handlers.js` e `index.js`).
  - Atomización de diccionarios de idioma en `apps/desktop/src/lang/` (`es.js`, `en.js`, `i18n.js`, `index.js`).
- **Colapsar y Expandir Colecciones y Carpetas:** Controles interactivos `▾` / `▸` en cada colección (`[data-toggle-col-collapse]`) y en cada carpeta (`[data-toggle-folder-collapse]`), además de botón rápido `↕ Expandir / Colapsar` (`#btn-toggle-expand-all`) con persistencia de estado.
- **Visor de Respuesta JSON con Coloreado Sintáctico y Plegado de Llaves (`{}` / `[]`):**
  - Resaltado cromático diferenciado para propiedades (`.etp-json-key`), cadenas (`.etp-json-string`), números (`.etp-json-number`), booleanos (`.etp-json-boolean`), `null` (`.etp-json-null`) y llaves/corchetes (`.etp-json-brace`) adaptado a Tema Claro y Tema Oscuro.
  - Plegado y desplegado interactivo entre llaves `{ ... }` y corchetes `[ ... ]` por bloque (`[data-json-fold]`) y botones rápidos `⊞ Expandir JSON` / `⊟ Colapsar JSON`.
- **Resaltado de Palabras Coincidentes en Búsqueda de Respuesta:**
  - En modo **Ver todo (`all`)**, muestra el documento completo resaltando todas las palabras coincidentes con `<mark class="etp-search-highlight">`.
  - En modo **Filtrar líneas (`filter`)**, mantiene el filtrado de las líneas coincidentes conservando su número de línea real y resaltado.
- **Validación en Modal de Nombres Únicos de Colección (Crear y Editar):**
  - Tanto al **crear una nueva colección (`+ Colección`)** como al **editar el nombre de una colección existente (`✎`)**, si ya existe otra colección con el mismo nombre, mantiene el modal abierto y muestra el aviso directamente dentro del modal (`#input-dialog-error`) indicando que modifique el nombre para poder guardar la colección.
- **Doble Confirmación al Eliminar Carpetas o Colecciones con Solicitudes:**
  - Cuando el usuario intenta eliminar una carpeta (`[data-del-folder]`) o una colección (`[data-del-col]`) que contiene `1 o más solicitudes`, se solicita una **doble confirmación secuencial** (`Paso 1 de 2` y `Paso 2 de 2`) antes de proceder con el borrado definitivo.
- **Notificaciones Flotantes (`Toast`) Mejoradas:** Mayor tamaño visual (`14px`, padding `15px 22px`, borde lateral de `6px`) y tiempo de permanencia ampliado a `6.5 segundos` (`6500 ms`).

### Corregido
- **Numeración de Líneas en el Visor de Respuesta y en el Editor de Cuerpo de la Solicitud:**
  - En el visor de respuesta (`response-panel.js` + `json-viewer.js`), cada línea se renderiza en una fila estructurada (`.etp-resp-line`) que alinea de forma exacta su número de línea (`.etp-resp-line-num`), botón de plegado y contenido sin desfasarse.
  - En el editor del cuerpo de la solicitud (`#body-raw-textarea` y `#body-code-gutter`), la numeración de líneas (`.etp-gutter-line`) se actualiza dinámicamente en eventos `input`, `keyup`, `keydown`, `paste` y `scroll`, sincronizando `scrollTop`, sangría con `Tab` y auto-formateo al pegar JSON de una línea.
- **Internacionalización Completa (100% ES / EN):** Traducción de todos los mensajes de error HTTP (incluyendo `"The provided URL is empty or does not have a valid HTTP/HTTPS format: \"\""` e identificador `INVALID URL`), resultados de aserciones, etiquetas y estados criptográficos de la Bóveda de Secretos (`SecretVault`), avisos de sesión efímera y el modal completo de Configuración (`#modal-settings`).
- **Tabla de Variables de Entorno y Funcionalidad de la Columna de Candado (`🔒`):**
  - Corregido el analizador léxico de plantillas anidadas en `scripts/build-all.mjs` que truncaba `placeholder="https://..."` dentro de la tabla de variables de entorno y desfasaba la celda del candado (`🔒`).
  - Restaurada y mejorada la funcionalidad de la columna `🔒 Secreto` / `🔒 Secret` en las variables de entorno.
- **Movimiento y Selección Independiente de Solicitudes entre Colecciones:**
  - Corregida la reubicación de solicitudes entre colecciones tanto mediante el selector `Ubicación:` (`#req-folder-select`) como mediante arrastrar y soltar (`Drag & Drop`), habilitando `"dragDropEnabled": false` en `apps/desktop/src-tauri/tauri.conf.json`.
  - Garantizada la generación de IDs únicos globales por solicitud (`ensureUniqueWorkspaceIds` y `sanitizeImportedCollection`) y la validación `(req.id === state.activeTabId && colIdx === ownerColIdx)` para que seleccionar la solicitud 1 de la colección 1 jamás marque como seleccionada la solicitud 1 de las colecciones 2 o 3.

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
