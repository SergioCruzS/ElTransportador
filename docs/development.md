# Guía de Desarrollo, Compilación y Distribución — ElTransportador

## 1. Requisitos del Sistema por Plataforma

### Linux (Debian / Ubuntu)
```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libsecret-1-dev
```

### Windows 10 / 11
- Microsoft Visual Studio C++ Build Tools (Desktop development with C++).
- WebView2 Runtime (incluido por defecto en Windows 11 y Windows 10 actualizado).
- Rust stable (`x86_64-pc-windows-msvc`).

### macOS (12 Monterey+)
- Xcode Command Line Tools (`xcode-select --install`).
- Targets de Rust para binario universal:
  ```bash
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  ```

## 2. Comandos de Desarrollo y Verificación Local

| Acción | Comando Exacto |
| :--- | :--- |
| Validar AST y tipos TypeScript/JSX/ESM | `npm run lint` (`node scripts/lint-check.mjs`) |
| Compilar bundle de interfaz | `npm run build` (`node scripts/build-all.mjs`) |
| Ejecutar todas las pruebas automatizadas | `npm test` (`node scripts/run-all-tests.mjs`) |
| Ejecutar pruebas unitarias | `npm run test:unit` |
| Ejecutar pruebas de integración HTTP + SQLite | `npm run test:integration` |
| Ejecutar pruebas de seguridad | `npm run test:security` |
| Ejecutar pruebas E2E en Chromium Headless | `npm run test:e2e` |
| Ejecutar auditoría y generar SBOM | `npm run audit:security` |
| Medir métricas de memoria y rendimiento | `npm run benchmark` |
| Ejecutar colección por CLI | `node scripts/eltransportador-cli.mjs run packages/test-fixtures/collections/pasarela-pagos.etp.json` |
| Compilar aplicación nativa Tauri 2 | `cd apps/desktop && cargo tauri build` |
| Ejecutar pruebas nativas Rust | `cargo test --workspace` |

## 3. Firma de Artefactos, Instalación y Desinstalación

- **Windows:** Los instaladores `.msi` y `.exe` (NSIS) se firman mediante SignTool con certificado EV/OV almacenado en Azure Key Vault o GitHub Secrets. Se desinstalan desde *Configuración -> Aplicaciones instaladas -> ElTransportador*.
- **macOS:** El bundle `.app` y la imagen `.dmg` se firman con `codesign` (`Developer ID Application`) y se notarizan ante Apple mediante `xcrun notarytool`.
- **Linux:** Paquetes `.deb` (`sudo dpkg -i eltransportador-desktop_1.0.0_amd64.deb` / `sudo apt remove eltransportador-desktop`) y binarios autónomos `.AppImage` verificados con firma minisign de Tauri Updater y sumas `SHA-256`.
