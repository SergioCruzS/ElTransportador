/**
 * Motor de Coloreado Sintáctico JSON, Plegado de Llaves ({} / []) y Resaltado de Búsqueda — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/json-viewer.js
 */
import { escapeHtml, escapeAttr } from "./dom-utils.js";

/**
 * Escapa texto HTML y, si existe una búsqueda activa (`queryLower`), envuelve cada coincidencia
 * en `<mark class="etp-search-highlight">...</mark>` de forma segura contra XSS.
 */
export function escapeAndHighlightText(text, queryLower = "") {
  const str = String(text ?? "");
  if (!queryLower) return escapeHtml(str);

  const qLen = queryLower.length;
  if (qLen === 0) return escapeHtml(str);

  const lowerStr = str.toLowerCase();
  let out = "";
  let pos = 0;
  while (pos < str.length) {
    const idx = lowerStr.indexOf(queryLower, pos);
    if (idx === -1) {
      out += escapeHtml(str.slice(pos));
      break;
    }
    if (idx > pos) {
      out += escapeHtml(str.slice(pos, idx));
    }
    const matchedOrig = str.slice(idx, idx + qLen);
    out += `<mark class="etp-search-highlight">${escapeHtml(matchedOrig)}</mark>`;
    pos = idx + qLen;
  }
  return out;
}

/**
 * Calcula los rangos de líneas plegables entre llaves `{ ... }` y corchetes `[ ... ]`.
 * Retorna un Map<startLineIdx, { endLineIdx, openChar, closeChar }>.
 */
export function computeJsonFoldRanges(lines) {
  const ranges = new Map();
  const stack = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const trimmed = (lines[idx] || "").trim();
    if (!trimmed) continue;

    // Detectar si la línea cierra un bloque al inicio (`}`, `},`, `]`, `],`)
    if (trimmed.startsWith("}") || trimmed.startsWith("]")) {
      const closeChar = trimmed[0];
      const expectedOpen = closeChar === "}" ? "{" : "[";
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].openChar === expectedOpen) {
          const popped = stack.splice(s, 1)[0];
          if (idx > popped.startLineIdx) {
            ranges.set(popped.startLineIdx, {
              endLineIdx: idx,
              openChar: popped.openChar,
              closeChar: `${closeChar}${trimmed.endsWith(",") ? "," : ""}`
            });
          }
          break;
        }
      }
    }

    // Detectar si la línea abre un nuevo bloque al final (`{` o `[`)
    if (trimmed.endsWith("{") || trimmed.endsWith("[")) {
      const openChar = trimmed[trimmed.length - 1];
      stack.push({ startLineIdx: idx, openChar });
    }
  }

  return ranges;
}

/**
 * Colorea sintácticamente una línea de JSON (propiedades, cadenas, números, booleanos, null y llaves)
 * aplicando también resaltado de búsqueda (`queryLower`) dentro de cada token.
 */
export function formatJsonLineWithSyntaxAndHighlight(line, queryLower = "") {
  if (!line) return "";
  const tokenRegex =
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([\{\}\[\]])/g;

  let out = "";
  let lastIdx = 0;
  let match;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIdx) {
      out += escapeAndHighlightText(line.slice(lastIdx, match.index), queryLower);
    }
    const [full, strLiteral, colonPart, boolVal, nullVal, numVal, braceVal] = match;
    if (strLiteral !== undefined) {
      if (colonPart !== undefined) {
        out += `<span class="etp-json-key">${escapeAndHighlightText(strLiteral, queryLower)}</span>${escapeAndHighlightText(colonPart, queryLower)}`;
      } else {
        out += `<span class="etp-json-string">${escapeAndHighlightText(strLiteral, queryLower)}</span>`;
      }
    } else if (boolVal !== undefined) {
      out += `<span class="etp-json-boolean">${escapeAndHighlightText(boolVal, queryLower)}</span>`;
    } else if (nullVal !== undefined) {
      out += `<span class="etp-json-null">${escapeAndHighlightText(nullVal, queryLower)}</span>`;
    } else if (numVal !== undefined) {
      out += `<span class="etp-json-number">${escapeAndHighlightText(numVal, queryLower)}</span>`;
    } else if (braceVal !== undefined) {
      out += `<span class="etp-json-brace">${escapeAndHighlightText(braceVal, queryLower)}</span>`;
    } else {
      out += escapeAndHighlightText(full, queryLower);
    }
    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < line.length) {
    out += escapeAndHighlightText(line.slice(lastIdx), queryLower);
  }
  return out;
}

/**
 * Construye el HTML estructurado línea por línea para el visor de respuesta,
 * garantizando numeración exacta, plegado de llaves JSON y resaltado de búsqueda.
 */
export function buildStructuredResponseCodeHtml({
  allLines,
  isJsonMode,
  filterQ,
  filterMode,
  foldedMap,
  foldedLinesSuffix
}) {
  const foldRanges = isJsonMode ? computeJsonFoldRanges(allLines) : new Map();
  const rowsHtml = [];
  let visibleLinesCount = 0;

  let i = 0;
  while (i < allLines.length) {
    const lineText = allLines[i];
    const lineNum = i + 1;

    // En modo "Filtrar líneas", mostrar únicamente las líneas que coincidan con el filtro
    if (filterQ && filterMode === "filter") {
      if (!lineText.toLowerCase().includes(filterQ)) {
        i++;
        continue;
      }
      visibleLinesCount++;
      const codeHtml = isJsonMode
        ? formatJsonLineWithSyntaxAndHighlight(lineText, filterQ)
        : escapeAndHighlightText(lineText, filterQ);
      rowsHtml.push(`
        <div class="etp-resp-line" data-line-num="${lineNum}">
          <span class="etp-resp-line-num">${lineNum}</span>
          <span class="etp-resp-line-fold"></span>
          <span class="etp-resp-line-code">${codeHtml || " "}</span>
        </div>
      `);
      i++;
      continue;
    }

    // Modo "Ver todo" (con soporte completo de plegado de llaves JSON y resaltado de coincidencias)
    const range = foldRanges.get(i);
    const isFolded = Boolean(range && foldedMap && foldedMap[i]);

    visibleLinesCount++;
    const foldBtnHtml = range
      ? `<button type="button" class="etp-fold-btn" data-json-fold="${i}" title="Colapsar / Expandir">${isFolded ? "▸" : "▾"}</button>`
      : "";

    let codeHtml = isJsonMode
      ? formatJsonLineWithSyntaxAndHighlight(lineText, filterQ)
      : escapeAndHighlightText(lineText, filterQ);

    if (isFolded && range) {
      const hiddenCount = range.endLineIdx - i;
      codeHtml += `<button type="button" class="etp-json-folded-pill" data-json-fold="${i}">⋯ ${hiddenCount} ${escapeHtml(foldedLinesSuffix)} ${escapeHtml(range.closeChar)}</button>`;
      rowsHtml.push(`
        <div class="etp-resp-line" data-line-num="${lineNum}">
          <span class="etp-resp-line-num">${lineNum}</span>
          <span class="etp-resp-line-fold">${foldBtnHtml}</span>
          <span class="etp-resp-line-code">${codeHtml}</span>
        </div>
      `);
      i = range.endLineIdx + 1;
      continue;
    }

    rowsHtml.push(`
      <div class="etp-resp-line" data-line-num="${lineNum}">
        <span class="etp-resp-line-num">${lineNum}</span>
        <span class="etp-resp-line-fold">${foldBtnHtml}</span>
        <span class="etp-resp-line-code">${codeHtml || " "}</span>
      </div>
    `);
    i++;
  }

  return {
    html: `<div class="etp-resp-code-viewer" id="resp-pre-content">${rowsHtml.join("")}</div>`,
    visibleLinesCount,
    foldRanges
  };
}
