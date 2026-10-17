/**
 * Motor de Internacionalización (I18N) Independiente — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/lang/i18n.js
 */
import { LANG_ES } from "./es.js";
import { LANG_EN } from "./en.js";

export { LANG_ES, LANG_EN };

export const DICTIONARIES = {
  es: LANG_ES,
  en: LANG_EN
};

/**
 * Obtiene una cadena traducida por ruta de clave (ej. "topbar.btnSend") e interpola variables {nombre}.
 */
export function translate(lang, keyPath, vars = {}) {
  const dict = DICTIONARIES[lang] || DICTIONARIES.es;
  const parts = String(keyPath).split(".");
  let cur = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = cur[p];
    } else {
      cur = null;
      break;
    }
  }
  if (typeof cur !== "string") {
    let fallback = DICTIONARIES.es;
    for (const p of parts) {
      if (fallback && typeof fallback === "object" && p in fallback) {
        fallback = fallback[p];
      } else {
        return keyPath;
      }
    }
    cur = typeof fallback === "string" ? fallback : keyPath;
  }
  return cur.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

/**
 * Aplica traducciones automáticamente a todos los elementos del DOM con atributo [data-i18n],
 * [data-i18n-placeholder] y [data-i18n-title].
 */
export function applyDomTranslations(lang, rootEl = document) {
  if (!rootEl || typeof rootEl.querySelectorAll !== "function") return;
  rootEl.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = translate(lang, key);
  });
  rootEl.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.setAttribute("placeholder", translate(lang, key));
  });
  rootEl.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) el.setAttribute("title", translate(lang, key));
  });
}

if (typeof window !== "undefined") {
  window.ETP_I18N = { LANG_ES, LANG_EN, DICTIONARIES, translate, applyDomTranslations };
}
