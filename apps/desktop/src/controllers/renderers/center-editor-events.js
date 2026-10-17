/**
 * Enlazador de Eventos de Subpestañas del Editor Central — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/center-editor-events.js
 */
import { translate } from "../../lang/i18n.js";
import { syncActiveRequestToCollection } from "./workspace-helpers.js";

export function bindCenterEditorSubTabEvents(state, req, pane, renderCenterEditorFn, renderAll) {
  if (state.reqSubTab === "params") {
    document.getElementById("btn-add-param").addEventListener("click", () => {
      req.params.push({ id: "p_" + Date.now(), key: "", value: "", description: "", enabled: true });
      syncActiveRequestToCollection(state);
      renderCenterEditorFn(state, renderAll);
    });
    pane.querySelectorAll("[data-param-toggle]").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        req.params[Number(chk.getAttribute("data-param-toggle"))].enabled = e.target.checked;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-param-key]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        req.params[Number(inp.getAttribute("data-param-key"))].key = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-param-val]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        req.params[Number(inp.getAttribute("data-param-val"))].value = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-param-desc]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        req.params[Number(inp.getAttribute("data-param-desc"))].description = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-param-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        req.params.splice(Number(btn.getAttribute("data-param-del")), 1);
        syncActiveRequestToCollection(state);
        renderCenterEditorFn(state, renderAll);
      });
    });
  }

  if (state.reqSubTab === "headers") {
    document.getElementById("btn-add-header").addEventListener("click", () => {
      req.headers.push({ id: "h_" + Date.now(), key: "", value: "", enabled: true, isSecret: false });
      syncActiveRequestToCollection(state);
      renderCenterEditorFn(state, renderAll);
    });
    pane.querySelectorAll("[data-hdr-toggle]").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        req.headers[Number(chk.getAttribute("data-hdr-toggle"))].enabled = e.target.checked;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-hdr-key]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        req.headers[Number(inp.getAttribute("data-hdr-key"))].key = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-hdr-val]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        req.headers[Number(inp.getAttribute("data-hdr-val"))].value = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-hdr-sec]").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        const idx = Number(chk.getAttribute("data-hdr-sec"));
        req.headers[idx].isSecret = e.target.checked;
        req.headers[idx]._userToggledSecret = true;
        syncActiveRequestToCollection(state);
        renderCenterEditorFn(state, renderAll);
      });
    });
    pane.querySelectorAll("[data-hdr-reveal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-hdr-reveal"));
        const rKey = `${req.id}_${idx}`;
        state.revealedHeaders = state.revealedHeaders || {};
        state.revealedHeaders[rKey] = !state.revealedHeaders[rKey];
        renderCenterEditorFn(state, renderAll);
      });
    });
    pane.querySelectorAll("[data-hdr-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        req.headers.splice(Number(btn.getAttribute("data-hdr-del")), 1);
        syncActiveRequestToCollection(state);
        renderCenterEditorFn(state, renderAll);
      });
    });
  }

  if (state.reqSubTab === "auth") {
    document.getElementById("auth-type-select").addEventListener("change", (e) => {
      req.auth = { ...req.auth, type: e.target.value };
      syncActiveRequestToCollection(state);
      renderCenterEditorFn(state, renderAll);
    });
    const bearerInp = document.getElementById("auth-bearer-input");
    if (bearerInp) {
      bearerInp.addEventListener("input", (e) => {
        req.auth.bearerToken = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
    const btnToggleBearer = document.getElementById("btn-toggle-bearer-vis");
    if (btnToggleBearer) {
      btnToggleBearer.addEventListener("click", () => {
        state.showBearerToken = !state.showBearerToken;
        renderCenterEditorFn(state, renderAll);
      });
    }
    const bUser = document.getElementById("auth-basic-user");
    if (bUser) {
      bUser.addEventListener("input", (e) => {
        req.auth.basicUsername = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
    const bPass = document.getElementById("auth-basic-pass");
    if (bPass) {
      bPass.addEventListener("input", (e) => {
        req.auth.basicPassword = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
    const btnTogglePass = document.getElementById("btn-toggle-basic-pass");
    if (btnTogglePass) {
      btnTogglePass.addEventListener("click", () => {
        state.showBasicPassword = !state.showBasicPassword;
        renderCenterEditorFn(state, renderAll);
      });
    }
    const akName = document.getElementById("auth-apikey-name");
    if (akName) {
      akName.addEventListener("input", (e) => {
        req.auth.apiKeyName = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
    const akVal = document.getElementById("auth-apikey-val");
    if (akVal) {
      akVal.addEventListener("input", (e) => {
        req.auth.apiKeyValue = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
    const btnToggleApiKey = document.getElementById("btn-toggle-apikey-vis");
    if (btnToggleApiKey) {
      btnToggleApiKey.addEventListener("click", () => {
        state.showApiKeyValue = !state.showApiKeyValue;
        renderCenterEditorFn(state, renderAll);
      });
    }
    const akIn = document.getElementById("auth-apikey-in");
    if (akIn) {
      akIn.addEventListener("change", (e) => {
        req.auth.apiKeyIn = e.target.value;
        syncActiveRequestToCollection(state);
      });
    }
  }

  if (state.reqSubTab === "body") {
    document.getElementById("body-mode-select").addEventListener("change", (e) => {
      req.body = { ...req.body, mode: e.target.value };
      syncActiveRequestToCollection(state);
      renderCenterEditorFn(state, renderAll);
    });
    const ta = document.getElementById("body-raw-textarea");
    if (ta) {
      const syncBodyGutterAndJsonStatus = () => {
        req.body.raw = ta.value;
        if (req.body.mode === "none" && req.body.raw.trim().length > 0) {
          req.body.mode = "json";
          const modeSel = document.getElementById("body-mode-select");
          if (modeSel) modeSel.value = "json";
        }
        const lines = Math.max(1, req.body.raw.split(/\r\n|\r|\n/).length);
        const gutter = document.getElementById("body-code-gutter");
        if (gutter) {
          gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<div class="etp-gutter-line">${i + 1}</div>`).join("");
          gutter.scrollTop = ta.scrollTop;
        }
        const ind = document.getElementById("json-valid-indicator");
        if (ind && req.body.mode === "json") {
          if (!req.body.raw.trim()) {
            ind.textContent = "";
          } else {
            try {
              JSON.parse(req.body.raw);
              ind.style.color = "var(--status-success)";
              ind.textContent = translate(state.lang, "request.jsonValid");
            } catch (err) {
              ind.style.color = "var(--status-danger)";
              ind.textContent = `${translate(state.lang, "request.jsonErrorPrefix")} ${err.message}`;
            }
          }
        }
        syncActiveRequestToCollection(state);
      };

      ta.addEventListener("input", syncBodyGutterAndJsonStatus);
      ta.addEventListener("keyup", syncBodyGutterAndJsonStatus);
      ta.addEventListener("change", syncBodyGutterAndJsonStatus);
      ta.addEventListener("scroll", () => {
        const gutter = document.getElementById("body-code-gutter");
        if (gutter) gutter.scrollTop = ta.scrollTop;
      });
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          ta.value = ta.value.slice(0, start) + "  " + ta.value.slice(end);
          ta.selectionStart = ta.selectionEnd = start + 2;
          syncBodyGutterAndJsonStatus();
        }
      });
      ta.addEventListener("paste", () => {
        setTimeout(() => {
          const val = (ta.value || "").trim();
          if ((req.body.mode === "json" || req.body.mode === "none") && !val.includes("\n") && (val.startsWith("{") || val.startsWith("["))) {
            try {
              ta.value = JSON.stringify(JSON.parse(val), null, 2);
            } catch {}
          }
          syncBodyGutterAndJsonStatus();
        }, 10);
      });
      document.getElementById("btn-prettify-json").addEventListener("click", () => {
        try {
          req.body.raw = JSON.stringify(JSON.parse(req.body.raw || "{}"), null, 2);
          syncActiveRequestToCollection(state);
          renderCenterEditorFn(state, renderAll);
        } catch {}
      });
      document.getElementById("btn-minify-json").addEventListener("click", () => {
        try {
          req.body.raw = JSON.stringify(JSON.parse(req.body.raw || "{}"));
          syncActiveRequestToCollection(state);
          renderCenterEditorFn(state, renderAll);
        } catch {}
      });
    }
    const btnAddUrlenc = document.getElementById("btn-add-urlenc");
    if (btnAddUrlenc) {
      btnAddUrlenc.addEventListener("click", () => {
        req.body.urlencoded.push({ id: "u_" + Date.now(), key: "", value: "", enabled: true });
        syncActiveRequestToCollection(state);
        renderCenterEditorFn(state, renderAll);
      });
      pane.querySelectorAll("[data-urlenc-toggle]").forEach((chk) => {
        chk.addEventListener("change", (e) => {
          req.body.urlencoded[Number(chk.getAttribute("data-urlenc-toggle"))].enabled = e.target.checked;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll("[data-urlenc-key]").forEach((inp) => {
        inp.addEventListener("input", (e) => {
          req.body.urlencoded[Number(inp.getAttribute("data-urlenc-key"))].key = e.target.value;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll("[data-urlenc-val]").forEach((inp) => {
        inp.addEventListener("input", (e) => {
          req.body.urlencoded[Number(inp.getAttribute("data-urlenc-val"))].value = e.target.value;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll("[data-urlenc-del]").forEach((btn) => {
        btn.addEventListener("click", () => {
          req.body.urlencoded.splice(Number(btn.getAttribute("data-urlenc-del")), 1);
          syncActiveRequestToCollection(state);
          renderCenterEditorFn(state, renderAll);
        });
      });
    }
    const btnAddMp = document.getElementById("btn-add-multipart");
    if (btnAddMp) {
      btnAddMp.addEventListener("click", () => {
        req.body.multipart.push({ id: "m_" + Date.now(), key: "", value: "", enabled: true });
        syncActiveRequestToCollection(state);
        renderCenterEditorFn(state, renderAll);
      });
      pane.querySelectorAll("[data-mp-toggle]").forEach((chk) => {
        chk.addEventListener("change", (e) => {
          req.body.multipart[Number(chk.getAttribute("data-mp-toggle"))].enabled = e.target.checked;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll("[data-mp-key]").forEach((inp) => {
        inp.addEventListener("input", (e) => {
          req.body.multipart[Number(inp.getAttribute("data-mp-key"))].key = e.target.value;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll("[data-mp-val]").forEach((inp) => {
        inp.addEventListener("input", (e) => {
          req.body.multipart[Number(inp.getAttribute("data-mp-val"))].value = e.target.value;
          syncActiveRequestToCollection(state);
        });
      });
      pane.querySelectorAll("[data-mp-del]").forEach((btn) => {
        btn.addEventListener("click", () => {
          req.body.multipart.splice(Number(btn.getAttribute("data-mp-del")), 1);
          syncActiveRequestToCollection(state);
          renderCenterEditorFn(state, renderAll);
        });
      });
    }
  }

  if (state.reqSubTab === "assertions") {
    document.getElementById("btn-add-assertion").addEventListener("click", () => {
      req.assertions.push({
        id: "ast_" + Date.now(),
        enabled: true,
        target: "status",
        property: "",
        operator: "equals",
        expected: "200"
      });
      syncActiveRequestToCollection(state);
      renderCenterEditorFn(state, renderAll);
    });
    pane.querySelectorAll("[data-ast-toggle]").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        req.assertions[Number(chk.getAttribute("data-ast-toggle"))].enabled = e.target.checked;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-ast-target]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        req.assertions[Number(sel.getAttribute("data-ast-target"))].target = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-ast-prop]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        req.assertions[Number(inp.getAttribute("data-ast-prop"))].property = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-ast-op]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        req.assertions[Number(sel.getAttribute("data-ast-op"))].operator = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-ast-exp]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        req.assertions[Number(inp.getAttribute("data-ast-exp"))].expected = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-ast-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        req.assertions.splice(Number(btn.getAttribute("data-ast-del")), 1);
        syncActiveRequestToCollection(state);
        renderCenterEditorFn(state, renderAll);
      });
    });

    document.getElementById("btn-add-extraction").addEventListener("click", () => {
      req.extractions.push({
        id: "ext_" + Date.now(),
        enabled: true,
        variableName: translate(state.lang, "environments.defaultNewVarKey"),
        source: "json_path",
        path: "id"
      });
      syncActiveRequestToCollection(state);
      renderCenterEditorFn(state, renderAll);
    });
    pane.querySelectorAll("[data-ext-toggle]").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        req.extractions[Number(chk.getAttribute("data-ext-toggle"))].enabled = e.target.checked;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-ext-var]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        req.extractions[Number(inp.getAttribute("data-ext-var"))].variableName = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-ext-path]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        req.extractions[Number(inp.getAttribute("data-ext-path"))].path = e.target.value;
        syncActiveRequestToCollection(state);
      });
    });
    pane.querySelectorAll("[data-ext-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        req.extractions.splice(Number(btn.getAttribute("data-ext-del")), 1);
        syncActiveRequestToCollection(state);
        renderCenterEditorFn(state, renderAll);
      });
    });
  }

  if (state.reqSubTab === "settings") {
    document.getElementById("set-timeout-input").addEventListener("input", (e) => {
      req.settings.timeoutMs = Number(e.target.value) || 10000;
      syncActiveRequestToCollection(state);
    });
    document.getElementById("set-follow-redir").addEventListener("change", (e) => {
      req.settings.followRedirects = e.target.checked;
      syncActiveRequestToCollection(state);
    });
    document.getElementById("set-max-redir").addEventListener("input", (e) => {
      req.settings.maxRedirects = Number(e.target.value) || 5;
      syncActiveRequestToCollection(state);
    });
    document.getElementById("set-verify-tls").addEventListener("change", (e) => {
      req.settings.verifyTls = e.target.checked;
      syncActiveRequestToCollection(state);
      renderCenterEditorFn(state, renderAll);
    });
  }
}
