# Arquitectura de Software — ElTransportador

## 1. Principios Arquitectónicos

ElTransportador implementa una **Arquitectura Limpia pragmática** con separación estricta entre la interfaz gráfica (React + TypeScript) y el núcleo de ejecución, red y persistencia (Rust / Tauri 2 + Core Engine).

```
+-----------------------------------------------------------------------------------+
|                        FRONTEND (apps/desktop/src/)                               |
|  +-----------------+  +--------------------+  +--------------------------------+  |
|  | Panel Lateral   |  | Editor Solicitudes |  | Visor de Respuestas            |  |
|  | - Colecciones   |  | - Params / Headers |  | - Pretty / Raw / Headers       |  |
|  | - Entornos      |  | - Auth / Body JSON |  | - Preview (<iframe sandbox="">)|  |
|  | - Historial     |  | - Aserciones       |  | - Cookies / Resultados Tests   |  |
|  +--------+--------+  +---------+----------+  +---------------+----------------+  |
|           |                     |                             |                   |
|           +---------------------+-----------------------------+                   |
|                                 | Contrato Tipado (@eltransportador/contracts)    |
|                                 v                                                 |
|                     Cliente IPC (services/ipcClient.ts)                           |
+---------------------------------|-------------------------------------------------+
                                  | Frontera de Seguridad Validada (IPC)
+---------------------------------v-------------------------------------------------+
|                BACKEND NATIVO (apps/desktop/src-tauri/src/)                       |
|  +-----------------------------------------------------------------------------+  |
|  | Commands Layer (commands/mod.rs): Validación de entradas y permisos         |  |
|  +-----------------------------------------------------------------------------+  |
|  | Application Layer (application/mod.rs):                                     |  |
|  | - VariableResolver (4 niveles de precedencia)                               |  |
|  | - AssertionEvaluator & FlowRunner (encadenamiento de variables)             |  |
|  | - ImportExportService (ETP v1, OpenAPI 3.0, cURL)                           |  |
|  +-----------------------------------------------------------------------------+  |
|  | Security Layer (security/mod.rs):                                           |  |
|  | - SecretVault (OS Keyring / AES-256-GCM)                                    |  |
|  | - SecretRedactor (Sanitización automática de logs e historial)              |  |
|  | - UrlSecurityValidator (Anti-SSRF y limpieza cross-origin en redirecciones) |  |
|  +-----------------------------------------------------------------------------+  |
|  | Infrastructure Layer (infrastructure/mod.rs):                               |  |
|  | - HttpEngine (reqwest + rustls-tls + CancellationToken + Streaming Cap)     |  |
|  | - AtomicCollectionStorage (.etp.json con fsync + respaldo .bak)             |  |
|  | - SqliteHistoryRepository (rusqlite con retención automática)               |  |
|  +-----------------------------------------------------------------------------+  |
|  | Domain Layer (domain/mod.rs): Entidades, Objetos de Valor y Errores         |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

## 2. Reglas de Frontera entre Módulos

1. **Prohibición de Acceso Directo desde la Interfaz:** Ningún componente React importa APIs de sistema de archivos ni ejecuta peticiones arbitrarias sin pasar por el adaptador de servicios.
2. **Tipado Explícito de Extremo a Extremo:** Todos los mensajes IPC comparten las definiciones de `@eltransportador/contracts` y sus estructuras equivalentes en Rust (`serde`).
3. **Gestión de Errores Estructurada:** Todo fallo de red, TLS, timeout, cancelación o validación se devuelve como `StructuredError` con código semántico (`INVALID_URL`, `BLOCKED_SCHEME`, `SSRF_REDIRECT_BLOCKED`, `TIMEOUT`, `CANCELLED`, `TLS_ERROR`, `RESPONSE_TOO_LARGE`).
