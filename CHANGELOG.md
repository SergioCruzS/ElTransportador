# Historial de Cambios (Changelog) — ElTransportador

Todos los cambios relevantes de este proyecto se documentan en este archivo siguiendo [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [1.2.0] - 2026-10-17

### Añadido

* **Apartado de Variables del Flujo y su Valor Actual + Extracción JSONPath con Índices de Lista (`results[0].name`):**

  * **Apartado «📦 Variables del Flujo y su Valor Actual» en `Modo Básico` y `Modo Avanzado` (`flows-basic-view.js`, `flows-inspector-view.js`, `flow-validator.js`):**

    * **Modo Básico:** Incorpora una tarjeta interactiva en la columna de secuencia y resultados que lista todas las variables del flujo (**Variables Producidas / Extraídas en el Flujo**, **Variables Iniciales del Flujo**, **Variables del Entorno Activo**, **Variables de Colección / Sesión** y **Secretos de la Bóveda**), mostrando su nombre (`${variable}`), su origen/ruta de extracción (ej. `#1 Login • json_path: results[0].name`) y su **valor actual resuelto en vivo** (o `⏳ Pendiente de ejecución` antes de correr el paso, y `🔒 ••••••••••••` para secretos).

    * **Modo Avanzado:** Añade la nueva pestaña dedicada **`Variables`** en la barra superior del panel derecho (`Inspector`), además de un resumen en vivo dentro de la pestaña `Inspector`, permitiendo consultar en cualquier momento todas las variables disponibles en el flujo y su valor actual sin exponer secretos en texto plano.

  * **Soporte de Índices de Lista / Arreglos en Rutas JSONPath (`results[0].name`, `items[1][0].id`, `[0].title`, `$.results[0].name`, `results[-1].name`):**

    * Actualizado el motor de resolución `getByDotPath` (`apps/desktop/src/services/http/assertions-evaluator.js`) y `AssertionEvaluator.getJsonPath` (`scripts/core-engine/assertions.mjs`) para soportar indexación por corchetes sobre listas/arreglos JSON tanto en **Extracciones Declarativas** como en **Aserciones JSONPath** y **Condiciones del Flujo** (en el Editor HTTP, Estudio de Flujos y CLI).

    * Actualizada la **Captura Visual de JSON** (`flattenJsonPathsForVisualCapture`) para sugerir automáticamente rutas con notación de corchetes como `results[0].name` al inspeccionar arreglos JSON.

* **Consumo Interactivo de Variables y Parámetros Exclusivos por Endpoint en `Flows Studio` (`Modo Básico` y `Modo Avanzado`):**
  * **Sección «🔗 Parámetros y Variables Consumidas (Exclusivos del Flujo)» en cada paso (`flows-basic-view.js`) y en cada nodo HTTP (`flows-inspector-view.js`):**
    * Al asociar una solicitud a un paso o nodo del flujo, se clonan inicialmente sus `params` (`cloneRequestParamsForFlow`) para que puedan visualizarse y ajustarse dentro del flujo.
    * **Independencia total entre el Editor HTTP y el Estudio de Flujos:** En el flujo se pueden agregar (`+ Parámetro`), editar, activar/desactivar o eliminar (`×`) parámetros, así como restablecerlos desde la solicitud original (`↺ Sincronizar de solicitud`), sin modificar en ningún momento los `params` de la solicitud original en la colección del Editor HTTP.
    * **Selector rápido de variables a consumir (`⚯ Asignar variable...`):** Cada parámetro cuenta con un selector desplegable que agrupa todas las variables disponibles en el contexto (**Variables Producidas en el Flujo**, **Variables Iniciales del Flujo**, **Variables del Entorno Activo**, **Variables de Colección** y **Secretos de la Bóveda** `${secret:...}`) para asignarlas con un clic o combinarlas en la celda de valor.
    * **Resumen en vivo de flujo de datos por paso y por nodo:** Indicadores explícitos de `⬇ Variables Consumidas` y `⬆ Variables Producidas` tanto en `Modo Básico` como en el `Inspector` de `Modo Avanzado`.
* **Evolución Completa de `Flows Studio` con Dos Modos Independientes (`Básico` y `Avanzado`):**
  * **Secciones Independientes «Modo Básico / Modo Avanzado» y Modelo Versionado (`eltransportador.flow/v2`):** Crear un flujo en `Modo Básico` registra únicamente un flujo básico (`☰ Básico`), y crear un flujo en `Modo Avanzado` registra únicamente un flujo avanzado (`🕸 Avanzado`).
  * **Conversión No Destructiva con Numeración Consecutiva Automática (`createIndependentAdvancedFlowFromBasic`):** Al presionar **«⇄ Convertir a Grafo Avanzado»** desde un flujo básico, el flujo básico original se conserva intacto en su sección y se crea un nuevo flujo avanzado independiente con el mismo nombre y la etiqueta `🕸 Avanzado`; si ya existe un flujo avanzado con el mismo nombre, se asigna automáticamente un sufijo consecutivo (`Flujo 1 (1)`, `Flujo 1 (2)`, etc.).
  * **Modo Básico Mejorado (`flows-basic-view.js`):**
    * Reordenamiento de los pasos de la secuencia tanto arrastrando y soltando con el mouse (`Drag & Drop` sobre `⋮⋮`) como con los botones de flechas (`↑` / `↓`), idéntico al comportamiento de las solicitudes.
    * Creación, edición, activación/desactivación y eliminación de **parámetros exclusivos**, **aserciones exclusivas del flujo** y **extracciones exclusivas** por cada paso sin modificar el endpoint original en la colección, en tablas desplazables sin desbordamiento y 100% traducidas (`ES` / `EN`).
    * Configuración de **reintentos por paso (`0`, `1`, `3`, `5`)** y tiempo de espera entre reintentos en segundos.
    * Resumen detallado por paso: código HTTP, duración, intentos realizados (`attempts / maxAttempts`), motivo exacto de fallo (`failureReason`), aserciones aprobadas/fallidas y variables extraídas (con redacción universal de secretos).
  * **Modo Avanzado — Orquestador Visual de APIs tipo Máquina de Estados (`flows-canvas-view.js`, `flows-inspector-view.js`, `flow-orchestrator.js`, `flow-validator.js`):**
    * **Lienzo Interactivo Nativo (HTML/CSS + SVG + Pointer Events, 0 dependencias externas):** Cuadrícula sutil, zoom (`40%`–`180%`), paneo, controles de **Ajustar a pantalla**, **Centrar**, **Deshacer (`Ctrl+Z`)**, **Rehacer (`Ctrl+Y`)**, atajos de teclado (**flechas** para mover el nodo seleccionado manteniendo el foco y **`Supr` / `Backspace`** para eliminar) y **Minimapa ligero** en esquina.
    * **Botón de Eliminación Rápida en Nodos (`✕`):** Cada nodo del grafo (excepto `Inicio`) incorpora un botón `✕` en su esquina superior derecha para eliminarlo directamente desde el lienzo.
    * **Menús Laterales Izquierdo y Derecho Independientes (Fijo, Flotante, Ocultar y Redimensionar):**
      * El panel izquierdo de `Mis Flujos` (`#flows-left-sidebar`) cuenta con controles propios de **📌 Fijo / Flotante** (auto-ocultamiento al perder el foco), **◀ Ocultar**, botón de reapertura (`◧ Flujos`) y divisor de redimensionamiento (`#flows-left-sidebar-resizer`) totalmente independientes del navegador principal de colecciones.
      * El panel derecho de `Inspector` (`#flows-right-inspector`) incorpora controles propios de **📌 Fijo / Flotante**, **Ocultar ▶**, botón de reapertura (`🔧 Inspector`) y divisor de redimensionamiento (`#flows-right-inspector-resizer`).
      * Al entrar al **Estudio de Flujos**, se ocultan en la barra superior todos los botones exclusivos del probador de APIs (`Panel`, buscador global de colecciones, selector de `Entorno`, `Entornos y Secretos`, `Importar / Exportar`), dejando únicamente los controles del Estudio de Flujos.
    * **Inspector Contextual Mejorado y Traducido (`ES` / `EN`):**
      * Buscador instantáneo (`🔍 Filtrar endpoint por nombre, método o URL...`) justo encima del selector de **Endpoint Asociado**.
      * Traducción completa de **Política ante Fallo HTTP** y **Política ante Aserción Fallida** (`Seguir puerto de salida (failure / timeout)`, `Continuar flujo por defecto (ignorar fallo)`, `Detener el flujo inmediatamente`, `Ir al nodo de error`).
      * **Variables Iniciales del Flujo (`+ Variable`)** independientes por cada flujo con soporte de activación, edición y máscara de secreto (`🔒`).
      * **Concurrencia Paralela (1–6)** con ejecución aislada por lote cuando un nodo dispara múltiples ramas simultáneas y explicación detallada (`hint`) en el inspector.
    * **Captura Visual Exclusiva para Datos JSON:** La pestaña `Captura Visual` lista únicamente propiedades detectadas del cuerpo JSON de la respuesta sanitizada (sin cabeceras ni cookies) para vincular extracciones declarativas con un clic.
    * **Diagnóstico Preciso, Historial Persistente y Exportación Visible:**
      * El panel `Diagnóstico` identifica explícitamente qué nodo y qué solicitud fallaron y por qué (`HTTP 500`, `Aserción fallida`, `Timeout`), distinguiendo entre un fallo terminal del flujo y un **fallo controlado en rama primaria** cuando el flujo se recupera exitosamente por una rama de contingencia (`Fin Exitoso`).
      * Todas las ejecuciones reales en modo básico y avanzado se guardan en `Historial Sanitizado (<= 12)` con comparador lado a lado (`Diff A vs B`).
      * El botón **«⬇ Exportar Reporte Seguro»** abre el modal de exportación mostrando el JSON sanitizado en pantalla listo para copiar al portapapeles o guardar como archivo `.json`.
    * **6 Plantillas Iniciales con Confirmación de Seguridad (`flow-templates.js`):** Al seleccionar una plantilla se solicita confirmación previa advirtiendo al usuario que el progreso actual del flujo será reemplazado.

### Corregido

* **Traducción Completa de Claves en `Flows Studio` (`ES` y `EN`):** Incorporadas todas las claves de internacionalización en `apps/desktop/src/lang/es.js`, `en.js`, `es.json` y `en.json` (tales como `flows.policyOnHttpErrorLabel`, `flows.policyOnAssertionFailLabel`, `flows.associatedEndpointLabel`, `flows.retriesSelectLabel`, `flows.declarativeExtractionsTitle`, etc.) para que ningún control muestre su identificador interno.
* **Leyenda Dinámica de Modo en el Panel Izquierdo de Flujos (`#lbl-flows-section-badge`):** Corregida la actualización del indicador de sección en el menú lateral izquierdo de flujos para que muestre `🕸 Modo Avanzado (Grafo)` / `🕸 Advanced Mode (Graph)` al estar en modo avanzado y `☰ Modo Básico` / `☰ Basic Mode` al estar en modo básico.

## [1.0.1] - 2026-10-16

### Añadido

* **Arquitectura Atomizada por Dominios con Archivos `index` (Barrels):**
  * Atomización de `scripts/core-engine.mjs` en `scripts/core-engine/` (`constants.mjs`, `secret-vault.mjs`, `url-security.mjs`, `variable-resolver.mjs`, `assertions.mjs`, `http-executor.mjs`, `http-transport.mjs`, `flow-runner.mjs`, `collection-storage.mjs`, `sqlite-history.mjs`, `import-export.mjs` e `index.mjs`).
  * Atomización de `apps/desktop/src/services/` en `services/storage/` (`constants.js`, `vault-crypto.js`, `collection-sanitizer.js`, `workspace-state.js`, `index.js`) y `services/http/` (`variable-interpolation.js`, `wire-preview.js`, `assertions-evaluator.js`, `request-executor.js`, `index.js`).
  * Atomización de `apps/desktop/src/controllers/ui-renderers.js` en `controllers/renderers/` (`dom-utils.js`, `workspace-helpers.js`, `layout-prefs.js`, `settings-modal.js`, `sidebar-collections.js`, `sidebar-environments.js`, `sidebar-history.js`, `sidebar.js`, `center-editor.js`, `center-editor-tabs.js`, `center-editor-events.js`, `json-viewer.js`, `response-panel.js`, `flows-studio.js` e `index.js`).
  * Atomización de `apps/desktop/src/controllers/app-controller.js` en `controllers/handlers/` (`file-clipboard-actions.js`, `layout-resizer-handlers.js`, `request-bar-handlers.js`, `collection-crud-handlers.js`, `import-export-handlers.js` e `index.js`).
  * Atomización de diccionarios de idioma en `apps/desktop/src/lang/` (`es.js`, `en.js`, `i18n.js`, `index.js`).
* **Colapsar y Expandir Colecciones y Carpetas:** Controles interactivos `▾` / `▸` en cada colección (`[data-toggle-col-collapse]`) y en cada carpeta (`[data-toggle-folder-collapse]`), además de botón rápido `↕ Expandir / Colapsar` (`#btn-toggle-expand-all`) con persistencia de estado.
* **Visor de Respuesta JSON con Coloreado Sintáctico y Plegado de Llaves (`{}` / `[]`):**
  * Resaltado cromático diferenciado para propiedades (`.etp-json-key`), cadenas (`.etp-json-string`), números (`.etp-json-number`), booleanos (`.etp-json-boolean`), `null` (`.etp-json-null`) y llaves/corchetes (`.etp-json-brace`) adaptado a Tema Claro y Tema Oscuro.
  * Plegado y desplegado interactivo entre llaves `{ ... }` y corchetes `[ ... ]` por bloque (`[data-json-fold]`) y botones rápidos `⊞ Expandir JSON` / `⊟ Colapsar JSON`.
* **Resaltado de Palabras Coincidentes en Búsqueda de Respuesta:**
  * En modo **Ver todo (`all`)**, muestra el documento completo resaltando todas las palabras coincidentes con `<mark class="etp-search-highlight">`.
  * En modo **Filtrar líneas (`filter`)**, mantiene el filtrado de las líneas coincidentes conservando su número de línea real y resaltado.
* **Validación en Modal de Nombres Únicos de Colección (Crear y Editar):**
  * Tanto al **crear una nueva colección (`+ Colección`)** como al **editar el nombre de una colección existente (`✎`)**, si ya existe otra colección con el mismo nombre, mantiene el modal abierto y muestra el aviso directamente dentro del modal (`#input-dialog-error`) indicando que modifique el nombre para poder guardar la colección.
* **Doble Confirmación al Eliminar Carpetas o Colecciones con Solicitudes:**
  * Cuando el usuario intenta eliminar una carpeta (`[data-del-folder]`) o una colección (`[data-del-col]`) que contiene `1 o más solicitudes`, se solicita una **doble confirmación secuencial** (`Paso 1 de 2` y `Paso 2 de 2`) antes de proceder con el borrado definitivo.
* **Notificaciones Flotantes (`Toast`) Mejoradas:** Mayor tamaño visual (`14px`, padding `15px 22px`, borde lateral de `6px`) y tiempo de permanencia ampliado a `6.5 segundos` (`6500 ms`).

### Corregido

* **Numeración de Líneas en el Visor de Respuesta y en el Editor de Cuerpo de la Solicitud:**
  * En el visor de respuesta (`response-panel.js` + `json-viewer.js`), cada línea se renderiza en una fila estructurada (`.etp-resp-line`) que alinea de forma exacta su número de línea (`.etp-resp-line-num`), botón de plegado y contenido sin desfasarse.
  * En el editor del cuerpo de la solicitud (`#body-raw-textarea` y `#body-code-gutter`), la numeración de líneas (`.etp-gutter-line`) se actualiza dinámicamente en eventos `input`, `keyup`, `keydown`, `paste` y `scroll`, sincronizando `scrollTop`, sangría con `Tab` y auto-formateo al pegar JSON de una línea.
* **Internacionalización Completa (100% ES / EN):** Traducción de todos los mensajes de error HTTP (incluyendo `"The provided URL is empty or does not have a valid HTTP/HTTPS format: \"\""` e identificador `INVALID URL`), resultados de aserciones, etiquetas y estados criptográficos de la Bóveda de Secretos (`SecretVault`), avisos de sesión efímera y el modal completo de Configuración (`#modal-settings`).
* **Tabla de Variables de Entorno y Funcionalidad de la Columna de Candado (`🔒`):**
  * Corregido el analizador léxico de plantillas anidadas en `scripts/build-all.mjs` que truncaba `placeholder="https://..."` dentro de la tabla de variables de entorno y desfasaba la celda del candado (`🔒`).
  * Restaurada y mejorada la funcionalidad de la columna `🔒 Secreto` / `🔒 Secret` en las variables de entorno.
* **Movimiento y Selección Independiente de Solicitudes entre Colecciones:**
  * Corregida la reubicación de solicitudes entre colecciones tanto mediante el selector `Ubicación:` (`#req-folder-select`) como mediante arrastrar y soltar (`Drag & Drop`), habilitando `"dragDropEnabled": false` en `apps/desktop/src-tauri/tauri.conf.json`.
  * Garantizada la generación de IDs únicos globales por solicitud (`ensureUniqueWorkspaceIds` y `sanitizeImportedCollection`) y la validación `(req.id === state.activeTabId && colIdx === ownerColIdx)` para que seleccionar la solicitud 1 de la colección 1 jamás marque como seleccionada la solicitud 1 de las colecciones 2 o 3.

## [1.0.0] - 2026-10-14

### Añadido

* Identidad oficial `ElTransportador` (`com.eltransportador.desktop`), paquete `eltransportador-desktop`, iconografía geométrica original y soporte bilingüe (Español por defecto e Inglés).
* Arquitectura limpia modular para Tauri 2 (Rust) + React 18 (TypeScript estricto) + puente de ejecución CLI/Headless.
* Motor HTTP completo con soporte para `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, parámetros query, cabeceras, cookies, `application/json`, `text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`, autenticación `Bearer`, `Basic` y `API Key`, timeouts, cancelación en vuelo y límite de memoria por streaming.
* Seguridad por diseño: almacén seguro de secretos (`SecretVault` sobre OS Keyring / AES-256-GCM), redacción universal de credenciales (`SecretRedactor`), bloqueo de esquemas peligrosos, limpieza automática de credenciales en redirecciones cross-origin y protección anti-SSRF hacia redes privadas y endpoints de metadata (`169.254.169.254`).
* Formato de almacenamiento propio versionado `eltransportador.collection/v1` (`.etp.json`) con escritura atómica, recuperación desde respaldo `.bak` y migración explícita desde `v0`.
* Repositorio de historial local en SQLite (`history.sqlite3`) con retención configurable y sanitización obligatoria de secretos.
* Automatización de pruebas: evaluador declarativo de aserciones (`status`, `header`, `json_path`, `body_text`, `duration_ms`), extracción y encadenamiento de variables entre solicitudes (`Request Flows`) y ejecutor CLI (`eltransportador-cli`).
* Importador de especificaciones OpenAPI 3.0 con reporte explícito de campos conservados, transformados y descartados, y exportador a `cURL` con redacción por defecto.