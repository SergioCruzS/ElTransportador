/**
 * Compilador, Empaquetador Modular y Minificador de Release de ElTransportador v1.2.0 (`scripts/build-all.mjs`)
 * - Ensambla los componentes HTML modulares (`apps/desktop/src/components/*.html`) dentro de `apps/desktop/dist/index.html`.
 * - Copia y minifica recursivamente toda la estructura modular (`lang/`, `services/storage/`, `services/http/`,
 *   `controllers/renderers/`, `controllers/handlers/`, `styles/`) hacia `apps/desktop/dist/`.
 * - Genera también el entregable autónomo `eltransportador_ide.html`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "apps", "desktop", "src");
const DIST_DIR = path.join(ROOT, "apps", "desktop", "dist");
const ARTIFACT_OUT = "/working_dir/c_5e4e79f4bf4e830a/artifacts/file_generation/ttl=63d/output/eltransportador_ide.html";

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{:;,>~+])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

/**
 * Minificador léxico seguro de JavaScript ES Modules con soporte completo para
 * plantillas anidadas (`... ${ `...` } ...`) y preservación estricta de URLs (`https://...`).
 */
function minifyJs(code) {
  let out = "";
  let i = 0;
  const n = code.length;
  const templateBraceStack = [];
  let inTemplateText = false;

  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];

    if (inTemplateText) {
      if (ch === "\\") {
        out += ch;
        i++;
        if (i < n) {
          out += code[i];
          i++;
        }
        continue;
      }
      if (ch === "$" && next === "{") {
        out += "${";
        i += 2;
        inTemplateText = false;
        templateBraceStack.push(1);
        continue;
      }
      if (ch === "`") {
        out += "`";
        i++;
        inTemplateText = false;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    // Comentario de línea // (nunca precedido por ':' como en https://)
    const prev = i > 0 ? code[i - 1] : "\n";
    if (ch === "/" && next === "/" && prev !== ":") {
      i += 2;
      while (i < n && code[i] !== "\n") i++;
      continue;
    }

    // Comentario de bloque /* ... */
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Cadenas simples o dobles
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = code[i];
        out += c;
        i++;
        if (c === "\\") {
          if (i < n) {
            out += code[i];
            i++;
          }
        } else if (c === quote) {
          break;
        }
      }
      continue;
    }

    // Inicio de template literal `
    if (ch === "`") {
      out += "`";
      i++;
      inTemplateText = true;
      continue;
    }

    // Seguimiento de llaves { } dentro de expresiones ${ ... } de template literals
    if (templateBraceStack.length > 0) {
      if (ch === "{") {
        templateBraceStack[templateBraceStack.length - 1]++;
      } else if (ch === "}") {
        templateBraceStack[templateBraceStack.length - 1]--;
        if (templateBraceStack[templateBraceStack.length - 1] === 0) {
          templateBraceStack.pop();
          out += "}";
          i++;
          inTemplateText = true;
          continue;
        }
      }
    }

    out += ch;
    i++;
  }

  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function minifyHtml(html) {
  return html
    .replace(/<!--(?!\s*@component:)[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .trim();
}

let rawTotalBytes = 0;
let minifiedTotalBytes = 0;

function copyAndMinifyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyAndMinifyDirRecursive(srcPath, destPath);
    } else {
      const rawContent = fs.readFileSync(srcPath, "utf-8");
      rawTotalBytes += Buffer.byteLength(rawContent, "utf-8");
      let minContent = rawContent;
      if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
        minContent = minifyJs(rawContent);
      } else if (entry.name.endsWith(".css")) {
        minContent = minifyCss(rawContent);
      } else if (entry.name.endsWith(".json")) {
        minContent = JSON.stringify(JSON.parse(rawContent));
      } else if (entry.name.endsWith(".html")) {
        minContent = minifyHtml(rawContent);
      }
      minifiedTotalBytes += Buffer.byteLength(minContent, "utf-8");
      fs.writeFileSync(destPath, minContent, "utf-8");
    }
  }
}

fs.mkdirSync(DIST_DIR, { recursive: true });

// 1. Copiar y minificar módulos separados hacia apps/desktop/dist/
for (const folder of ["styles", "lang", "services", "controllers", "components"]) {
  const s = path.join(SRC_DIR, folder);
  if (fs.existsSync(s)) {
    copyAndMinifyDirRecursive(s, path.join(DIST_DIR, folder));
  }
}

// 2. Ensamblar los componentes HTML dentro del shell template.html y minificar index.html
let htmlShell = fs.readFileSync(path.join(SRC_DIR, "app", "template.html"), "utf-8");
rawTotalBytes += Buffer.byteLength(htmlShell, "utf-8");

const componentNames = [
  "topbar",
  "sidebar",
  "request-editor",
  "response-viewer",
  "flows-studio",
  "modals"
];

for (const name of componentNames) {
  const compPath = path.join(SRC_DIR, "components", `${name}.html`);
  const compHtml = fs.readFileSync(compPath, "utf-8");
  htmlShell = htmlShell.replace(`<!-- @component:${name} -->`, () => compHtml.trim());
}

const minifiedIndexHtml = minifyHtml(htmlShell);
minifiedTotalBytes += Buffer.byteLength(minifiedIndexHtml, "utf-8");

const outIndex = path.join(DIST_DIR, "index.html");
fs.writeFileSync(outIndex, minifiedIndexHtml, "utf-8");

// 3. Generar vista previa minificada autónoma para el visor Canvas
try {
  if (fs.existsSync(path.dirname(ARTIFACT_OUT))) {
    const tokensCss = fs.readFileSync(path.join(DIST_DIR, "styles", "tokens.css"), "utf-8");
    const mainCss = fs.readFileSync(path.join(DIST_DIR, "styles", "main.css"), "utf-8");
    const stripImportsExports = (code) =>
      code
        .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
        .replace(/^\s*export\s+\{[\s\S]*?\}\s*(from\s+['"][^'"]+['"])?;?\s*$/gm, "")
        .replace(/^\s*export\s+\*\s+from\s+['"][^'"]+['"];?\s*$/gm, "")
        .replace(/^\s*export\s+/gm, "");

    const bundleOrder = [
      ["lang", "es.js"],
      ["lang", "en.js"],
      ["lang", "i18n.js"],
      ["services", "storage", "constants.js"],
      ["services", "storage", "vault-crypto.js"],
      ["services", "storage", "collection-sanitizer.js"],
      ["services", "http", "variable-interpolation.js"],
      ["services", "http", "wire-preview.js"],
      ["services", "http", "assertions-evaluator.js"],
      ["services", "http", "request-executor.js"],
      ["services", "flows", "flow-schema.js"],
      ["services", "flows", "flow-validator.js"],
      ["services", "flows", "flow-templates.js"],
      ["services", "flows", "flow-orchestrator.js"],
      ["services", "storage", "workspace-state.js"],
      ["controllers", "renderers", "dom-utils.js"],
      ["controllers", "renderers", "workspace-helpers.js"],
      ["controllers", "renderers", "layout-prefs.js"],
      ["controllers", "renderers", "settings-modal.js"],
      ["controllers", "renderers", "sidebar-collections.js"],
      ["controllers", "renderers", "sidebar-environments.js"],
      ["controllers", "renderers", "sidebar-history.js"],
      ["controllers", "renderers", "sidebar.js"],
      ["controllers", "renderers", "center-editor-tabs.js"],
      ["controllers", "renderers", "center-editor-events.js"],
      ["controllers", "renderers", "center-editor.js"],
      ["controllers", "renderers", "json-viewer.js"],
      ["controllers", "renderers", "response-panel.js"],
      ["controllers", "renderers", "flows", "flows-basic-view.js"],
      ["controllers", "renderers", "flows", "flows-inspector-view.js"],
      ["controllers", "renderers", "flows", "flows-canvas-view.js"],
      ["controllers", "renderers", "flows-studio.js"],
      ["controllers", "renderers", "index.js"],
      ["controllers", "handlers", "file-clipboard-actions.js"],
      ["controllers", "handlers", "layout-resizer-handlers.js"],
      ["controllers", "handlers", "request-bar-handlers.js"],
      ["controllers", "handlers", "collection-crud-handlers.js"],
      ["controllers", "handlers", "import-export-handlers.js"],
      ["controllers", "app-controller.js"]
    ];

    const bundledJs = bundleOrder
      .map((relParts) => {
        const fullPath = path.join(SRC_DIR, ...relParts);
        return minifyJs(stripImportsExports(fs.readFileSync(fullPath, "utf-8")));
      })
      .join("\n");

    const canvasPreviewHtml = minifiedIndexHtml
      .replace(
        /<link rel="stylesheet" href="\.\/styles\/tokens\.css"\s*\/?><link rel="stylesheet" href="\.\/styles\/main\.css"\s*\/?>/,
        () => `<style>${tokensCss}${mainCss}</style>`
      )
      .replace(
        /<script type="module" src="\.\/controllers\/app-controller\.js"><\/script>/,
        () => `<script type="module">\n${bundledJs}\n</script>`
      );

    fs.writeFileSync(ARTIFACT_OUT, canvasPreviewHtml, "utf-8");
    fs.copyFileSync(__filename, path.join(path.dirname(ARTIFACT_OUT), "build-all.mjs"));
  }
} catch (err) {
  console.error("Aviso generando vista previa Canvas:", err);
}

const savedPct = (((rawTotalBytes - minifiedTotalBytes) / rawTotalBytes) * 100).toFixed(1);
console.log(
  `✓ Release v1.2.0 compilado y minificado en ${DIST_DIR} (Original: ${(rawTotalBytes / 1024).toFixed(2)} KB -> Minificado: ${(minifiedTotalBytes / 1024).toFixed(2)} KB, ahorro del ${savedPct}%).`
);
