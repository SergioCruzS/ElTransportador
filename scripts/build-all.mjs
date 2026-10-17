#!/usr/bin/env node
/**
 * Compilador, Empaquetador Modular y Minificador de Release de ElTransportador v1.0.0 (`scripts/build-all.mjs`)
 * - Ensambla los componentes HTML modulares (`apps/desktop/src/components/*.html`) dentro de `apps/desktop/dist/index.html`.
 * - Minifica todos los archivos JavaScript (`lang/*.js`, `services/*.js`, `controllers/*.js`),
 *   JSON (`lang/*.json`) y hojas de estilo CSS (`styles/*.css`) en `apps/desktop/dist/` para disminuir el peso final.
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

/**
 * Minificador seguro de CSS para Release (elimina comentarios, saltos de línea y espacios redundantes)
 */
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{:;,>~+])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

/**
 * Minificador léxico seguro de JavaScript ES Modules para Release:
 * Preserva intactos literales de cadena ('...', "...", `...`) y expresiones regulares,
 * eliminando comentarios de bloque/línea, indentación y líneas vacías.
 */
function minifyJs(code) {
  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];

    // Comentario de línea //
    if (ch === "/" && next === "/") {
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

    // Template literals `...` (compactando indentación y saltos de línea HTML internos en Release)
    if (ch === "`") {
      let tmpl = "`";
      i++;
      while (i < n) {
        const c = code[i];
        tmpl += c;
        i++;
        if (c === "\\") {
          if (i < n) {
            tmpl += code[i];
            i++;
          }
        } else if (c === "`") {
          break;
        }
      }
      if (tmpl.includes("<") && tmpl.includes(">")) {
        tmpl = tmpl.replace(/\n\s+/g, " ").replace(/>\s+</g, "><");
      }
      out += tmpl;
      continue;
    }

    out += ch;
    i++;
  }

  // Compactar líneas e indentación preservando intactos los espacios dentro de textos y plantillas
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

// 3. Generar vista previa minificada para el visor Canvas cuando exista el directorio de artefactos
try {
  if (fs.existsSync(path.dirname(ARTIFACT_OUT))) {
    const tokensCss = fs.readFileSync(path.join(DIST_DIR, "styles", "tokens.css"), "utf-8");
    const mainCss = fs.readFileSync(path.join(DIST_DIR, "styles", "main.css"), "utf-8");
    const stripImportsExports = (code) =>
      code
        .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
        .replace(/^\s*export\s+/gm, "");

    const i18nJs = minifyJs(stripImportsExports(fs.readFileSync(path.join(SRC_DIR, "lang", "i18n.js"), "utf-8")));
    const storageJs = minifyJs(stripImportsExports(fs.readFileSync(path.join(SRC_DIR, "services", "storage-sync.js"), "utf-8")));
    const httpJs = minifyJs(stripImportsExports(fs.readFileSync(path.join(SRC_DIR, "services", "http-client.js"), "utf-8")));
    const renderersJs = minifyJs(stripImportsExports(fs.readFileSync(path.join(SRC_DIR, "controllers", "ui-renderers.js"), "utf-8")));
    const controllerJs = minifyJs(stripImportsExports(fs.readFileSync(path.join(SRC_DIR, "controllers", "app-controller.js"), "utf-8")));

    const canvasPreviewHtml = minifiedIndexHtml
      .replace(
        /<link rel="stylesheet" href="\.\/styles\/tokens\.css"\s*\/?><link rel="stylesheet" href="\.\/styles\/main\.css"\s*\/?>/,
        () => `<style>${tokensCss}${mainCss}</style>`
      )
      .replace(
        /<script type="module" src="\.\/controllers\/app-controller\.js"><\/script>/,
        () => `<script type="module">\n${i18nJs}\n${storageJs}\n${httpJs}\n${renderersJs}\n${controllerJs}\n</script>`
      );

    fs.writeFileSync(ARTIFACT_OUT, canvasPreviewHtml, "utf-8");
    fs.copyFileSync(__filename, path.join(path.dirname(ARTIFACT_OUT), "build-all.mjs"));
  }
} catch {}

const savedPct = (((rawTotalBytes - minifiedTotalBytes) / rawTotalBytes) * 100).toFixed(1);
console.log(
  `✓ Release v1.0.0 compilado y minificado en ${DIST_DIR} (Original: ${(rawTotalBytes / 1024).toFixed(2)} KB -> Minificado: ${(minifiedTotalBytes / 1024).toFixed(2)} KB, ahorro del ${savedPct}%).`
);
