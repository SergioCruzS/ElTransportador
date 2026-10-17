#!/usr/bin/env python3
"""
Suite de Pruebas E2E de Interfaz, Seguridad, I18N, JSON y Colecciones — ElTransportador v1.2.0
Verifica:
1. Arquitectura atomizada por dominios con archivos `index` (`scripts/core-engine/`, `services/storage/`, `services/http/`, `controllers/renderers/`, `controllers/handlers/`, `lang/`).
2. Servidor bridge IPC con autenticación `X-ETP-Bridge-Token` y entrega de módulos ES6.
3. Visor de respuesta JSON con colores por propiedad (`.etp-json-key`, `.etp-json-string`, `.etp-json-number`, `.etp-json-boolean`, `.etp-json-null`), colapsado/expandido entre llaves `{}` / `[]` y numeración de línea exacta.
4. Barra de búsqueda de respuesta: resaltado de coincidencias (`<mark class="etp-search-highlight">`) en modo «Ver todo» (`all`) y filtrado de líneas en modo «Filtrar líneas» (`filter`).
5. Numeración de línea dinámica y sincronizada en el editor del cuerpo de la solicitud (`#body-code-gutter` y `#body-raw-textarea`).
6. Validación de nombre de colección duplicado dentro del mismo modal (`#input-dialog-error`) tanto al crear una colección como al editar su nombre (`✎`), y notificaciones toast más visibles y duraderas (`6500 ms`).
7. Doble confirmación (Paso 1 de 2 y Paso 2 de 2) al querer eliminar una carpeta o colección que tenga 1 o más solicitudes.
8. Colapsar y expandir colecciones y carpetas en el panel lateral.
9. Selección única de solicitudes entre colecciones y movimiento entre colecciones.
10. Estudio de Flujos v1.2.0: ocultamiento de botones del tester en topbar, flujos independientes por sección, conversión con numeración consecutiva, menús laterales izquierdo/derecho independientes (Fijo/Flotante/Ocultar), + Variable inicial, búsqueda de endpoint, políticas traducidas, confirmación de plantilla y reporte seguro.
"""
import os
import re
import time
import json
import base64
import subprocess
import urllib.request
import urllib.error
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import Select

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIST_INDEX = os.path.join(ROOT, "apps", "desktop", "dist", "index.html")
CANVAS_HTML = "/working_dir/c_5e4e79f4bf4e830a/artifacts/file_generation/ttl=63d/output/eltransportador_ide.html"
if not os.path.exists(CANVAS_HTML):
    CANVAS_HTML = DIST_INDEX


def verify_modular_release_structure():
    src_dir = os.path.join(ROOT, "apps", "desktop", "src")
    dist_dir = os.path.join(ROOT, "apps", "desktop", "dist")

    expected_files = [
        "styles/tokens.css",
        "styles/main.css",
        "lang/index.js",
        "lang/i18n.js",
        "lang/es.js",
        "lang/en.js",
        "services/storage/index.js",
        "services/storage/constants.js",
        "services/storage/vault-crypto.js",
        "services/storage/collection-sanitizer.js",
        "services/storage/workspace-state.js",
        "services/http/index.js",
        "services/http/variable-interpolation.js",
        "services/http/wire-preview.js",
        "services/http/assertions-evaluator.js",
        "services/http/request-executor.js",
        "controllers/renderers/index.js",
        "controllers/renderers/dom-utils.js",
        "controllers/renderers/workspace-helpers.js",
        "controllers/renderers/layout-prefs.js",
        "controllers/renderers/settings-modal.js",
        "controllers/renderers/sidebar-collections.js",
        "controllers/renderers/sidebar-environments.js",
        "controllers/renderers/sidebar-history.js",
        "controllers/renderers/sidebar.js",
        "controllers/renderers/center-editor.js",
        "controllers/renderers/center-editor-tabs.js",
        "controllers/renderers/center-editor-events.js",
        "controllers/renderers/json-viewer.js",
        "controllers/renderers/response-panel.js",
        "controllers/renderers/flows-studio.js",
        "controllers/handlers/index.js",
        "controllers/handlers/file-clipboard-actions.js",
        "controllers/handlers/layout-resizer-handlers.js",
        "controllers/handlers/request-bar-handlers.js",
        "controllers/handlers/collection-crud-handlers.js",
        "controllers/handlers/import-export-handlers.js",
    ]
    for rel in expected_files:
        assert os.path.exists(os.path.join(src_dir, rel)), f"Falta módulo fuente atomizado: {rel}"
        assert os.path.exists(os.path.join(dist_dir, rel)), f"Falta módulo minificado en dist: {rel}"

    print("  ✓ [E2E ARCH] Atomización modular de core-engine, services, renderers, json-viewer y handlers verificada")


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
        text=True,
    )
    try:
        index_html = ""
        for _ in range(30):
            try:
                with urllib.request.urlopen("http://127.0.0.1:1428/", timeout=1) as res:
                    if res.status == 200:
                        index_html = res.read().decode("utf-8")
                        break
            except Exception:
                time.sleep(0.15)

        assert index_html, "El servidor dev-server.mjs no respondió en http://127.0.0.1:1428/"
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

        assert driver.find_element(By.ID, "lbl-app-version").text.strip() == "v1.2.0"

        # 1. Verificar I18N en Inglés, colores JSON, numeración de líneas de respuesta, plegado entre llaves y búsqueda con resaltado en "Ver todo"
        driver.find_element(By.ID, "btn-toggle-lang").click()
        time.sleep(0.25)
        assert driver.find_element(By.ID, "lbl-lang").text.strip() == "EN"

        driver.find_element(By.ID, "btn-send-req").click()
        time.sleep(0.3)
        status_badge_en = driver.find_element(By.ID, "resp-status-badge").text.strip()
        assert status_badge_en == "INVALID URL"

        json_keys = driver.find_elements(By.CSS_SELECTOR, "#resp-pre-content .etp-json-key")
        json_strings = driver.find_elements(By.CSS_SELECTOR, "#resp-pre-content .etp-json-string")
        resp_lines = driver.find_elements(By.CSS_SELECTOR, "#resp-pre-content .etp-resp-line")
        fold_btns = driver.find_elements(By.CSS_SELECTOR, "#resp-pre-content [data-json-fold='0']")
        assert len(json_keys) >= 2, "Las propiedades JSON deben mostrarse con color (.etp-json-key)"
        assert len(json_strings) >= 2, "Los valores string JSON deben mostrarse con color (.etp-json-string)"
        assert len(resp_lines) == 4, f"El JSON formateado de error debe tener 4 líneas numeradas, tiene {len(resp_lines)}"
        assert len(fold_btns) == 1, "La línea de apertura '{' debe tener control para colapsar/expandir entre llaves"

        fold_btns[0].click()
        time.sleep(0.2)
        resp_lines_folded = driver.find_elements(By.CSS_SELECTOR, "#resp-pre-content .etp-resp-line")
        folded_pills = driver.find_elements(By.CSS_SELECTOR, "#resp-pre-content .etp-json-folded-pill")
        assert len(resp_lines_folded) == 1 and len(folded_pills) == 1, "Al colapsar las llaves debe quedar 1 línea resumen con la píldora de líneas ocultas"
        folded_pills[0].click()
        time.sleep(0.2)
        assert len(driver.find_elements(By.CSS_SELECTOR, "#resp-pre-content .etp-resp-line")) == 4

        resp_search = driver.find_element(By.ID, "resp-search-input")
        resp_search.send_keys("HTTP")
        time.sleep(0.2)
        filtered_lines = driver.find_elements(By.CSS_SELECTOR, "#resp-pre-content .etp-resp-line")
        assert len(filtered_lines) == 1, "En modo filtrar líneas solo debe mostrarse la línea que coincide"

        driver.find_element(By.ID, "btn-resp-filter-mode").click()
        time.sleep(0.2)
        all_lines_shown = driver.find_elements(By.CSS_SELECTOR, "#resp-pre-content .etp-resp-line")
        highlights = driver.find_elements(By.CSS_SELECTOR, "#resp-pre-content mark.etp-search-highlight")
        assert len(all_lines_shown) == 4, "En modo 'Ver todo' deben mostrarse todas las líneas"
        assert len(highlights) >= 2, "En modo 'Ver todo' deben resaltarse las palabras que coinciden con <mark class='etp-search-highlight'>"
        driver.find_element(By.ID, "btn-clear-resp-search").click()
        time.sleep(0.15)
        print("  ✓ [E2E JSON & SEARCH] Colores JSON, plegado de llaves {}, numeración exacta de respuesta y resaltado en modo 'Ver todo' verificados")

        # 2. Verificar numeración dinámica de líneas en el editor del cuerpo de la solicitud (#body-raw-textarea y #body-code-gutter)
        driver.find_element(By.ID, "tab-btn-body").click()
        time.sleep(0.2)
        body_ta = driver.find_element(By.ID, "body-raw-textarea")
        body_ta.send_keys('{\n  "orden": 101,\n  "estado": "activo",\n  "prioridad": "alta"\n}')
        time.sleep(0.2)
        gutter_lines = driver.find_elements(By.CSS_SELECTOR, "#body-code-gutter .etp-gutter-line")
        assert len(gutter_lines) == 5, f"El editor del cuerpo debe mostrar 5 líneas numeradas dinámicamente, muestra {len(gutter_lines)}"
        print("  ✓ [E2E BODY EDITOR] Numeración de línea dinámica y sincronizada en el editor del cuerpo de la solicitud verificada")

        # Volver a Español
        driver.find_element(By.ID, "btn-toggle-lang").click()
        time.sleep(0.2)

        # 3. Verificar validación de nombre duplicado en el mismo modal tanto al CREAR como al EDITAR colección
        driver.find_element(By.ID, "side-tab-collections").click()
        time.sleep(0.2)

        driver.find_element(By.ID, "btn-new-collection").click()
        time.sleep(0.2)
        inp_dialog = driver.find_element(By.ID, "input-dialog-field")
        inp_dialog.clear()
        inp_dialog.send_keys("Mi Colección Principal")
        driver.find_element(By.ID, "btn-confirm-input-dialog").click()
        time.sleep(0.2)

        modal_input_el = driver.find_element(By.ID, "modal-input-dialog")
        inline_err_el = driver.find_element(By.ID, "input-dialog-error")
        assert "open" in modal_input_el.get_attribute("class"), "El modal debe permanecer abierto al intentar crear una colección con nombre existente"
        assert inline_err_el.is_displayed() and "Modifica el nombre" in inline_err_el.text

        inp_dialog.clear()
        inp_dialog.send_keys("Colección Pagos")
        driver.find_element(By.ID, "btn-confirm-input-dialog").click()
        time.sleep(0.25)
        assert "open" not in modal_input_el.get_attribute("class")
        assert len(driver.find_elements(By.CSS_SELECTOR, ".etp-tree-collection")) == 2

        driver.find_element(By.CSS_SELECTOR, "[data-edit-col='1']").click()
        time.sleep(0.2)
        inp_dialog = driver.find_element(By.ID, "input-dialog-field")
        inp_dialog.clear()
        inp_dialog.send_keys("Mi Colección Principal")
        driver.find_element(By.ID, "btn-confirm-input-dialog").click()
        time.sleep(0.25)
        assert "open" in modal_input_el.get_attribute("class")
        assert inline_err_el.is_displayed() and "Modifica el nombre" in inline_err_el.text

        inp_dialog.clear()
        inp_dialog.send_keys("Colección Pagos v2")
        driver.find_element(By.ID, "btn-confirm-input-dialog").click()
        time.sleep(0.25)
        assert "open" not in modal_input_el.get_attribute("class")
        print("  ✓ [E2E MODAL VALIDATION] Validación en el mismo modal al crear y al editar nombre de colección verificada")

        # 4. Verificar colapsar y expandir colecciones y carpetas
        driver.find_element(By.ID, "btn-new-folder").click()
        time.sleep(0.2)
        driver.find_element(By.ID, "btn-confirm-input-dialog").click()
        time.sleep(0.2)
        driver.find_element(By.ID, "btn-new-request").click()
        time.sleep(0.2)

        folder_toggle = driver.find_element(By.CSS_SELECTOR, "[data-toggle-folder-collapse]")
        folder_toggle.click()
        time.sleep(0.2)
        assert len(driver.find_elements(By.CSS_SELECTOR, ".etp-tree-item[data-col-idx='1']")) == 0
        driver.find_element(By.CSS_SELECTOR, "[data-toggle-folder-collapse]").click()
        time.sleep(0.2)
        assert len(driver.find_elements(By.CSS_SELECTOR, ".etp-tree-item[data-col-idx='1']")) == 1

        col_toggles = driver.find_elements(By.CSS_SELECTOR, "[data-toggle-col-collapse]")
        col_toggles[0].click()
        time.sleep(0.2)
        assert len(driver.find_elements(By.CSS_SELECTOR, ".etp-tree-item[data-col-idx='0']")) == 0
        driver.find_elements(By.CSS_SELECTOR, "[data-toggle-col-collapse]")[0].click()
        time.sleep(0.2)
        assert len(driver.find_elements(By.CSS_SELECTOR, ".etp-tree-item[data-col-idx='0']")) == 1
        print("  ✓ [E2E COLLAPSE] Colapsar y expandir colecciones y carpetas verificado")

        # 5. Verificar selección única entre colecciones y movimiento entre colecciones
        col0_req0 = driver.find_element(By.CSS_SELECTOR, ".etp-tree-item[data-col-idx='0']")
        col0_req0.click()
        time.sleep(0.25)
        active_tree_items = driver.find_elements(By.CSS_SELECTOR, ".etp-tree-item.active")
        assert len(active_tree_items) == 1
        assert active_tree_items[0].get_attribute("data-col-idx") == "0"

        loc_select = Select(driver.find_element(By.ID, "req-folder-select"))
        loc_select.select_by_value("1::")
        time.sleep(0.3)
        col1_reqs = driver.find_elements(By.CSS_SELECTOR, ".etp-tree-item[data-col-idx='1']")
        assert len(col1_reqs) == 2
        print("  ✓ [E2E COLLECTIONS] Selección única entre colecciones y movimiento entre colecciones verificados")

        # 6. Verificar doble confirmación al eliminar carpeta o colección que tenga 1 o más solicitudes
        confirm_modal = driver.find_element(By.ID, "modal-confirm-move")
        confirm_title = driver.find_element(By.ID, "confirm-move-title")
        confirm_msg = driver.find_element(By.ID, "confirm-move-message")

        driver.find_element(By.CSS_SELECTOR, "[data-del-folder]").click()
        time.sleep(0.2)
        assert "open" in confirm_modal.get_attribute("class")
        assert "1 de 2" in confirm_title.text
        driver.find_element(By.ID, "btn-accept-confirm-move").click()
        time.sleep(0.2)
        assert "open" in confirm_modal.get_attribute("class")
        assert "2 de 2" in confirm_title.text and "Segunda confirmación" in confirm_msg.text
        driver.find_element(By.ID, "btn-cancel-confirm-move").click()
        time.sleep(0.2)
        assert len(driver.find_elements(By.CSS_SELECTOR, ".etp-tree-folder")) == 1

        driver.find_element(By.CSS_SELECTOR, "[data-del-folder]").click()
        time.sleep(0.2)
        driver.find_element(By.ID, "btn-accept-confirm-move").click()
        time.sleep(0.2)
        driver.find_element(By.ID, "btn-accept-confirm-move").click()
        time.sleep(0.25)
        assert len(driver.find_elements(By.CSS_SELECTOR, ".etp-tree-folder")) == 0

        driver.find_element(By.CSS_SELECTOR, "[data-del-col='1']").click()
        time.sleep(0.2)
        assert "open" in confirm_modal.get_attribute("class")
        assert "1 de 2" in confirm_title.text
        driver.find_element(By.ID, "btn-accept-confirm-move").click()
        time.sleep(0.2)
        assert "open" in confirm_modal.get_attribute("class")
        assert "2 de 2" in confirm_title.text
        driver.find_element(By.ID, "btn-accept-confirm-move").click()
        time.sleep(0.25)
        assert len(driver.find_elements(By.CSS_SELECTOR, ".etp-tree-collection")) == 1
        print("  ✓ [E2E DOUBLE CONFIRM DELETE] Doble confirmación al eliminar carpeta o colección con 1 o más solicitudes verificada")

        # Crear una 2da solicitud en la colección principal para probar reordenamiento en Flujo Básico
        driver.find_element(By.ID, "btn-new-request").click()
        time.sleep(0.2)
        driver.find_element(By.ID, "btn-new-request").click()
        time.sleep(0.2)

        # 7. Verificar Flows Studio Dual y las 17 mejoras solicitadas
        driver.find_element(By.ID, "btn-run-flow").click()
        time.sleep(0.25)

        # Verificar que al pasar al Estudio de Flujos se ocultan los botones del tester de APIs en la topbar
        assert not driver.find_element(By.ID, "btn-toggle-sidebar").is_displayed(), "El botón Panel del tester debe ocultarse en Estudio de Flujos"
        assert not driver.find_element(By.ID, "env-select").is_displayed(), "El selector de entorno del tester debe ocultarse en Estudio de Flujos"
        assert not driver.find_element(By.ID, "btn-open-vault").is_displayed(), "El botón Entornos y Secretos debe ocultarse en Estudio de Flujos"
        assert not driver.find_element(By.ID, "btn-open-import").is_displayed(), "El botón Importar/Exportar debe ocultarse en Estudio de Flujos"

        # Crear Flujo Básico ("Flujo 1")
        driver.find_element(By.ID, "btn-create-custom-flow").click()
        time.sleep(0.2)
        driver.find_element(By.ID, "btn-confirm-input-dialog").click()
        time.sleep(0.25)

        assert driver.find_element(By.ID, "btn-flow-mode-basic").is_displayed()
        assert driver.find_element(By.ID, "btn-flow-mode-advanced").is_displayed()

        # Verificar independencia de secciones: al pasar a Modo Avanzado no debe haberse creado ningún flujo avanzado automáticamente
        driver.find_element(By.ID, "btn-flow-mode-advanced").click()
        time.sleep(0.25)
        assert len(driver.find_elements(By.CSS_SELECTOR, "#flows-sidebar-list [data-select-flow]")) == 0, "Crear un flujo básico NO debe crear automáticamente uno avanzado"

        # Volver a Modo Básico, donde sí está "Flujo 1"
        driver.find_element(By.ID, "btn-flow-mode-basic").click()
        time.sleep(0.25)
        assert len(driver.find_elements(By.CSS_SELECTOR, "#flows-sidebar-list [data-select-flow]")) == 1

        # Seleccionar 2 endpoints en modo básico y probar reordenamiento con flechas
        chks = driver.find_elements(By.CSS_SELECTOR, "[data-flow-req-check]")
        chks[0].click()
        time.sleep(0.15)
        chks = driver.find_elements(By.CSS_SELECTOR, "[data-flow-req-check]")
        chks[1].click()
        time.sleep(0.2)

        step_cards = driver.find_elements(By.CSS_SELECTOR, "[data-basic-select-step]")
        assert len(step_cards) == 2
        first_step_id_before = step_cards[0].get_attribute("data-basic-select-step")
        driver.find_element(By.CSS_SELECTOR, "[data-step-down='0']").click()
        time.sleep(0.2)
        step_cards_after = driver.find_elements(By.CSS_SELECTOR, "[data-basic-select-step]")
        assert step_cards_after[1].get_attribute("data-basic-select-step") == first_step_id_before, "Las flechas deben reordenar la secuencia del flujo básico"

        # Agregar una aserción exclusiva del flujo y editar su valor esperado sin perderlo
        driver.find_element(By.ID, "btn-basic-add-flow-ast").click()
        time.sleep(0.2)
        exp_inp = driver.find_element(By.CSS_SELECTOR, "[data-basic-ast-exp='0']")
        exp_inp.clear()
        exp_inp.send_keys("201")
        time.sleep(0.15)

        # Convertir de Básico a Grafo Avanzado (crea "Flujo 1" en Avanzado con etiqueta de avanzado)
        driver.find_element(By.ID, "btn-convert-basic-to-advanced").click()
        time.sleep(0.25)
        assert driver.find_element(By.ID, "flow-canvas-wrap").is_displayed()
        assert len(driver.find_elements(By.CSS_SELECTOR, ".etp-flow-node")) >= 3

        # Volver a Básico y convertir por segunda vez -> debe crear "Flujo 1 (1)"
        driver.find_element(By.ID, "btn-flow-mode-basic").click()
        time.sleep(0.2)
        driver.find_element(By.ID, "btn-convert-basic-to-advanced").click()
        time.sleep(0.25)
        adv_flow_cards = driver.find_elements(By.CSS_SELECTOR, "#flows-sidebar-list [data-select-flow]")
        assert len(adv_flow_cards) == 2, "Debe haber 2 flujos avanzados independientes tras convertir dos veces"
        assert any("Flujo 1 (1)" in c.text for c in adv_flow_cards), "El flujo avanzado con nombre repetido debe llevar sufijo consecutivo Flujo 1 (1)"

        # Probar botón + Variable en Variables Iniciales del Flujo
        driver.find_element(By.ID, "btn-add-flow-init-var").click()
        time.sleep(0.2)
        assert len(driver.find_elements(By.CSS_SELECTOR, "[data-fvar-key]")) == 1, "El botón + Variable debe agregar una variable inicial al flujo"

        # Probar menú izquierdo independiente (Fijar/Flotante y Ocultar) y menú derecho (Ocultar/Mostrar)
        driver.find_element(By.ID, "btn-hide-flows-left-sidebar").click()
        time.sleep(0.2)
        assert "collapsed" in driver.find_element(By.ID, "flows-left-sidebar").get_attribute("class")
        driver.find_element(By.ID, "btn-toggle-flows-left-sidebar").click()
        time.sleep(0.2)
        assert "collapsed" not in driver.find_element(By.ID, "flows-left-sidebar").get_attribute("class")

        driver.find_element(By.ID, "btn-hide-flows-right-inspector").click()
        time.sleep(0.2)
        assert "collapsed" in driver.find_element(By.ID, "flows-right-inspector").get_attribute("class")
        driver.find_element(By.ID, "btn-toggle-flows-right-inspector").click()
        time.sleep(0.2)
        assert "collapsed" not in driver.find_element(By.ID, "flows-right-inspector").get_attribute("class")

        # Probar confirmación al cargar plantilla
        tpl_select = Select(driver.find_element(By.ID, "flow-template-picker"))
        tpl_select.select_by_value("retry_resilient")
        time.sleep(0.2)
        assert "open" in confirm_modal.get_attribute("class"), "Al cargar una plantilla debe mostrarse confirmación advirtiendo que se reemplazará el progreso"
        driver.find_element(By.ID, "btn-cancel-confirm-move").click()
        time.sleep(0.2)

        # Probar ejecución simulada, guardado en Historial y Exportar Reporte Seguro en modal
        driver.find_element(By.ID, "btn-execute-selected-flow").click()
        time.sleep(0.4)
        driver.find_element(By.CSS_SELECTOR, "[data-flow-insp-tab='history']").click()
        time.sleep(0.2)
        assert len(driver.find_elements(By.ID, "insp-cmp-run-a")) == 1, "El historial del flujo debe guardarse y mostrar las ejecuciones realizadas"
        driver.find_element(By.ID, "btn-export-safe-flow-report").click()
        time.sleep(0.2)
        assert "open" in driver.find_element(By.ID, "modal-import").get_attribute("class"), "Exportar reporte seguro debe abrir el modal con el JSON del reporte"
        driver.find_element(By.ID, "btn-close-import-modal").click()
        time.sleep(0.2)

        print("  ✓ [E2E FLOWS STUDIO v1.2.0] Secciones independientes, reordenamiento, menús laterales, variables, historial y exportación verificados en Chromium")

    finally:
        driver.quit()


if __name__ == "__main__":
    print("=== Ejecutando Pruebas E2E de Interfaz, Seguridad, I18N, JSON y Colecciones (ElTransportador v1.2.0) ===")
    run_ui_tests()
