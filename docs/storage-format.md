# Especificación del Formato de Almacenamiento (`eltransportador.collection/v1`)

## 1. Diseño Orientado a Git y Legibilidad Humana

Las colecciones de ElTransportador se almacenan en archivos con extensión `.etp.json` codificados en UTF-8 con sangría determinista de 2 espacios y saltos de línea LF (`\n`).

### Reglas de Separación de Datos
1. **Colecciones (`.etp.json`):** Contienen metadatos, estructura de carpetas, solicitudes, aserciones declarativas y variables públicas. **Nunca contienen secretos en texto plano.**
2. **Historial (`history.sqlite3`):** Base de datos SQLite local independiente del árbol Git del proyecto, con límite de retención automático y credenciales redactadas.
3. **Secretos (`SecretVault`):** Residen en el llavero del sistema operativo (`com.eltransportador.desktop.vault`) o en la bóveda local cifrada con **AES-256-GCM** (`vault.enc.json`, permisos `0600`).

## 2. Sintaxis y Precedencia de Variables

ElTransportador define una sintaxis explícita e inequívoca:
- **Variable estándar:** `${nombre_variable}`
- **Referencia a secreto:** `${secret:identificador_secreto}`

### Orden de Precedencia Determinista
1. **Variables de Flujo en Tiempo de Ejecución (`Runtime / Extracted`):** Extraídas de respuestas anteriores durante la ejecución de un flujo.
2. **Variables del Entorno Activo (`Environment`):** Definidas en el perfil seleccionado (ej. `Desarrollo Local`, `Staging`, `Producción`).
3. **Variables de la Colección (`Collection`):** Definidas en el arreglo `variables` del archivo `.etp.json`.
4. **Variables Globales del Sistema (`ELTRANSPORTADOR_*`):** Variables de entorno del sistema operativo que comienzan con el prefijo oficial `ELTRANSPORTADOR_`.

## 3. Escritura Atómica y Recuperación

Cada operación de guardado ejecuta la secuencia:
1. Serialización y validación del esquema `eltransportador.collection/v1`.
2. Limpieza preventiva de cualquier campo `value` en variables marcadas con `"isSecret": true`.
3. Escritura en `<archivo>.etp.json.tmp.<pid>` seguida de `fsync` a disco.
4. Copia del archivo previo válido a `<archivo>.etp.json.bak`.
5. Renombrado atómico (`rename`) del archivo temporal sobre el destino final.
