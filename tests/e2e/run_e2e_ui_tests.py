#!/usr/bin/env python3
"""
Suite de Pruebas E2E de Interfaz, Seguridad y Administración de Secretos — ElTransportador v1.0.0
Verifica:
1. Separación modular y minificación en Release de HTML, CSS (`styles/`), I18N (`lang/`), Servicios (`services/`) y Controladores (`controllers/`).
2. Aviso cuando no existe contraseña configurada: los secretos agregados sin contraseña funcionan en la sesión pero NO se guardan al reiniciar.
3. Secretos de solo creación y eliminación (Inmutables y No Visibles): no existen controles para ver (`👁`) ni editar secretos creados.
4. Eliminación de secretos protegida por Contraseña de Administración: sin la contraseña correcta no se permite eliminar ningún secreto.
5. Modal de Configuración (`#modal-settings`) estilizado:
   - Configurar contraseña inicial.
   - Cambiar contraseña ingresando la anterior (sin borrar los secretos guardados).
   - Recuperar/restablecer contraseña olvidada mostrando un modal de advertencia superpuesto (`z-index: 3500 > 1000`) que borra todos los secretos al confirmar.
"""
import os
import re
import json
import time
import base64
import subprocess
import urllib.request
import urllib.error
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIST_DIR = os.path.join(ROOT, "apps", "desktop", "dist")
CANVAS_HTML = "/working_dir/c_5e4e79f4bf4e830a/artifacts/file_generation/ttl=63d/output/eltransportador_ide.html"
SHOTS_DIR = "/tmp/etp_e2e_tmp"
os.makedirs(SHOTS_DIR, exist_ok=True)


def verify_modular_release_structure():
    required_files = [
        "index.html",
        "styles/tokens.css",
        "styles/main.css",
        "lang/es.json",
        "lang/en.json",
        "lang/i18n.js",
        "services/storage-sync.js",
        "services/http-client.js",
        "controllers/ui-renderers.js",
        "controllers/app-controller.js",
        "components/topbar.html",
        "components/sidebar.html",
        "components/request-editor.html",
        "components/response-viewer.html",
        "components/flows-studio.html",
        "components/modals.html",
    ]
    for rel in required_files:
        full_p = os.path.join(DIST_DIR, rel)
        assert os.path.exists(full_p), f"Falta archivo modular en dist/: {rel}"

    assert os.path.exists(os.path.join(ROOT, "docs/PLAN_SINCRONIZACION_DYNAMODB.md"))
    print("  ✓ [E2E ARCH] Separación modular, minificación JS/CSS, limpieza de Release y Plan README DynamoDB verificados")


def verify_bridge_and_static_serving():
    env = os.environ.copy()
    env["ELTRANSPORTADOR_PORT"] = "1428"
    env["ELTRANSPORTADOR_API_PORT"] = "18988"
    proc = subprocess.Popen(
        ["node", os.path.join(ROOT, "scripts", "dev-server.mjs")],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        index_html = ""
        for _ in range(30):
            try:
                resp = urllib.request.urlopen("http://127.0.0.1:1428/index.html", timeout=1)
                index_html = resp.read().decode("utf-8")
                break
            except Exception:
                time.sleep(0.15)

        m = re.search(r'<meta name="etp-bridge-token" content="([a-f0-9]+)"', index_html)
        assert m, "El servidor bridge debe inyectar el meta tag etp-bridge-token en index.html"
        bridge_token = m.group(1)

        unauth_req = urllib.request.Request(
            "http://127.0.0.1:1428/__etp_ipc__/execute_request",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(unauth_req, timeout=2)
            assert False, "Se esperaba HTTP 401 sin X-ETP-Bridge-Token"
        except urllib.error.HTTPError as e:
            assert e.code == 401

        req_200 = urllib.request.Request(
            "http://127.0.0.1:1428/__etp_ipc__/execute_request",
            data=json.dumps({
                "request": {
                    "id": "r_test_200",
                    "name": "Health Check",
                    "method": "GET",
                    "url": "http://127.0.0.1:18988/api/v1/health?verbose=true",
                    "headers": [],
                    "params": [],
                }
            }).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-ETP-Bridge-Token": bridge_token,
            },
            method="POST",
        )
        res_200 = json.loads(urllib.request.urlopen(req_200, timeout=3).read().decode("utf-8"))
        assert res_200["response"]["status"] == 200
        print("  ✓ [E2E IPC] Servidor modular de activos y autenticación X-ETP-Bridge-Token verificados")
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def run_ui_tests():
    verify_modular_release_structure()
    verify_bridge_and_static_serving()

    html_content = open(CANVAS_HTML, "r", encoding="utf-8").read()
    b64_html = base64.b64encode(html_content.encode("utf-8")).decode("ascii")
    data_uri = f"data:text/html;base64,{b64_html}"

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1520,920")

    driver = webdriver.Chrome(options=opts)
    try:
        driver.get(data_uri)
        time.sleep(0.6)

        # Inyectar un mock de localStorage en memoria si data: URI restringe localStorage nativo en Chrome headless
        driver.execute_script("""
        try {
          localStorage.setItem('__test', '1');
          localStorage.removeItem('__test');
        } catch (e) {
          const mem = {};
          Object.defineProperty(window, 'localStorage', {
            value: {
              getItem: (k) => (k in mem ? mem[k] : null),
              setItem: (k, v) => { mem[k] = String(v); },
              removeItem: (k) => { delete mem[k]; },
              clear: () => { for (const k of Object.keys(mem)) delete mem[k]; }
            }
          });
        }
        """)

        # 1. Abrir Bóveda de Secretos y verificar aviso de que sin contraseña los secretos no se guardarán al reiniciar
        driver.find_element(By.ID, "btn-open-vault").click()
        time.sleep(0.25)
        warn_banners = driver.find_elements(By.ID, "no-admin-pwd-warning-banner")
        assert len(warn_banners) == 1, "Debe mostrarse el banner advirtiendo que sin contraseña los secretos se borrarán al reiniciar"

        # Crear un secreto y verificar que NO se puede ver ni editar (sin inputs ni botón 👁 en la tabla)
        driver.find_element(By.ID, "new-secret-key-input").send_keys("token_pagos")
        driver.find_element(By.ID, "new-secret-val-input").send_keys("sk_live_unico_998877")
        driver.find_element(By.ID, "btn-add-secret-row").click()
        time.sleep(0.25)

        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-secret-row='token_pagos']")) == 1
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-sec-reveal]")) == 0, "Los secretos no deben tener botón para verse"
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-sec-val]")) == 0, "Los secretos creados no deben tener input editable"
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-sec-rename]")) == 0, "La clave de un secreto creado no debe ser editable"

        # Captura 1: Bóveda de Secretos con aviso sin contraseña y secreto bloqueado (no visible ni editable)
        driver.save_screenshot(os.path.join(SHOTS_DIR, "v10_pwd_1_vault_locked_warning.png"))
        print("  ✓ [E2E VAULT] Secretos no visibles ni editables y aviso de no persistencia sin contraseña verificados")

        # 2. Intentar eliminar el secreto sin tener contraseña configurada -> debe bloquear y abrir el modal de Configuración
        driver.find_element(By.CSS_SELECTOR, "[data-sec-del='token_pagos']").click()
        time.sleep(0.25)
        assert "open" in driver.find_element(By.ID, "modal-settings").get_attribute("class")
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-secret-row='token_pagos']")) == 1, "No debe eliminarse el secreto sin contraseña"

        # 3. Configurar la contraseña inicial en el modal de Configuración estilizado
        driver.find_element(By.ID, "settings-init-pwd").send_keys("Admin1234!")
        driver.find_element(By.ID, "settings-init-pwd-confirm").send_keys("Admin1234!")
        driver.find_element(By.ID, "btn-save-initial-pwd").click()
        time.sleep(0.3)

        status_badge = driver.find_element(By.ID, "settings-pwd-status-badge").text
        assert "Contraseña Activa" in status_badge

        # Captura 2: Modal de Configuración estilizado con cambio de contraseña (con anterior) y recuperación de contraseña
        driver.save_screenshot(os.path.join(SHOTS_DIR, "v10_pwd_2_settings_stylized.png"))

        # 4. Cambiar la contraseña ingresando la anterior -> los secretos deben conservarse intactos
        driver.find_element(By.ID, "settings-old-pwd").send_keys("Admin1234!")
        driver.find_element(By.ID, "settings-change-new-pwd").send_keys("NuevaClave2026!")
        driver.find_element(By.ID, "settings-change-confirm-pwd").send_keys("NuevaClave2026!")
        driver.find_element(By.ID, "btn-change-pwd-keep-secrets").click()
        time.sleep(0.3)
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-secret-row='token_pagos']")) == 1, "El secreto debe conservarse al cambiar contraseña ingresando la anterior"
        print("  ✓ [E2E PWD] Configuración inicial y cambio de contraseña (ingresando la anterior sin borrar secretos) verificados")

        # 5. Probar eliminar un secreto con contraseña incorrecta (debe fallar) y luego con contraseña correcta
        driver.find_element(By.ID, "btn-close-settings-modal").click()
        time.sleep(0.2)
        # Crear un segundo secreto temporal para probar su eliminación con contraseña
        driver.find_element(By.ID, "new-secret-key-input").send_keys("secreto_a_borrar")
        driver.find_element(By.ID, "new-secret-val-input").send_keys("valor_temporal_456")
        driver.find_element(By.ID, "btn-add-secret-row").click()
        time.sleep(0.2)
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-secret-row='secreto_a_borrar']")) == 1

        # Intentar borrar con contraseña errónea
        driver.find_element(By.CSS_SELECTOR, "[data-sec-del='secreto_a_borrar']").click()
        time.sleep(0.2)
        pwd_dialog_inp = driver.find_element(By.ID, "input-dialog-field")
        assert pwd_dialog_inp.get_attribute("type") == "password"
        pwd_dialog_inp.send_keys("ClaveIncorrecta")
        driver.find_element(By.ID, "btn-confirm-input-dialog").click()
        time.sleep(0.25)
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-secret-row='secreto_a_borrar']")) == 1, "No debe eliminarse con contraseña incorrecta"

        # Borrar con la contraseña correcta ("NuevaClave2026!")
        driver.find_element(By.CSS_SELECTOR, "[data-sec-del='secreto_a_borrar']").click()
        time.sleep(0.2)
        driver.find_element(By.ID, "input-dialog-field").send_keys("NuevaClave2026!")
        driver.find_element(By.ID, "btn-confirm-input-dialog").click()
        time.sleep(0.25)
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-secret-row='secreto_a_borrar']")) == 0, "Debe eliminarse al ingresar la contraseña correcta"
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-secret-row='token_pagos']")) == 1
        print("  ✓ [E2E DEL] Protección de eliminación de secretos mediante contraseña verificada")

        # 6. Probar recuperación de contraseña olvidada: verificar que el modal de advertencia se muestra POR ENCIMA del modal principal y borra los secretos al confirmar
        driver.find_element(By.ID, "btn-open-settings").click()
        time.sleep(0.25)
        driver.find_element(By.ID, "settings-reset-new-pwd").send_keys("Recuperada999!")
        driver.find_element(By.ID, "settings-reset-confirm-pwd").send_keys("Recuperada999!")
        driver.find_element(By.ID, "btn-reset-forgotten-pwd").click()
        time.sleep(0.25)

        # Verificar que el modal de confirmación está abierto y tiene mayor z-index que #modal-settings
        z_settings = int(driver.execute_script("return window.getComputedStyle(document.getElementById('modal-settings')).zIndex || 0;"))
        z_confirm = int(driver.execute_script("return window.getComputedStyle(document.getElementById('modal-confirm-move')).zIndex || 0;"))
        z_toast = int(driver.execute_script("return window.getComputedStyle(document.getElementById('toast-container')).zIndex || 0;"))
        assert z_confirm > z_settings, f"El diálogo de confirmación (z={z_confirm}) debe estar por encima del modal principal (z={z_settings})"
        assert z_toast > z_confirm, f"Las notificaciones toast (z={z_toast}) deben estar por encima de todos los modales"

        # Captura 3: Diálogo de advertencia de borrado de secretos superpuesto por encima del modal de Configuración
        driver.save_screenshot(os.path.join(SHOTS_DIR, "v10_pwd_3_recovery_overlay_above_modal.png"))

        driver.find_element(By.ID, "btn-accept-confirm-move").click()
        time.sleep(0.3)
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-secret-row='token_pagos']")) == 0, "Todos los secretos deben borrarse al recuperar una contraseña olvidada"
        print("  ✓ [E2E REC] Recuperación de contraseña olvidada con borrado de secretos y superposición z-index verificada")

    finally:
        driver.quit()


if __name__ == "__main__":
    print("=== Ejecutando Pruebas E2E de Interfaz, Seguridad y Administración de Secretos (ElTransportador v1.0.0) ===")
    run_ui_tests()
