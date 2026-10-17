/**
 * Generadores HTML de Subpestañas del Editor Central (`params`, `headers`, `auth`, `body`, `assertions`, `settings`) — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/center-editor-tabs.js
 */
import { translate } from "../../lang/i18n.js";
import { escapeHtml, escapeAttr } from "./dom-utils.js";
import { getByDotPath, maskSecretsInString } from "../../services/http/index.js";

export function buildCenterEditorSubTabHtml(state, req) {
  let subContentHtml = "";

  if (state.reqSubTab === "params") {
    req.params = Array.isArray(req.params) ? req.params : [];
    const paramRows = req.params
      .map(
        (p, idx) => `
          <tr>
            <td><input type="checkbox" data-param-toggle="${idx}" ${p.enabled ? "checked" : ""} /></td>
            <td><input class="etp-kv-input" data-param-key="${idx}" value="${escapeAttr(p.key || "")}" placeholder="key" /></td>
            <td><input class="etp-kv-input" data-param-val="${idx}" value="${escapeAttr(p.value || "")}" placeholder="value" /></td>
            <td><input class="etp-kv-input" data-param-desc="${idx}" value="${escapeAttr(p.description || "")}" placeholder="${escapeAttr(translate(state.lang, "request.optionalPlaceholder"))}" /></td>
            <td><button type="button" class="etp-icon-btn danger" data-param-del="${idx}">×</button></td>
          </tr>
        `
      )
      .join("");

    subContentHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${escapeHtml(translate(state.lang, "request.paramsTitle"))} (${req.params.length})</strong>
        <button type="button" class="etp-btn-xs" id="btn-add-param">${escapeHtml(translate(state.lang, "request.btnAddParam"))}</button>
      </div>
      <table class="etp-kv-table">
        <thead><tr><th style="width:32px;">${escapeHtml(translate(state.lang, "environments.colOn"))}</th><th>${escapeHtml(translate(state.lang, "environments.colKey"))}</th><th>${escapeHtml(translate(state.lang, "environments.colValue"))}</th><th>${escapeHtml(translate(state.lang, "request.colDescription"))}</th><th style="width:30px;"></th></tr></thead>
        <tbody>
          ${paramRows}
        </tbody>
      </table>
    `;
  } else if (state.reqSubTab === "headers") {
    req.headers = Array.isArray(req.headers) ? req.headers : [];
    const headerRows = req.headers
      .map((h, idx) => {
        const isSensHeader = h._userToggledSecret
          ? Boolean(h.isSecret)
          : Boolean(h.isSecret) ||
            /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test((h.key || "").trim());
        const isRev = Boolean(state.revealedHeaders?.[`${req.id}_${idx}`]);
        const inpType = isSensHeader && !isRev ? "password" : "text";
        const showHideTitle = escapeAttr(translate(state.lang, "environments.showHide"));
        return `
          <tr>
            <td><input type="checkbox" data-hdr-toggle="${idx}" ${h.enabled ? "checked" : ""} /></td>
            <td><input class="etp-kv-input" data-hdr-key="${idx}" value="${escapeAttr(h.key || "")}" placeholder="X-Header" /></td>
            <td><input type="${inpType}" class="etp-kv-input" data-hdr-val="${idx}" value="${escapeAttr(h.value || "")}" placeholder="Value / \${secret:key}" /></td>
            <td>
              <div style="display:flex;align-items:center;gap:4px;">
                <label style="font-size:11px;display:flex;align-items:center;gap:3px;cursor:pointer;"><input type="checkbox" data-hdr-sec="${idx}" ${isSensHeader ? "checked" : ""} /> 🔒</label>
                ${isSensHeader ? `<button type="button" class="etp-icon-btn" data-hdr-reveal="${idx}" title="${showHideTitle}">👁</button>` : ""}
              </div>
            </td>
            <td><button type="button" class="etp-icon-btn danger" data-hdr-del="${idx}">×</button></td>
          </tr>
        `;
      })
      .join("");

    subContentHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${escapeHtml(translate(state.lang, "request.headersTitle"))} (${req.headers.length})</strong>
        <button type="button" class="etp-btn-xs" id="btn-add-header">${escapeHtml(translate(state.lang, "request.btnAddHeader"))}</button>
      </div>
      <table class="etp-kv-table">
        <thead><tr><th style="width:32px;">${escapeHtml(translate(state.lang, "environments.colOn"))}</th><th>Header</th><th>${escapeHtml(translate(state.lang, "environments.colValue"))}</th><th style="width:85px;">${escapeHtml(translate(state.lang, "request.colSecret"))}</th><th style="width:30px;"></th></tr></thead>
        <tbody>
          ${headerRows}
        </tbody>
      </table>
    `;
  } else if (state.reqSubTab === "auth") {
    req.auth = req.auth || { type: "none" };
    const auth = req.auth;
    const showHideTitle = escapeAttr(translate(state.lang, "environments.showHide"));
    subContentHtml = `
      <div class="etp-auth-card">
        <div class="etp-auth-grid">
          <label class="etp-auth-label" for="auth-type-select">${escapeHtml(translate(state.lang, "request.authTypeLabel"))}</label>
          <div class="etp-auth-field-wrap">
            <select id="auth-type-select" class="etp-select">
              <option value="none" ${auth.type === "none" ? "selected" : ""}>${escapeHtml(translate(state.lang, "request.authNone"))}</option>
              <option value="bearer" ${auth.type === "bearer" ? "selected" : ""}>${escapeHtml(translate(state.lang, "request.authBearer"))}</option>
              <option value="basic" ${auth.type === "basic" ? "selected" : ""}>${escapeHtml(translate(state.lang, "request.authBasic"))}</option>
              <option value="apikey" ${auth.type === "apikey" ? "selected" : ""}>${escapeHtml(translate(state.lang, "request.authApiKey"))}</option>
            </select>
          </div>
          ${
            auth.type === "bearer"
              ? `
            <label class="etp-auth-label" for="auth-bearer-input">${escapeHtml(translate(state.lang, "request.authBearerLabel"))}</label>
            <div class="etp-auth-field-wrap">
              <input type="${state.showBearerToken ? "text" : "password"}" id="auth-bearer-input" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(auth.bearerToken || "")}" placeholder="${escapeAttr(translate(state.lang, "request.authBearerPlaceholder"))}" />
              <button type="button" class="etp-btn-xs" id="btn-toggle-bearer-vis" style="height:34px;padding:0 10px;" title="${showHideTitle}">👁</button>
            </div>
          `
              : auth.type === "basic"
              ? `
            <label class="etp-auth-label" for="auth-basic-user">${escapeHtml(translate(state.lang, "request.authUserLabel"))}</label>
            <div class="etp-auth-field-wrap">
              <input type="text" id="auth-basic-user" class="etp-input" value="${escapeAttr(auth.basicUsername || "")}" placeholder="${escapeAttr(translate(state.lang, "request.authUserPlaceholder"))}" />
            </div>
            <label class="etp-auth-label" for="auth-basic-pass">${escapeHtml(translate(state.lang, "request.authPassLabel"))}</label>
            <div class="etp-auth-field-wrap">
              <input type="${state.showBasicPassword ? "text" : "password"}" id="auth-basic-pass" class="etp-input" value="${escapeAttr(auth.basicPassword || "")}" placeholder="${escapeAttr(translate(state.lang, "request.authPassPlaceholder"))}" />
              <button type="button" class="etp-btn-xs" id="btn-toggle-basic-pass" style="height:34px;padding:0 10px;" title="${showHideTitle}">👁</button>
            </div>
          `
              : auth.type === "apikey"
              ? `
            <label class="etp-auth-label" for="auth-apikey-name">${escapeHtml(translate(state.lang, "request.authKeyNameLabel"))}</label>
            <div class="etp-auth-field-wrap">
              <input type="text" id="auth-apikey-name" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(auth.apiKeyName || "X-API-Key")}" placeholder="X-API-Key" />
            </div>
            <label class="etp-auth-label" for="auth-apikey-val">${escapeHtml(translate(state.lang, "request.authKeyValLabel"))}</label>
            <div class="etp-auth-field-wrap">
              <input type="${state.showApiKeyValue ? "text" : "password"}" id="auth-apikey-val" class="etp-input" style="font-family:var(--font-mono);" value="${escapeAttr(auth.apiKeyValue || "")}" placeholder="ak_live_..." />
              <button type="button" class="etp-btn-xs" id="btn-toggle-apikey-vis" style="height:34px;padding:0 10px;" title="${showHideTitle}">👁</button>
            </div>
            <label class="etp-auth-label" for="auth-apikey-in">${escapeHtml(translate(state.lang, "request.authKeyInLabel"))}</label>
            <div class="etp-auth-field-wrap">
              <select id="auth-apikey-in" class="etp-select">
                <option value="header" ${(auth.apiKeyIn || "header") === "header" ? "selected" : ""}>${escapeHtml(translate(state.lang, "request.authKeyInHeader"))}</option>
                <option value="query" ${auth.apiKeyIn === "query" ? "selected" : ""}>${escapeHtml(translate(state.lang, "request.authKeyInQuery"))}</option>
              </select>
            </div>
          `
              : ""
          }
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);padding-top:8px;border-top:1px solid var(--border-subtle);">
          ${auth.type === "none" ? escapeHtml(translate(state.lang, "request.authNoneHint")) : escapeHtml(translate(state.lang, "request.authProtectedHint"))}
        </div>
      </div>
    `;
  } else if (state.reqSubTab === "body") {
    req.body = req.body || { mode: "none", raw: "", urlencoded: [], multipart: [] };
    const body = req.body;
    const rawText = body.raw || "";
    const linesCount = Math.max(1, rawText.split(/\r\n|\r|\n/).length);
    let jsonValidStatus = '<span id="json-valid-indicator"></span>';
    if (body.mode === "json" && rawText.trim()) {
      try {
        JSON.parse(rawText);
        jsonValidStatus = `<span id="json-valid-indicator" style="color:var(--status-success);font-weight:600;">${escapeHtml(translate(state.lang, "request.jsonValid"))}</span>`;
      } catch (err) {
        jsonValidStatus = `<span id="json-valid-indicator" style="color:var(--status-danger);font-weight:600;">${escapeHtml(translate(state.lang, "request.jsonErrorPrefix"))} ${escapeHtml(err.message)}</span>`;
      }
    }

    subContentHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <strong>${escapeHtml(translate(state.lang, "request.bodyModeLabel"))}</strong>
          <select id="body-mode-select" class="etp-select">
            <option value="none" ${body.mode === "none" ? "selected" : ""}>none</option>
            <option value="json" ${body.mode === "json" ? "selected" : ""}>application/json</option>
            <option value="text" ${body.mode === "text" ? "selected" : ""}>text/plain</option>
            <option value="urlencoded" ${body.mode === "urlencoded" ? "selected" : ""}>application/x-www-form-urlencoded</option>
            <option value="multipart" ${body.mode === "multipart" ? "selected" : ""}>multipart/form-data</option>
          </select>
        </div>
        ${jsonValidStatus}
      </div>
    `;

    if (body.mode === "urlencoded") {
      body.urlencoded = Array.isArray(body.urlencoded) ? body.urlencoded : [];
      const uRows = body.urlencoded
        .map(
          (u, idx) => `
            <tr>
              <td><input type="checkbox" data-urlenc-toggle="${idx}" ${u.enabled ? "checked" : ""} /></td>
              <td><input class="etp-kv-input" data-urlenc-key="${idx}" value="${escapeAttr(u.key || "")}" /></td>
              <td><input class="etp-kv-input" data-urlenc-val="${idx}" value="${escapeAttr(u.value || "")}" /></td>
              <td><button type="button" class="etp-icon-btn danger" data-urlenc-del="${idx}">×</button></td>
            </tr>
          `
        )
        .join("");

      subContentHtml += `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span>${escapeHtml(translate(state.lang, "request.urlencTitle"))} (${body.urlencoded.length})</span>
          <button type="button" class="etp-btn-xs" id="btn-add-urlenc">${escapeHtml(translate(state.lang, "request.btnAddField"))}</button>
        </div>
        <table class="etp-kv-table">
          <thead><tr><th style="width:32px;">On</th><th>${escapeHtml(translate(state.lang, "environments.colKey"))}</th><th>${escapeHtml(translate(state.lang, "environments.colValue"))}</th><th style="width:30px;"></th></tr></thead>
          <tbody>
            ${uRows}
          </tbody>
        </table>
      `;
    } else if (body.mode === "multipart") {
      body.multipart = Array.isArray(body.multipart) ? body.multipart : [];
      const mRows = body.multipart
        .map(
          (m, idx) => `
            <tr>
              <td><input type="checkbox" data-mp-toggle="${idx}" ${m.enabled ? "checked" : ""} /></td>
              <td><input class="etp-kv-input" data-mp-key="${idx}" value="${escapeAttr(m.key || "")}" /></td>
              <td><input class="etp-kv-input" data-mp-val="${idx}" value="${escapeAttr(m.value || "")}" /></td>
              <td><button type="button" class="etp-icon-btn danger" data-mp-del="${idx}">×</button></td>
            </tr>
          `
        )
        .join("");

      subContentHtml += `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span>${escapeHtml(translate(state.lang, "request.mpTitle"))} (${body.multipart.length})</span>
          <button type="button" class="etp-btn-xs" id="btn-add-multipart">${escapeHtml(translate(state.lang, "request.btnAddPart"))}</button>
        </div>
        <table class="etp-kv-table">
          <thead><tr><th style="width:32px;">On</th><th>${escapeHtml(translate(state.lang, "environments.colKey"))}</th><th>${escapeHtml(translate(state.lang, "environments.colValue"))}</th><th style="width:30px;"></th></tr></thead>
          <tbody>
            ${mRows}
          </tbody>
        </table>
      `;
    } else {
      subContentHtml += `
        <div class="etp-code-box">
          <div class="etp-code-toolbar">
            <div style="display:flex;gap:6px;">
              <button type="button" class="etp-btn-xs" id="btn-prettify-json">${escapeHtml(translate(state.lang, "request.btnPrettify"))}</button>
              <button type="button" class="etp-btn-xs" id="btn-minify-json">${escapeHtml(translate(state.lang, "request.btnMinify"))}</button>
            </div>
            <span style="font-size:11px;color:var(--text-muted);">${escapeHtml(translate(state.lang, "request.editorHint"))}</span>
          </div>
          <div class="etp-code-body">
            <div class="etp-code-gutter" id="body-code-gutter">${Array.from({ length: linesCount }, (_, i) => `<div class="etp-gutter-line">${i + 1}</div>`).join("")}</div>
            <textarea id="body-raw-textarea" class="etp-code-textarea" wrap="off" spellcheck="false" placeholder="${escapeAttr(translate(state.lang, "request.bodyPlaceholder"))}">${escapeHtml(rawText)}</textarea>
          </div>
        </div>
      `;
    }
  } else if (state.reqSubTab === "assertions") {
    req.assertions = Array.isArray(req.assertions) ? req.assertions : [];
    req.extractions = Array.isArray(req.extractions) ? req.extractions : [];
    const astRows = req.assertions
      .map(
        (a, idx) => `
          <tr>
            <td><input type="checkbox" data-ast-toggle="${idx}" ${a.enabled ? "checked" : ""} /></td>
            <td>
              <select class="etp-select" data-ast-target="${idx}" style="height:26px;font-size:11.5px;width:100%;">
                <option value="status" ${a.target === "status" ? "selected" : ""}>status</option>
                <option value="json_path" ${a.target === "json_path" ? "selected" : ""}>json_path</option>
                <option value="header" ${a.target === "header" ? "selected" : ""}>header</option>
                <option value="body_text" ${a.target === "body_text" ? "selected" : ""}>body_text</option>
                <option value="duration_ms" ${a.target === "duration_ms" ? "selected" : ""}>duration_ms</option>
              </select>
            </td>
            <td><input class="etp-kv-input" data-ast-prop="${idx}" value="${escapeAttr(a.property || "")}" placeholder="results[0].name" /></td>
            <td>
              <select class="etp-select" data-ast-op="${idx}" style="height:26px;font-size:11.5px;width:100%;">
                <option value="equals" ${a.operator === "equals" ? "selected" : ""}>equals</option>
                <option value="not_equals" ${a.operator === "not_equals" ? "selected" : ""}>not_equals</option>
                <option value="contains" ${a.operator === "contains" ? "selected" : ""}>contains</option>
                <option value="exists" ${a.operator === "exists" ? "selected" : ""}>exists</option>
                <option value="less_than" ${a.operator === "less_than" ? "selected" : ""}>less_than</option>
                <option value="greater_than" ${a.operator === "greater_than" ? "selected" : ""}>greater_than</option>
              </select>
            </td>
            <td><input class="etp-kv-input" data-ast-exp="${idx}" value="${escapeAttr(a.expected || "")}" /></td>
            <td><button type="button" class="etp-icon-btn danger" data-ast-del="${idx}">×</button></td>
          </tr>
        `
      )
      .join("");

    const cachedResp = state.responsesByReqId?.[req.id] || null;
    let cachedBodyObj = cachedResp?.bodyObj || null;
    if (!cachedBodyObj && typeof cachedResp?.body === "string" && cachedResp.body.trim()) {
      try { cachedBodyObj = JSON.parse(cachedResp.body); } catch {}
    }
    const extRows = req.extractions
      .map((ex, idx) => {
        let currentVal = state.runtimeVars[ex.variableName];
        if (cachedBodyObj && ex.path) {
          const liveVal = getByDotPath(cachedBodyObj, ex.path);
          if (liveVal !== undefined && liveVal !== null) {
            currentVal = typeof liveVal === "object" ? JSON.stringify(liveVal) : String(liveVal);
            if (ex.enabled && ex.variableName) {
              state.runtimeVars[ex.variableName] = currentVal;
            }
          }
        }
        const displayVal = currentVal !== undefined && currentVal !== ""
          ? maskSecretsInString(String(currentVal), state)
          : translate(state.lang, "request.pendingVal");
        return `
          <tr>
            <td><input type="checkbox" data-ext-toggle="${idx}" ${ex.enabled ? "checked" : ""} /></td>
            <td><input class="etp-kv-input" data-ext-var="${idx}" value="${escapeAttr(ex.variableName || "")}" placeholder="mi_variable" /></td>
            <td><input class="etp-kv-input" data-ext-path="${idx}" value="${escapeAttr(ex.path || "")}" placeholder="results[0].name" /></td>
            <td style="font-family:var(--font-mono);color:var(--accent-secondary);" data-ext-live-val="${idx}">${escapeHtml(displayVal)}</td>
            <td><button type="button" class="etp-icon-btn danger" data-ext-del="${idx}">×</button></td>
          </tr>
        `;
      })
      .join("");

    subContentHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${escapeHtml(translate(state.lang, "request.assertionsTitle"))} (${req.assertions.length})</strong>
        <button type="button" class="etp-btn-xs" id="btn-add-assertion">${escapeHtml(translate(state.lang, "request.btnAddAssertion"))}</button>
      </div>
      <table class="etp-kv-table">
        <thead><tr><th style="width:30px;">On</th><th>${escapeHtml(translate(state.lang, "request.colTarget"))}</th><th>${escapeHtml(translate(state.lang, "request.colProperty"))}</th><th>${escapeHtml(translate(state.lang, "request.colOperator"))}</th><th>${escapeHtml(translate(state.lang, "request.colExpected"))}</th><th style="width:28px;"></th></tr></thead>
        <tbody>
          ${astRows}
        </tbody>
      </table>

      <div style="margin-top:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong>${escapeHtml(translate(state.lang, "request.extractionsTitle"))} (${req.extractions.length})</strong>
          <button type="button" class="etp-btn-xs" id="btn-add-extraction">${escapeHtml(translate(state.lang, "request.btnAddExtraction"))}</button>
        </div>
        <table class="etp-kv-table">
          <thead><tr><th style="width:30px;">On</th><th>${escapeHtml(translate(state.lang, "request.colDestVar"))}</th><th>${escapeHtml(translate(state.lang, "request.colJsonPath"))}</th><th>${escapeHtml(translate(state.lang, "request.colCurrentVal"))}</th><th style="width:28px;"></th></tr></thead>
          <tbody>
            ${extRows}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.reqSubTab === "settings") {
    req.settings = req.settings || { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, verifyTls: true };
    const s = req.settings;
    subContentHtml = `
      <div class="etp-auth-card">
        <div class="etp-auth-grid">
          <label class="etp-auth-label" for="set-timeout-input">${escapeHtml(translate(state.lang, "request.timeoutLabel"))}</label>
          <div class="etp-auth-field-wrap">
            <input type="number" id="set-timeout-input" class="etp-input" value="${Number(s.timeoutMs) || 10000}" style="max-width:160px;" />
          </div>
          <label class="etp-auth-label">${escapeHtml(translate(state.lang, "request.redirectsLabel"))}</label>
          <div class="etp-auth-field-wrap">
            <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="set-follow-redir" ${s.followRedirects ? "checked" : ""} /> ${escapeHtml(translate(state.lang, "request.followRedirects"))}</label>
            <input type="number" id="set-max-redir" class="etp-input" value="${Number(s.maxRedirects ?? 5)}" style="width:70px;height:28px;" />
            <span>)</span>
          </div>
          <label class="etp-auth-label">${escapeHtml(translate(state.lang, "request.tlsLabel"))}</label>
          <div class="etp-auth-field-wrap" style="flex-direction:column;align-items:flex-start;gap:6px;">
            <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="set-verify-tls" ${s.verifyTls ? "checked" : ""} /> ${escapeHtml(translate(state.lang, "request.verifyTls"))}</label>
            ${!s.verifyTls ? `<span id="tls-insecure-badge" class="etp-status-badge status-4xx">${escapeHtml(translate(state.lang, "request.tlsInsecureBadge"))}</span>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  return subContentHtml;
}
