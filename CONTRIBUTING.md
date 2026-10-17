# Guía de Contribución a ElTransportador

Gracias por tu interés en contribuir a **ElTransportador** (`com.eltransportador.desktop`).

## Reglas de Calidad y Seguridad Obligatorias

1. **Cero Secretos en el Repositorio:** Nunca incluyas tokens reales, contraseñas ni certificados privados en commits, fixtures o pruebas. Ejecuta `npm run audit:security` antes de abrir un Pull Request.
2. **Frontera Limpia Frontend/Backend:** No introduzcas llamadas directas al sistema de archivos ni sockets de red dentro de componentes React (`apps/desktop/src/`). Toda operación de E/S debe definirse en `@eltransportador/contracts` y validarse en la capa de comandos.
3. **Pruebas Reproducibles y Offline:** Toda nueva funcionalidad del motor HTTP, persistencia o seguridad debe incluir pruebas automatizadas que utilicen servidores locales efímeros sin depender de internet.
4. **Verificación Previa al Envío:**
   ```bash
   npm run lint
   npm run build
   npm test
   ```
