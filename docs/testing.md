# Estrategia de Pruebas y Resultados Verificados — ElTransportador

## 1. Cobertura de Rutas Críticas y Fronteras de Seguridad

ElTransportador prioriza la verificación empírica de rutas críticas sobre pruebas superficiales. Ninguna prueba depende de servicios externos en internet ni de credenciales reales.

| Nivel de Prueba | Archivo Ejecutable | Casos Verificados | Estado |
| :--- | :--- | :--- | :--- |
| **Análisis Estático** | `scripts/lint-check.mjs` | Validación de sintaxis y AST TypeScript/JSX/ESM en 22 módulos del monorepo. | **PASS (22/22)** |
| **Pruebas Unitarias** | `tests/unit/run-unit-tests.mjs` | 1. Construcción/validación de URLs<br>2. Precedencia de variables (4 niveles)<br>3. Bóveda AES-256-GCM e interpolación `${secret:key}`<br>4. Redacción universal de secretos<br>5. Reglas de redirección y bloqueo SSRF<br>6. Migración de esquema `v0 -> v1` y recuperación `.bak`<br>7. Evaluador de aserciones y JSONPath<br>8. Importador OpenAPI 3.0 y descarte de extensiones | **PASS (8/8)** |
| **Pruebas de Integración** | `tests/integration/run-integration-tests.mjs` | Servidor HTTP local efímero:<br>1. Métodos `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`<br>2. Cuerpos JSON, urlencoded, multipart y Auth (`Bearer`, `Basic`, `API Key`)<br>3. Seguimiento de redirecciones y cookies<br>4. Timeouts y cancelación en vuelo<br>5. Streaming y truncamiento seguro de respuestas grandes<br>6. Flujo encadenado de 3 solicitudes (8/8 aserciones)<br>7. Historial en SQLite real con redacción | **PASS (7/7)** |
| **Pruebas de Seguridad** | `tests/security/run-security-tests.mjs` | 1. Limpieza de `Authorization`/`Cookie`/`X-API-Key` en redirección cross-origin<br>2. Bloqueo de redirección SSRF a Cloud Metadata (`169.254.169.254`)<br>3. Bloqueo de esquemas `file:`, `javascript:`, `data:`, `ftp:`<br>4. Protección contra Path Traversal (`../../etc/passwd`)<br>5. Descarte de scripts en colecciones importadas<br>6. Verificación de CSP y `capabilities/default.json` | **PASS (6/6)** |
| **Pruebas E2E de Interfaz** | `tests/e2e/run_e2e_ui_tests.py` | Ejecución real en Chromium Headless + puente IPC:<br>1. Puente IPC y flujo encadenado<br>2. Inicio en frío (<2 s) y `GET /health`<br>3. `POST /orders` con editor JSON y `201 Created`<br>4. Aislamiento `<iframe sandbox="">` en Preview<br>5. Modal de ejecución de flujo (8/8 aserciones)<br>6. Bóveda de secretos, Tema Claro y cambio de idioma ES/EN<br>7. Creación y persistencia de nuevas solicitudes | **PASS (7/7)** |
