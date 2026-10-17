# ElTransportador (v1.0.0) — IDE Multiplataforma para Pruebas de API

- **Identificador oficial:** `com.eltransportador.desktop`
- **Paquete de escritorio:** `eltransportador-desktop`
- **Versión actual:** `v1.0.0`
- **Prefijo de variables:** `ELTRANSPORTADOR_`
- **Idiomas incluidos:** Español (`es`) e Inglés (`en`) con cobertura 100% en `apps/desktop/src/lang/`

## 1. Arquitectura Modular del Frontend y Backend (`v1.0.0`)

El proyecto separa estrictamente la estructura HTML por componentes, las hojas de estilo, los diccionarios de internacionalización, los servicios de red/almacenamiento y los controladores de interfaz:

```text
eltransportador/
├── apps/desktop/
│   ├── src/
│   │   ├── app/
│   │   │   └── template.html              # Shell raíz limpio (sin estilos ni scripts embebidos)
│   │   ├── components/                    # Componentes HTML modulares
│   │   │   ├── topbar.html                # Barra superior y buscador global con filtros de alcance
│   │   │   ├── sidebar.html               # Navegador de proyecto (redimensionable con el mouse)
│   │   │   ├── request-editor.html        # Constructor de solicitudes con selector de Colección/Carpeta
│   │   │   ├── response-viewer.html       # Inspector de respuestas con buscador y contador de coincidencias
│   │   │   ├── flows-studio.html          # Pantalla dedicada para el Estudio y Ejecución de Flujos
│   │   │   └── modals.html                # Modales de edición, confirmación Drag&Drop y Sincronización DynamoDB
│   │   ├── styles/                        # Hojas de estilo separadas
│   │   │   ├── tokens.css                 # Tokens de diseño (temas Claro y Oscuro, tipografía)
│   │   │   └── main.css                   # Estilos de componentes, vistas, tablas y etiquetas de sincronización
│   │   ├── lang/                          # Internacionalización (I18N) independiente
│   │   │   ├── es.json                    # Diccionario completo en Español
│   │   │   ├── en.json                    # Diccionario completo en Inglés
│   │   │   └── i18n.js                    # Motor de traducción e interpolación DOM
│   │   ├── services/                      # Servicios desacoplados del HTML (sin datos de prueba en Release)
│   │   │   ├── storage-sync.js            # Persistencia de espacio de trabajo, preferencias de vista y estado DynamoDB
│   │   │   └── http-client.js             # Cliente de ejecución HTTP (Tauri IPC / Bridge / Fetch) y evaluador de aserciones
│   │   └── controllers/                   # Controladores de interfaz
│   │       ├── ui-renderers.js            # Renderizadores modulares de árbol, editor, respuesta y estudio de flujos
│   │       └── app-controller.js          # Eventos globales, Drag & Drop entre colecciones/carpetas/raíz y atajos
│   └── src-tauri/                         # Backend nativo en Rust (Tauri 2 + reqwest + rustls-tls)
├── docs/
│   ├── PLAN_SINCRONIZACION_DYNAMODB.md    # Plan arquitectónico detallado de sincronización híbrida con Amazon DynamoDB
│   ├── architecture.md
│   ├── security.md
│   └── storage-format.md
├── scripts/
│   ├── build-all.mjs                      # Ensamblador modular hacia apps/desktop/dist/
│   ├── core-engine.mjs                    # Motor HTTP Node.js, bóveda AES-256-GCM y repositorio SQLite
│   ├── dev-server.mjs                     # Servidor de desarrollo local
│   └── run-all-tests.mjs                  # Suite completa de verificación (Unitarias, Integración, Seguridad y E2E)
└── tests/                                 # Pruebas automatizadas aisladas de la compilación de Release
```

## 2. Compilación y Ejecución

```bash
# 1. Compilar los componentes modulares hacia apps/desktop/dist/
node scripts/build-all.mjs

# 2. Ejecutar suites de pruebas (Análisis estático, Unitarias, Integración, Seguridad y UI E2E)
node scripts/run-all-tests.mjs

# 3. Generar el ejecutable nativo (.exe / .msi / .deb / .dmg) con Tauri 2
cd apps/desktop
cargo tauri build
```
