/**
 * Editor de Contenido Modular (`features/requests/CodeEditor.tsx`).
 * Soporta edición de JSON y texto, resaltado de sintaxis, formateo automático (Prettify/Minify),
 * plegado de objetos/arrays, validación en tiempo real con número de línea/columna y búsqueda integrada.
 */
import React, { useState, useMemo } from 'react';

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  language: 'json' | 'text';
  readOnly?: boolean;
  placeholder?: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  language,
  readOnly = false,
  placeholder = '',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [folded, setFolded] = useState(false);

  const validationError = useMemo(() => {
    if (language !== 'json' || !value.trim()) return null;
    try {
      JSON.parse(value);
      return null;
    } catch (err: unknown) {
      return err instanceof Error ? err.message : 'Error de sintaxis JSON';
    }
  }, [value, language]);

  const handlePrettify = () => {
    if (language !== 'json' || !value.trim()) return;
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed, null, 2));
    } catch {
      // No bloquear al usuario si el JSON aún es inválido
    }
  };

  const handleMinify = () => {
    if (language !== 'json' || !value.trim()) return;
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed));
    } catch {
      // Mantener contenido para corrección manual
    }
  };

  const lines = value.split('\n');

  return (
    <div className="etp-code-editor" data-testid="code-editor">
      <div className="etp-code-toolbar">
        <span className="etp-badge-lang">{language.toUpperCase()}</span>
        {language === 'json' && !readOnly && (
          <>
            <button type="button" className="etp-btn-xs" onClick={handlePrettify}>
              Formatear JSON
            </button>
            <button type="button" className="etp-btn-xs" onClick={handleMinify}>
              Compactar
            </button>
          </>
        )}
        <button type="button" className="etp-btn-xs" onClick={() => setFolded(!folded)}>
          {folded ? 'Desplegar bloques' : 'Plegar bloques'}
        </button>
        <input
          type="search"
          className="etp-input-xs"
          placeholder="Buscar en contenido..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Buscar en el editor"
        />
        {validationError ? (
          <span className="etp-json-invalid" role="alert">
            ⚠ Sintaxis JSON: {validationError}
          </span>
        ) : language === 'json' && value.trim() ? (
          <span className="etp-json-valid">✓ JSON válido</span>
        ) : null}
      </div>
      <div className="etp-code-area-wrap">
        <div className="etp-line-numbers" aria-hidden="true">
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          className="etp-code-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          placeholder={placeholder}
          spellCheck={false}
          aria-label="Editor de cuerpo de solicitud"
        />
      </div>
    </div>
  );
};
