# Modelo de Amenazas y Controles de Seguridad — ElTransportador

## 1. Superficie de Ataque y Modelo de Amenazas (STRIDE)

| Amenaza Identificada | Categoría | Impacto | Control Implementado en ElTransportador |
| :--- | :--- | :--- | :--- |
| **Exposición accidental de tokens o contraseñas en repositorios Git** | Information Disclosure | Crítico | Las colecciones `.etp.json` nunca almacenan valores de variables secretas en texto plano (`value: ""`). Los secretos se referencian mediante `${secret:nombre}` y residen en el almacén seguro del SO (`keyring`) o bóveda local cifrada con **AES-256-GCM**. |
| **Fuga de credenciales (`Authorization`, `Cookie`, `X-API-Key`) durante redirecciones HTTP hacia otro dominio** | Information Disclosure / Spoofing | Crítico | `UrlSecurityValidator::validate_redirect` inspecciona cada salto `301/302/303/307/308`. Si cambia el origen (`scheme + host + port`), elimina automáticamente `Authorization`, `Cookie`, `Proxy-Authorization`, `X-API-Key` y cualquier cabecera con un secreto interpolado. |
| **Redirección maliciosa desde servidor externo hacia red interna o Cloud Metadata (`169.254.169.254`)** | Elevation of Privilege / SSRF | Alto | El validador de redirecciones bloquea por defecto cualquier salto desde un origen público hacia `localhost`, rangos privados RFC1918 (`10/8`, `172.16/12`, `192.168/16`), loopback (`127/8`, `::1`) o endpoints de metadata (`169.254.169.254`). |
| **Ejecución de código mediante respuestas HTML maliciosas (XSS en el visor de respuestas)** | Tampering / EoP | Crítico | La pestaña `Preview` utiliza un `<iframe sandbox="" referrerpolicy="no-referrer">` sin `allow-scripts` ni `allow-same-origin`, además de inyectar una política CSP `default-src 'none'; style-src 'unsafe-inline';`. |
| **Ejecución de scripts maliciosos al importar colecciones externas** | Tampering / RCE | Crítico | No se implementan scripts arbitrarios en v1.0. El importador (`ImportExportService`) detecta, descarta y reporta explícitamente cualquier campo `script`, `preRequestScript`, `postResponseScript` o extensión `x-*` no confiable. |
| **Denegación de servicio (DoS / OOM) mediante respuestas HTTP gigantescas** | Denial of Service | Medio | El lector de flujo (`stream`) contabiliza los bytes recibidos en tiempo real y trunca o aborta la descarga al alcanzar `maxResponseBytes` (por defecto 10 MB, configurable). |
| **Persistencia de secretos en el historial local SQLite** | Information Disclosure | Alto | Antes de cada `INSERT` en `request_history`, `SecretRedactor` reemplaza cualquier valor de la bóveda, tokens `Bearer`, `Basic`, credenciales en URL y cabeceras sensibles por `[REDACTED:ELTRANSPORTADOR_SECRET]`. |

## 2. Seguridad de Tauri 2 (`tauri.conf.json` y `capabilities/default.json`)

- `withGlobalTauri`: `false` (no se expone el objeto global `__TAURI__` a scripts no autorizados).
- `freezePrototype`: `true` (protección contra contaminación de `Object.prototype`).
- **CSP Estricta:** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'`.
- **Capacidades Mínimas:** `capabilities/default.json` habilita únicamente `core:default` y `core:window:allow-set-title`. No se habilitan plugins de shell ni acceso genérico al sistema de archivos desde el frontend.
