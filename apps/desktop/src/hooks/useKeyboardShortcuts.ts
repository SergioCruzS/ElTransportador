/**
 * Hook de atajos de teclado configurables (`hooks/useKeyboardShortcuts.ts`).
 * - Ctrl+Enter / Cmd+Enter: Ejecutar solicitud activa
 * - Ctrl+S / Cmd+S: Guardar solicitud en colección
 * - Ctrl+N / Cmd+N: Nueva pestaña de solicitud
 * - Ctrl+K / Cmd+K: Enfocar búsqueda global
 */
import { useEffect } from 'react';

export function useKeyboardShortcuts(handlers: {
  onSend: () => void;
  onSave: () => void;
  onNewTab: () => void;
  onFocusSearch: () => void;
}) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        handlers.onSend();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handlers.onSave();
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handlers.onNewTab();
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handlers.onFocusSearch();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handlers]);
}
