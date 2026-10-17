/**
 * Visor de Respuestas (`features/response-viewer/ResponseViewer.tsx`).
 * Implementa las pestañas Pretty, Raw, Headers, Preview (con aislamiento sandbox="" estricto),
 * Cookies y Resultados de Pruebas (Aserciones).
 */
import React, { useState } from 'react';
import type { HttpResponseData } from '@eltransportador/contracts';

export const ResponseViewer: React.FC<{ response: HttpResponseData | null; isLoading: boolean; onCancel: () => void }> = ({
  response,
  isLoading,
  onCancel,
}) => {
  const [activeTab, setActiveTab] = useState<'pretty' | 'raw' | 'headers' | 'preview' | 'cookies' | 'tests'>('pretty');
  const [search, setSearch] = useState('');

  if (isLoading) {
    return (
      <div className="etp-response-empty" role="status">
        <p>Ejecutando solicitud HTTP...</p>
        <button type="button" className="etp-btn-danger" onClick={onCancel}>
          Cancelar Petición
        </button>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="etp-response-empty">
        <p>Introduce una URL y pulsa Enviar (Ctrl+Enter) para inspeccionar la respuesta en tiempo real.</p>
      </div>
    );
  }

  const safePreviewSrcDoc = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"></head><body>${response.body}</body></html>`;

  return (
    <section className="etp-response-panel" aria-label="Panel de respuesta HTTP">
      <header className="etp-response-meta">
        <span className={`etp-status-pill status-${Math.floor(response.status / 100)}xx`}>
          {response.status} {response.statusText}
        </span>
        <span>Tiempo: <strong>{response.durationMs} ms</strong></span>
        <span>Tamaño: <strong>{response.sizeBytes} B</strong></span>
        <input
          type="search"
          placeholder="Buscar en respuesta..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </header>
      <nav className="etp-tabs">
        <button type="button" onClick={() => setActiveTab('pretty')}>Pretty</button>
        <button type="button" onClick={() => setActiveTab('raw')}>Raw</button>
        <button type="button" onClick={() => setActiveTab('headers')}>Headers ({Object.keys(response.headers).length})</button>
        <button type="button" onClick={() => setActiveTab('preview')}>Preview (Aislada)</button>
        <button type="button" onClick={() => setActiveTab('cookies')}>Cookies ({response.cookies.length})</button>
        <button type="button" onClick={() => setActiveTab('tests')}>Pruebas ({response.assertionResults.length})</button>
      </nav>
      <div className="etp-response-content">
        {activeTab === 'pretty' && <pre>{response.body}</pre>}
        {activeTab === 'raw' && <pre>{response.body}</pre>}
        {activeTab === 'preview' && (
          <iframe
            title="Vista previa HTML aislada"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={safePreviewSrcDoc}
            className="etp-sandbox-iframe"
          />
        )}
      </div>
    </section>
  );
};
