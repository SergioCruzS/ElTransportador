/**
 * Cliente IPC Tipado (`services/ipcClient.ts`).
 * Centraliza la comunicación entre React y el backend nativo (Tauri 2 `invoke` o Local Bridge).
 * Ningún componente visual accede directamente a la red ni al sistema de archivos.
 */
import type {
  HttpRequestSpec,
  HttpResponseData,
  CollectionFile,
  HistoryEntry,
  ImportReport,
} from '@eltransportador/contracts';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    __ELTRANSPORTADOR_BRIDGE__?: {
      executeRequest: (req: HttpRequestSpec, ctx: Record<string, unknown>) => Promise<HttpResponseData>;
      cancelRequest: (requestId: string) => Promise<boolean>;
      saveCollection: (fileName: string, col: CollectionFile) => Promise<string>;
      listHistory: () => Promise<HistoryEntry[]>;
      clearHistory: () => Promise<void>;
      importCollection: (rawJson: string) => Promise<ImportReport>;
      exportToCurl: (req: HttpRequestSpec) => string;
    };
  }
}

export async function invokeExecuteRequest(
  request: HttpRequestSpec,
  context: Record<string, unknown>
): Promise<HttpResponseData> {
  if (window.__TAURI_INTERNALS__) {
    return (await window.__TAURI_INTERNALS__.invoke('execute_http_request', {
      request,
      context,
    })) as HttpResponseData;
  }
  if (window.__ELTRANSPORTADOR_BRIDGE__) {
    return await window.__ELTRANSPORTADOR_BRIDGE__.executeRequest(request, context);
  }
  throw new Error('Backend IPC de ElTransportador no disponible.');
}

export async function invokeCancelRequest(requestId: string): Promise<boolean> {
  if (window.__TAURI_INTERNALS__) {
    return (await window.__TAURI_INTERNALS__.invoke('cancel_http_request', {
      requestId,
    })) as boolean;
  }
  if (window.__ELTRANSPORTADOR_BRIDGE__) {
    return await window.__ELTRANSPORTADOR_BRIDGE__.cancelRequest(requestId);
  }
  return false;
}
