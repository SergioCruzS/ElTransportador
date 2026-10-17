/**
 * Estado centralizado del área de trabajo de ElTransportador (`stores/useWorkspaceStore.ts`).
 * Mantiene colecciones, pestañas abiertas, entorno activo, historial y preferencias persistentes.
 */
import type {
  CollectionFile,
  EnvironmentProfile,
  HistoryEntry,
  HttpRequestSpec,
  AppSettings,
} from '@eltransportador/contracts';

export interface WorkspaceState {
  collections: CollectionFile[];
  environments: EnvironmentProfile[];
  activeEnvironmentId: string | null;
  openTabs: HttpRequestSpec[];
  activeTabId: string;
  history: HistoryEntry[];
  settings: AppSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'es',
  defaultTimeoutMs: 15000,
  maxRedirects: 5,
  verifyTlsByDefault: true,
  maxHistoryEntries: 200,
  historyRetentionDays: 30,
  maxResponseSizeBytes: 10485760,
  proxyUrl: '',
  redactSecretsInLogs: true,
  blockCrossZoneRedirects: true,
};
